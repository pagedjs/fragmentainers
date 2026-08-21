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
	/** @type {HandlerRegistry} */
	handlers;
	/** @type {CloneMap} */
	cloneMap = new CloneMap();
	/** @type {import('./fragmenter.js').Fragmenter|null} */
	flow;

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
