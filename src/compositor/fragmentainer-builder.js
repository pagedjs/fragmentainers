import { renderFragmentTree } from "./render-fragments.js";
import { buildPerFragmentNthSheet } from "../styles/nth-selectors.js";
import { DEFAULT_OVERFLOW_THRESHOLD } from "../core/constants.js";

/**
 * Get the fragmentainer size for a given index.
 * When constraints are available on the fragment (from PageResolver),
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
  fragEl.fragmentIndex = fragmentainerIndex;
  fragEl.pageConstraints = fragment.constraints;
  fragEl.namedPage = fragment.constraints?.namedPage ?? null;
  fragEl.style.width = `${size.inlineSize}px`;
  fragEl.style.height = `${size.blockSize}px`;
  fragEl.style.overflow = "hidden";

  const counterSnapshot = fragmentainerIndex > 0
    ? fragments[fragmentainerIndex - 1].counterState
    : null;

  if (fragment.isBlank) {
    fragEl.setupForRendering(contentStyles, counterSnapshot);
    fragEl.setAttribute("data-blank-page", "");
    fragEl.expectedBlockSize = size.blockSize;
    fragEl.overflowThreshold = 0;
    return fragEl;
  }

  const wrapper = fragEl.setupForRendering(contentStyles, counterSnapshot);
  wrapper.appendChild(renderFragmentTree(fragment, prevBreakToken, contentStyles?.sourceRefs));

  // Build and adopt a per-fragment nth-selector override stylesheet
  const nthDescriptors = contentStyles?.nthDescriptors;
  const refMap = contentStyles?.refMap;
  if (nthDescriptors?.length > 0 && refMap) {
    const nthSheet = buildPerFragmentNthSheet(wrapper, nthDescriptors, refMap);
    if (nthSheet) fragEl.adoptNthSheet(nthSheet);
  }

  fragEl.expectedBlockSize = size.blockSize;
  fragEl.overflowThreshold = fragment.node?.lineHeight || DEFAULT_OVERFLOW_THRESHOLD;
  return fragEl;
}
