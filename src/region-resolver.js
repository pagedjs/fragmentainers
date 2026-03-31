import { ConstraintSpace } from "./constraint-space.js";
import { FRAGMENTATION_REGION } from "./constants.js";

/**
 * Resolved region dimensions for one region element.
 */
export class RegionConstraints {
  /**
   * @param {object} opts
   * @param {number} opts.regionIndex
   * @param {Element} opts.element - The target region DOM element
   * @param {{ inlineSize: number, blockSize: number }} opts.contentArea
   */
  constructor({ regionIndex, element, contentArea }) {
    this.regionIndex = regionIndex;
    this.element = element;
    this.contentArea = contentArea;
  }

  /** Build a ConstraintSpace for layout from these region dimensions. */
  toConstraintSpace() {
    return new ConstraintSpace({
      availableInlineSize: this.contentArea.inlineSize,
      availableBlockSize: this.contentArea.blockSize,
      fragmentainerBlockSize: this.contentArea.blockSize,
      blockOffsetInFragmentainer: 0,
      fragmentationType: FRAGMENTATION_REGION,
    });
  }
}

/**
 * Resolver that reads fragmentainer dimensions from a chain of DOM region elements.
 *
 * Each region element becomes a fragmentainer. The resolver reads dimensions
 * from the element's client rect. The caller controls the loop via
 * FragmentainerLayout.next() and stops when regions run out.
 */
export class RegionResolver {
  /**
   * @param {Element[]} regionElements - Ordered array of region DOM elements
   */
  constructor(regionElements) {
    this.regions = regionElements;
  }

  /**
   * Resolve the constraint space for a specific region.
   *
   * @param {number} regionIndex - Zero-based region index
   * @returns {RegionConstraints}
   */
  resolve(regionIndex) {
    const element = this.regions[regionIndex];
    const rect = element.getBoundingClientRect();
    const contentArea = {
      inlineSize: rect.width,
      blockSize: rect.height,
    };

    return new RegionConstraints({
      regionIndex,
      element,
      contentArea,
    });
  }
}
