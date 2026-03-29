/**
 * The output of a layout algorithm — a positioned fragment.
 * Represents the portion of a CSS box that belongs to exactly one fragmentainer.
 */
export class PhysicalFragment {
  constructor(node, blockSize, childFragments = []) {
    this.node = node;
    this.blockSize = blockSize;
    this.inlineSize = 0;
    this.childFragments = childFragments;
    this.breakToken = null;
    this.constraints = null;
    this.multicolData = null;
  }

  /**
   * Merge two fragments that share the same fragmentainer (page).
   * Combines their child fragments into one. Used when continuing
   * fragmentation across multiple independent elements.
   *
   * @param {PhysicalFragment} fragmentA — earlier element's fragment
   * @param {PhysicalFragment} fragmentB — later element's fragment
   * @returns {PhysicalFragment}
   */
  static merge(fragmentA, fragmentB) {
    const merged = new PhysicalFragment(
      null,
      fragmentA.blockSize + fragmentB.blockSize,
      [...fragmentA.childFragments, ...fragmentB.childFragments],
    );
    merged.inlineSize = fragmentA.inlineSize;
    merged.constraints = fragmentA.constraints;
    // B's break token carries forward (A is done on this page)
    merged.breakToken = fragmentB.breakToken;
    return merged;
  }
}
