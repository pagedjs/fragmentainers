import { LayoutHandler } from "./handler.js";
import { walkSheets } from "../styles/walk-rules.js";

class HandlerRegistry {
	#classes = [];
	#created = [];
	#handlers = [];
	#cloneMap = new WeakMap();

	/**
	 * Register a handler class. A fresh instance is created each time
	 * init() is called (once per FragmentedFlow initialization).
	 *
	 * @param {typeof LayoutHandler} HandlerClass
	 */
	register(HandlerClass) {
		if (typeof HandlerClass !== "function" || !(HandlerClass.prototype instanceof LayoutHandler)) {
			throw new TypeError("Handler must be a class that extends LayoutHandler");
		}
		if (!this.#classes.includes(HandlerClass)) {
			this.#classes.push(HandlerClass);
		}
	}

	/**
	 * Create fresh handler instances and initialize them with options.
	 * Called once per FragmentedFlow initialization. Destroys any
	 * previous instances before creating new ones.
	 *
	 * @param {Object} [options]
	 */
	init(options) {
		for (const handler of this.#created) {
			handler.destroy();
		}
		this.#cloneMap = new WeakMap();
		this.#created = this.#classes.map((Cls) => {
			const handler = new Cls();
			handler.init(options);
			return handler;
		});
		this.#handlers = [...this.#created];
	}

	/**
	 * Ensure #handlers is populated. If init() hasn't been called yet
	 * (e.g. code using createFragments() directly without FragmentedFlow),
	 * create instances with default options so delegate methods work.
	 */
	#ensureReady() {
		if (this.#handlers.length === 0 && this.#classes.length > 0) {
			this.init();
		}
	}

	remove(HandlerClass) {
		const idx = this.#classes.indexOf(HandlerClass);
		if (idx !== -1) this.#classes.splice(idx, 1);
	}

	/**
	 * Return the current instance of a registered handler class.
	 * Returns null if the class isn't registered or init() hasn't
	 * been called yet.
	 *
	 * @param {typeof LayoutHandler} HandlerClass
	 * @returns {LayoutHandler|null}
	 */
	get(HandlerClass) {
		return this.#handlers.find((m) => m instanceof HandlerClass) ?? null;
	}

	claim(node) {
		this.#ensureReady();
		return this.#handlers.some((handler) => handler.claim(node));
	}

	layout(rootNode, constraintSpace, breakToken, layoutChild) {
		this.#ensureReady();
		let reservedBlockStart = 0;
		let reservedBlockEnd = 0;
		const afterRenderCallbacks = [];
		for (const handler of this.#handlers) {
			const result = handler.layout(rootNode, constraintSpace, breakToken, layoutChild);
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
		for (const handler of this.#handlers) {
			const result = handler.beforeChildren(node, constraintSpace, breakToken);
			if (result) return result;
		}
		return null;
	}

	/**
	 * Walk all CSS rules in the given stylesheets and dispatch each
	 * leaf style rule to every handler's matchRule() callback. Recurses
	 * into grouping rules (@media, @supports, @layer, etc.) and tracks
	 * wrapper preambles for handlers that need them (e.g. nth-selectors).
	 *
	 * After the walk, collects injected sheets from handlers and appends
	 * them to the styles array so they cascade after UA and author rules.
	 *
	 * @param {CSSStyleSheet[]} styles — adopted stylesheets (mutated: injected sheet appended)
	 */
	processRules(styles) {
		this.#ensureReady();
		const hs = this.#handlers;

		// Reset handler state and give access to the styles array
		for (const handler of hs) {
			handler.styles = styles;
			handler.resetRules();
		}

		walkSheets(styles, (rule, wrappers) => {
			if (rule.selectorText === undefined) return;
			const ctx = { wrappers };
			for (const handler of hs) {
				handler.matchRule(rule, ctx);
			}
		});

		// Collect rules from handlers into a shared sheet
		const rules = [];
		for (const handler of hs) {
			handler.appendRules(rules);
		}
		if (rules.length > 0) {
			const sheet = new CSSStyleSheet();
			for (const rule of rules) {
				sheet.insertRule(rule, sheet.cssRules.length);
			}
			styles.push(sheet);
		}
	}

	/**
	 * Collect elements that handlers want persisted across all measurement
	 * segments. Called after processRules() with the full content.
	 *
	 * @param {DocumentFragment|Element} content — the full content root
	 * @returns {Element[]} elements to include in every segment's measurer
	 */
	claimPersistent(content) {
		const elements = [];
		for (const handler of this.#handlers) {
			const claimed = handler.claimPersistent(content);
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
	 * Let handlers mutate the measurement DOM after content injection
	 * but before measurement. Pseudo-element materialization happens
	 * here. The caller should trigger a reflow afterwards.
	 *
	 * @param {Element} contentRoot — the measurement slot element
	 */
	beforeMeasurement(contentRoot) {
		this.#ensureReady();
		for (const handler of this.#handlers) {
			handler.beforeMeasurement(contentRoot);
		}
	}

	/**
	 * Let handlers probe the live measurement DOM after setup.
	 * Called from the Measurer after pseudo-element materialization
	 * and reflow, before getContentStyles().
	 *
	 * @param {Element} contentRoot — the measurement slot element
	 */
	afterMeasurementSetup(contentRoot) {
		for (const handler of this.#handlers) {
			handler.afterMeasurementSetup(contentRoot);
		}
	}

	/**
	 * Collect CSSStyleSheets from handlers for fragment-container adoption.
	 *
	 * @returns {CSSStyleSheet[]}
	 */
	getAdoptedSheets() {
		const sheets = [];
		for (const handler of this.#handlers) {
			sheets.push(...handler.getAdoptedSheets());
		}
		return sheets;
	}

	claimPseudo(element, pseudo, contentValue) {
		return this.#handlers.some((handler) => handler.claimPseudo(element, pseudo, contentValue));
	}

	claimPseudoRule(rule, pseudo) {
		return this.#handlers.some((handler) => handler.claimPseudoRule(rule, pseudo));
	}

	afterContentLayout(fragment, constraintSpace, inputBreakToken) {
		let reservedBlockEnd = 0;
		const afterRenderCallbacks = [];
		let hasResult = false;
		for (const handler of this.#handlers) {
			const result = handler.afterContentLayout(fragment, constraintSpace, inputBreakToken);
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

export const handlers = new HandlerRegistry();
