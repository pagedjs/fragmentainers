import { LayoutDriver } from "./layout-driver.js";

/**
 * Yielded from layout generators to the driver.
 * Represents a request to lay out a child node.
 */
export class LayoutRequest {
	constructor(node, constraintSpace, breakToken = null) {
		this.node = node;
		this.constraintSpace = constraintSpace;
		this.breakToken = breakToken;
	}
}

/**
 * Backwards-compatible shim — instantiates a `LayoutDriver` and runs it.
 *
 * @param {import('./layout-node-base.js').LayoutNode} rootNode
 * @param {import('../fragmentation/constraint-space.js').ConstraintSpace | { resolve: Function }} constraintSpaceOrResolver
 * @param {{ fragmentainerIndex: number, blockOffset: number }|null} [continuation]
 * @returns {import('../fragmentation/fragment.js').Fragment[] | { fragments: import('../fragmentation/fragment.js').Fragment[], continuation: { fragmentainerIndex: number, blockOffset: number } }}
 */
export function createFragments(rootNode, constraintSpaceOrResolver, continuation = null) {
	return new LayoutDriver(rootNode, constraintSpaceOrResolver, continuation).run();
}
