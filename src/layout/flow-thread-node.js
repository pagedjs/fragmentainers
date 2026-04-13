import { LayoutNode } from "./layout-node-base.js";

/**
 * Anonymous flow thread node (Chromium pattern). Wraps a multicol or
 * column-direction flex container's children so that `getLayoutAlgorithm`
 * dispatches to `layoutBlockContainer` instead of recursing back into the
 * wrapping algorithm.
 *
 * All classification flags stay at the `LayoutNode` defaults (falsy), which
 * is what routes dispatch to block layout. Only `children`, `debugName`,
 * and `computedBlockSize` need overrides.
 */
export class FlowThreadNode extends LayoutNode {
	#node;

	constructor(node) {
		super();
		this.#node = node;
	}

	get children() {
		return this.#node.children;
	}

	get debugName() {
		return `[flow-thread:${this.#node.debugName}]`;
	}

	computedBlockSize() {
		return 0;
	}
}
