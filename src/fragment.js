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
    this.lineCount = 0;
    this.isRepeated = false;
    this.counterState = null;
  }
}
