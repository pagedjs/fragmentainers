import { LayoutHandler } from "./handler.js";
import { walkSheets, insertWrappedRule } from "../styles/walk-rules.js";

/**
 * Resolve an ordered list of handler classes into the list a flow will
 * instantiate:
 *   - anything that is not a LayoutHandler subclass is rejected;
 *   - a class listed twice is kept once, at its first position;
 *   - a class that extends an earlier entry replaces that entry in
 *     place (override), so handler ordering constraints still hold.
 *
 * @param {Array<typeof LayoutHandler>} classes
 * @returns {Array<typeof LayoutHandler>}
 */
export function resolveHandlerClasses(classes) {
	const resolved = [];
	for (const Cls of classes) {
		if (typeof Cls !== "function" || !(Cls.prototype instanceof LayoutHandler)) {
			throw new TypeError("Handler must be a class that extends LayoutHandler");
		}
		if (resolved.includes(Cls)) continue;
		const overrides = resolved.findIndex((Base) => Cls.prototype instanceof Base);
		if (overrides !== -1) {
			resolved[overrides] = Cls;
		} else {
			resolved.push(Cls);
		}
	}
	return resolved;
}

/**
 * Owns the handler instances of one flow. Constructed from a class list
 * (normally `Fragmenter.handlers`); instances are created by init()
 * and destroyed only by this registry's destroy(). Two registries never
 * share instances.
 */
export class HandlerRegistry {
	#classes;
	#context;
	#handlers = [];
	#injectedSheet = null;

	/**
	 * @param {Array<typeof LayoutHandler>} classes — ordered handler classes
	 * @param {import('../fragmentation/flow-context.js').FlowContext|null} [context]
	 *   passed to every handler's init(options, context)
	 */
	constructor(classes, context = null) {
		this.#classes = resolveHandlerClasses(classes);
		this.#context = context;
	}

	/** The resolved class list, in instantiation order. */
	get classes() {
		return [...this.#classes];
	}

	/**
	 * Create fresh handler instances and initialize them with options.
	 * Destroys any previous instances first.
	 *
	 * @param {Object} [options]
	 */
	init(options = {}) {
		for (const handler of this.#handlers) {
			handler.destroy();
		}
		this.#handlers = this.#classes.map((Cls) => {
			const handler = new Cls();
			handler.init(options, this.#context);
			return handler;
		});
	}

	/**
	 * Ensure instances exist. Code driving layout without a Fragmenter
	 * (createFragments, runLayoutGenerator) never calls init() explicitly.
	 */
	#ensureReady() {
		if (this.#handlers.length === 0 && this.#classes.length > 0) {
			this.init();
		}
	}

	/**
	 * Destroy the handler instances. Classes are kept; the next init()
	 * creates fresh instances.
	 */
	destroy() {
		for (const handler of this.#handlers) {
			handler.destroy();
		}
		this.#handlers = [];
		this.#injectedSheet = null;
	}

	/**
	 * Return this flow's instance of a handler class (or of a subclass
	 * that overrides it). Null if not in the catalog or before init().
	 *
	 * @param {typeof LayoutHandler} HandlerClass
	 * @returns {LayoutHandler|null}
	 */
	get(HandlerClass) {
		return this.#handlers.find((m) => m instanceof HandlerClass) ?? null;
	}

	[Symbol.iterator]() {
		return this.#handlers[Symbol.iterator]();
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
	 * After the walk, collects injected rules from handlers into one
	 * sheet appended to the styles array so it cascades after UA and
	 * author rules.
	 *
	 * @param {CSSStyleSheet[]} styles — adopted stylesheets (mutated: injected sheet appended)
	 */
	processRules(styles) {
		this.#ensureReady();
		const hs = this.#handlers;
		if (this.#injectedSheet) {
			const previousIndex = styles.indexOf(this.#injectedSheet);
			if (previousIndex !== -1) styles.splice(previousIndex, 1);
			this.#injectedSheet = null;
		}

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

		const rules = [];
		for (const handler of hs) {
			handler.appendRules(rules);
		}
		if (rules.length > 0) {
			const sheet = new CSSStyleSheet();
			for (const rule of rules) {
				insertWrappedRule(sheet, rule, []);
			}
			styles.push(sheet);
			this.#injectedSheet = sheet;
		}
	}

	/**
	 * The CSSStyleSheet appended by the most recent processRules() call.
	 * Null when no handler emitted any rules.
	 */
	getInjectedSheet() {
		return this.#injectedSheet;
	}

	prepareContent(content) {
		this.#ensureReady();
		for (const handler of this.#handlers) {
			handler.prepareContent(content);
		}
	}

	/**
	 * Hand every handler the constraint space the measurement container was
	 * just sized to.
	 *
	 * @param {import('../fragmentation/constraint-space.js').ConstraintSpace} constraintSpace
	 */
	applyConstraintSpace(constraintSpace) {
		this.#ensureReady();
		for (const handler of this.#handlers) {
			handler.applyConstraintSpace(constraintSpace);
		}
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
	 *
	 * @param {Element} contentRoot — the measurement slot element
	 */
	afterMeasurementSetup(contentRoot, context = { pass: 0, segment: 0 }) {
		for (const handler of this.#handlers) {
			handler.afterMeasurementSetup(contentRoot, context);
		}
	}

	beforeLayoutPass(context) {
		this.#ensureReady();
		for (const handler of this.#handlers) handler.beforeLayoutPass(context);
	}

	afterLayoutPass(context) {
		this.#ensureReady();
		const results = [];
		for (const handler of this.#handlers) {
			const result = handler.afterLayoutPass(context);
			if (result) results.push({ handler, result });
		}
		return results;
	}

	onPassLimit(context) {
		this.#ensureReady();
		const results = [];
		for (const handler of this.#handlers) {
			const result = handler.onPassLimit(context);
			if (result) results.push({ handler, result });
		}
		return results;
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

	afterCompose(element, fragment) {
		this.#ensureReady();
		for (const handler of this.#handlers) {
			handler.afterCompose(element, fragment);
		}
	}

	/**
	 * Return handlers that run a parallel flow, paired with their flow.
	 * @returns {Array<{ handler: LayoutHandler, flow: import('../fragmentation/fragment-flow.js').FragmentFlow }>}
	 */
	getFlows() {
		this.#ensureReady();
		const result = [];
		for (const handler of this.#handlers) {
			const flow = handler.getFlow();
			if (flow) result.push({ handler, flow });
		}
		return result;
	}
}
