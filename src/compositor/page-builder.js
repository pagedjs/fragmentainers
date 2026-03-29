import { renderFragmentTree } from './render-fragments.js';

/**
 * Get the page size for a given page index from a sizes array.
 * Reuses the last entry for pages beyond the array length.
 */
export function getPageSize(pageSizes, pageIndex) {
  return pageSizes[pageIndex] || pageSizes[pageSizes.length - 1];
}

/**
 * Create a <fragment-container> page element and populate it from the fragment tree.
 *
 * @param {number} pageIndex
 * @param {import('../fragment.js').PhysicalFragment[]} pages
 * @param {{ inlineSize: number, blockSize: number }[]} pageSizes
 * @param {{ sheets: CSSStyleSheet[], cssText: string }} [contentStyles] — when omitted, styles are copied from the document
 * @returns {Promise<Element>}
 */
export async function buildPageElement(pageIndex, pages, pageSizes, contentStyles) {
  const page = pages[pageIndex];
  const size = getPageSize(pageSizes, pageIndex);
  const prevBreakToken = pageIndex > 0 ? pages[pageIndex - 1].breakToken : null;

  const fragEl = document.createElement('fragment-container');
  fragEl.style.width = `${size.inlineSize}px`;
  fragEl.style.height = `${size.blockSize}px`;
  fragEl.style.overflow = 'hidden';

  const wrapper = fragEl.setupForRendering(contentStyles);
  wrapper.appendChild(renderFragmentTree(page, prevBreakToken));
  return fragEl;
}
