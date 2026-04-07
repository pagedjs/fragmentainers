import { LayoutModule } from "./module.js";

class ModuleRegistry {
	#modules = [];
	#cloneMap = new WeakMap();

	register(module) {
		if (!(module instanceof LayoutModule)) {
			throw new TypeError("Module must extend the LayoutModule base class");
		}
		if (!this.#modules.includes(module)) {
			this.#modules.push(module);
		}
	}

	remove(module) {
		const idx = this.#modules.indexOf(module);
		if (idx !== -1) {
			this.#modules.splice(idx, 1);
		}
	}

	claim(node) {
		return this.#modules.some((m) => m.claim(node));
	}

	layout(rootNode, constraintSpace, breakToken, layoutChild) {
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

	/**
	 * Called after content layout for a fragmentainer. Aggregates
	 * reservedBlockEnd and afterRender callbacks across all modules.
	 *
	 * @param {import('../core/fragment.js').Fragment} fragment
	 * @param {import('../core/constraint-space.js').ConstraintSpace} constraintSpace
	 * @param {import('../core/tokens.js').BreakToken|null} inputBreakToken
	 * @returns {{ reservedBlockEnd: number, afterRenderCallbacks: Function[] }|null}
	 */
	trackClone(clone, source) {
		this.#cloneMap.set(clone, source);
	}

	getSource(clone) {
		return this.#cloneMap.get(clone);
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
