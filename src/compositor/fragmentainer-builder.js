import { renderFragmentTree } from "./render-fragments.js";

/**
 * Get the fragmentainer size for a given index.
 * When constraints are available on the fragment (from PageSizeResolver),
 * returns the content area. Otherwise falls back to the fragmentainerSizes array.
 *
 * @param {{ inlineSize: number, blockSize: number }[]} fragmentainerSizes
 * @param {number} fragmentainerIndex
 * @param {import('../fragment.js').PhysicalFragment[]} [fragments]
 * @returns {{ inlineSize: number, blockSize: number }}
 */
export function getFragmentainerSize(fragmentainerSizes, fragmentainerIndex, fragments) {
  if (fragments?.[fragmentainerIndex]?.constraints) {
    return fragments[fragmentainerIndex].constraints.contentArea;
  }
  return fragmentainerSizes[fragmentainerIndex] || fragmentainerSizes[fragmentainerSizes.length - 1];
}

/**
 * Create a <fragment-container> element and populate it from the fragment tree.
 *
 * @param {number} fragmentainerIndex
 * @param {import('../fragment.js').PhysicalFragment[]} fragments
 * @param {{ inlineSize: number, blockSize: number }[]} fragmentainerSizes
 * @param {{ sheets: CSSStyleSheet[], cssText: string }} [contentStyles] — when omitted, styles are copied from the document
 * @returns {Promise<Element>}
 */
export async function buildFragmentainerElement(fragmentainerIndex, fragments, fragmentainerSizes, contentStyles) {
  const fragment = fragments[fragmentainerIndex];
  const size = getFragmentainerSize(fragmentainerSizes, fragmentainerIndex);
  const prevBreakToken = fragmentainerIndex > 0 ? fragments[fragmentainerIndex - 1].breakToken : null;

  const fragEl = document.createElement("fragment-container");
  fragEl.style.width = `${size.inlineSize}px`;
  fragEl.style.height = `${size.blockSize}px`;
  fragEl.style.overflow = "hidden";

  const counterSnapshot = fragmentainerIndex > 0
    ? fragments[fragmentainerIndex - 1].counterState
    : null;
  const wrapper = fragEl.setupForRendering(contentStyles, counterSnapshot);
  wrapper.appendChild(renderFragmentTree(fragment, prevBreakToken, fragEl.nthFormulas));
  fragEl.expectedBlockSize = size.blockSize;
  return fragEl;
}
