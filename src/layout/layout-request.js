/**
 * Yielded from layout generators to the driver.
 * Represents a request to lay out a child node.
 *
 * @param {import("./layout-node-base.js").LayoutNode} node - Child to lay out
 * @param {import("../fragmentation/constraint-space.js").ConstraintSpace} constraintSpace - Child constraint space
 * @param {import("../fragmentation/tokens.js").BreakToken|null} [breakToken] - Child continuation
 * @param {import("../fragmentation/break-scoring.js").EarlyBreak|null} [earlyBreakTarget] - Selected retry target
 * @returns {LayoutRequest} Child layout request
 */
export class LayoutRequest {
	constructor(node, constraintSpace, breakToken = null, earlyBreakTarget = null) {
		this.node = node;
		this.constraintSpace = constraintSpace;
		this.breakToken = breakToken;
		this.earlyBreakTarget = earlyBreakTarget;
	}
}
