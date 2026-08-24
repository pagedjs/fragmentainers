import { HandlerRegistry } from "../handlers/registry.js";
import { defaultHandlers } from "../handlers/catalog.js";
import { CloneMap } from "./clone-map.js";

/**
 * Everything a layout tree needs to reach back to the flow that owns it:
 * the flow's handler instances and its clone→source map. Carried on
 * every LayoutNode (see LayoutNode.context) so algorithms and Fragment
 * composition find it without threading it through signatures.
 */
export class FlowContext {
	#activeHandler = null;
	#layoutPasses = new Map();

	/** @type {HandlerRegistry} */
	handlers;
	/** @type {CloneMap} */
	cloneMap = new CloneMap();
	/** @type {import('./fragmenter.js').Fragmenter|null} */
	flow;
	/** The pass currently being measured and laid out. */
	layoutPass = 0;

	/**
	 * @param {Object} [options]
	 * @param {Array<typeof import('../handlers/handler.js').LayoutHandler>} [options.handlerClasses]
	 *   defaults to the shared catalog (`Fragmenter.handlers`)
	 * @param {import('./fragmenter.js').Fragmenter|null} [options.flow]
	 */
	constructor({ handlerClasses = defaultHandlers, flow = null } = {}) {
		this.flow = flow;
		this.handlers = new HandlerRegistry(handlerClasses, this);
	}

	/**
	 * Drop every handler-owned pass registration so a fresh `processRules`
	 * re-derives the budget from the stylesheets it is about to walk. The
	 * flow's own registration survives: it comes from `Fragmenter.registerLayoutPass`,
	 * not from a rule match, so nothing would restore it.
	 */
	resetLayoutPasses() {
		for (const owner of this.#layoutPasses.keys()) {
			if (owner !== this.flow) this.#layoutPasses.delete(owner);
		}
	}

	/**
	 * Run `callback` with `handler` credited as the caller of anything it
	 * registers. `HandlerRegistry.processRules` wraps this around
	 * `handler.matchRule` and nothing else, so it is the only window in which
	 * `registerLayoutPass` attributes a registration to a handler.
	 *
	 * @param {import('../handlers/handler.js').LayoutHandler} handler
	 * @param {() => any} callback
	 * @returns {any} whatever `callback` returned
	 */
	withActiveHandler(handler, callback) {
		const previous = this.#activeHandler;
		this.#activeHandler = handler;
		try {
			return callback();
		} finally {
			this.#activeHandler = previous;
		}
	}

	/**
	 * Raise the settlement budget to at least `maxPasses`, crediting the
	 * registration to the handler `withActiveHandler` is currently running.
	 * `HandlerRegistry.processRules` opens that window only around `matchRule`;
	 * from any other hook (`init`, `prepareContent`, `afterMeasurementSetup`, …)
	 * the registration lands on the flow instead: it is kept across
	 * `processRules` and its handler is never offered `onPassLimit`, so a
	 * handler that wants the fallback must register from `matchRule`.
	 *
	 * @param {number} maxPasses positive integer
	 * @throws {RangeError} if `maxPasses` is not a positive integer
	 */
	registerLayoutPass(maxPasses) {
		if (!Number.isInteger(maxPasses) || maxPasses < 1) {
			throw new RangeError("maxPasses must be a positive integer");
		}
		const owner = this.#activeHandler ?? this.flow;
		const current = this.#layoutPasses.get(owner) ?? 0;
		this.#layoutPasses.set(owner, Math.max(current, maxPasses));
	}

	/**
	 * The highest pass count any owner asked for; 0 means no settlement runs.
	 *
	 * @returns {number}
	 */
	get layoutPassBudget() {
		let budget = 0;
		for (const value of this.#layoutPasses.values()) budget = Math.max(budget, value);
		return budget;
	}

	/**
	 * The handlers that registered a budget from `matchRule` — the ones
	 * `Fragmenter.#settleLayout` offers `onPassLimit` when the budget runs
	 * out. Excludes the flow's own registration, which has no such hook.
	 *
	 * @returns {Array<import('../handlers/handler.js').LayoutHandler>}
	 */
	get layoutPassHandlers() {
		return [...this.#layoutPasses.keys()].filter((owner) => owner !== this.flow);
	}
}

/**
 * Give a root node a flow context if its creator did not. Only the
 * flow-less entry points (runLayoutGenerator and Fragment.build called
 * directly) hit this; a flow always sets its own.
 *
 * Duck-typed test nodes have no `hasContext`, so an assigned context
 * lands on them as an own property — recognize that rather than
 * replacing it with a second one.
 *
 * @param {import('../layout/layout-node-base.js').LayoutNode} node
 * @returns {FlowContext}
 */
export function ensureFlowContext(node) {
	if (!node.hasContext && !Object.hasOwn(node, "context")) {
		node.context = new FlowContext();
	}
	return node.context;
}
