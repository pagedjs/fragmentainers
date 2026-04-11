import { LayoutModule } from "./module.js";

class ModuleRegistry {
	#classes = [];
	#created = [];
	#modules = [];
	#cloneMap = new WeakMap();

	/**
	 * Register a module class. A fresh instance is created each time
	 * init() is called (once per FragmentedFlow initialization).
	 *
	 * @param {typeof LayoutModule} ModuleClass
	 */
	register(ModuleClass) {
		if (typeof ModuleClass !== "function" || !(ModuleClass.prototype instanceof LayoutModule)) {
			throw new TypeError("Module must be a class that extends LayoutModule");
		}
		if (!this.#classes.includes(ModuleClass)) {
			this.#classes.push(ModuleClass);
		}
	}

	/**
	 * Create fresh module instances and initialize them with options.
	 * Called once per FragmentedFlow initialization. Destroys any
	 * previous instances before creating new ones.
	 *
	 * @param {Object} [options]
	 */
	init(options) {
		for (const mod of this.#created) {
			mod.destroy();
		}
		this.#cloneMap = new WeakMap();
		this.#created = this.#classes.map((Cls) => {
			const mod = new Cls();
			mod.init(options);
			return mod;
		});
		this.#modules = [...this.#created];
	}

	/**
	 * Ensure #modules is populated. If init() hasn't been called yet
	 * (e.g. code using createFragments() directly without FragmentedFlow),
	 * create instances with default options so delegate methods work.
	 */
	#ensureReady() {
		if (this.#modules.length === 0 && this.#classes.length > 0) {
			this.init();
		}
	}

	remove(ModuleClass) {
		const idx = this.#classes.indexOf(ModuleClass);
		if (idx !== -1) this.#classes.splice(idx, 1);
	}

	/**
	 * Return the current instance of a registered module class.
	 * Returns null if the class isn't registered or init() hasn't
	 * been called yet.
	 *
	 * @param {typeof LayoutModule} ModuleClass
	 * @returns {LayoutModule|null}
	 */
	get(ModuleClass) {
		return this.#modules.find((m) => m instanceof ModuleClass) ?? null;
	}

	claim(node) {
		this.#ensureReady();
		return this.#modules.some((m) => m.claim(node));
	}

	layout(rootNode, constraintSpace, breakToken, layoutChild) {
		this.#ensureReady();
		let reservedBlockStart = 0;
		let reservedBlockEnd = 0;
		const afterRenderCallbacks = [];
		for (const mod of this.#modules) {
			const result = mod.layout(rootNode, constraintSpace, breakToken, layoutChild);
			reservedBlockStart += result.reservedBlockStart;
			reservedBlockEnd += result.reservedBlockEnd;
			if (result.afterRender) {
				afterRenderCallbacks.push(result.afterRender);
			}
		}
		return { reservedBlockStart, reservedBlockEnd, afterRenderCallbacks };
	}

	beforeChildren(node, constraintSpace, breakToken) {
		this.#ensureReady();
		for (const mod of this.#modules) {
			const result = mod.beforeChildren(node, constraintSpace, breakToken);
			if (result) return result;
		}
		return null;
	}

	/**
	 * Walk all CSS rules in the given stylesheets and dispatch each
	 * leaf style rule to every module's matchRule() callback. Recurses
	 * into grouping rules (@media, @supports, @layer, etc.) and tracks
	 * wrapper preambles for modules that need them (e.g. nth-selectors).
	 *
	 * After the walk, collects injected sheets from modules and prepends
	 * them to the styles array.
	 *
	 * @param {CSSStyleSheet[]} styles — adopted stylesheets (mutated: injected sheets prepended)
	 */
	processRules(styles) {
		this.#ensureReady();
		const mods = this.#modules;

		// Reset module state and give access to the styles array
		for (const mod of mods) {
			mod.styles = styles;
			mod.resetRules();
		}

		const walk = (ruleList, wrappers) => {
			for (const rule of ruleList) {
				if (rule.selectorText !== undefined) {
					const ctx = { wrappers };
					for (const mod of mods) {
						mod.matchRule(rule, ctx);
					}
				} else if (rule.cssRules) {
					const preamble = rule.cssText.substring(0, rule.cssText.indexOf("{")).trim();
					walk(rule.cssRules, [...wrappers, preamble]);
				}
			}
		};

		for (const sheet of styles) {
			try {
				walk(sheet.cssRules, []);
			} catch {
				continue;
			}
		}

		// Collect rules from modules into a shared sheet
		const rules = [];
		for (const mod of mods) {
			mod.appendRules(rules);
		}
		if (rules.length > 0) {
			const sheet = new CSSStyleSheet();
			for (const rule of rules) {
				sheet.insertRule(rule, sheet.cssRules.length);
			}
			styles.unshift(sheet);
		}
	}

	/**
	 * Collect elements that modules want persisted across all measurement
	 * segments. Called after processRules() with the full content.
	 *
	 * @param {DocumentFragment|Element} content — the full content root
	 * @returns {Element[]} elements to include in every segment's measurer
	 */
	claimPersistent(content) {
		const elements = [];
		for (const mod of this.#modules) {
			const claimed = mod.claimPersistent(content);
			if (claimed.length > 0) elements.push(...claimed);
		}
		return elements;
	}

	trackClone(clone, source) {
		this.#cloneMap.set(clone, source);
	}

	getSource(clone) {
		return this.#cloneMap.get(clone);
	}

	/**
	 * Let modules probe the live measurement DOM after setup.
	 * Called from the Measurer after pseudo-element materialization
	 * and reflow, before getContentStyles().
	 *
	 * @param {Element} contentRoot — the measurement slot element
	 */
	afterMeasurementSetup(contentRoot) {
		for (const mod of this.#modules) {
			mod.afterMeasurementSetup(contentRoot);
		}
	}

	/**
	 * Collect CSSStyleSheets from modules for fragment-container adoption.
	 *
	 * @returns {CSSStyleSheet[]}
	 */
	getAdoptedSheets() {
		const sheets = [];
		for (const mod of this.#modules) {
			sheets.push(...mod.getAdoptedSheets());
		}
		return sheets;
	}

	claimPseudo(element, pseudo, contentValue) {
		return this.#modules.some((m) => m.claimPseudo(element, pseudo, contentValue));
	}

	claimPseudoRule(rule, pseudo) {
		return this.#modules.some((m) => m.claimPseudoRule(rule, pseudo));
	}

	afterContentLayout(fragment, constraintSpace, inputBreakToken) {
		let reservedBlockEnd = 0;
		const afterRenderCallbacks = [];
		let hasResult = false;
		for (const mod of this.#modules) {
			const result = mod.afterContentLayout(fragment, constraintSpace, inputBreakToken);
			if (result) {
				hasResult = true;
				reservedBlockEnd += result.reservedBlockEnd;
				if (result.afterRender) {
					afterRenderCallbacks.push(result.afterRender);
				}
			}
		}
		return hasResult ? { reservedBlockEnd, afterRenderCallbacks } : null;
	}
}

export const modules = new ModuleRegistry();
