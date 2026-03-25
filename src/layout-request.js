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
 * Helper to create a LayoutRequest — used inside layout generators.
 */
export function layoutChild(node, constraintSpace, breakToken = null) {
  return new LayoutRequest(node, constraintSpace, breakToken);
}
