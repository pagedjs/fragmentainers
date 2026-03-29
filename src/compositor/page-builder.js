import { renderFragmentTree } from './render-fragments.js';

/**
 * Get the page size for a given page index from a sizes array.
 * Reuses the last entry for pages beyond the array length.
 */
export function getPageSize(pageSizes, pageIndex) {
  return pageSizes[pageIndex] || pageSizes[pageSizes.length - 1];
}

/**
 * Create a page container element and populate it from the fragment tree.
 *
 * @param {number} pageIndex
 * @param {import('../fragment.js').PhysicalFragment[]} pages
 * @param {{ inlineSize: number, blockSize: number }[]} pageSizes
 * @returns {Promise<Element>}
 */
export async function buildPageElement(pageIndex, pages, pageSizes) {
  const page = pages[pageIndex];
  const size = getPageSize(pageSizes, pageIndex);
  const prevBreakToken = pageIndex > 0 ? pages[pageIndex - 1].breakToken : null;

  const pageEl = document.createElement('div');
  pageEl.className = 'page-content';
  pageEl.style.width = `${size.inlineSize}px`;
  pageEl.style.height = `${size.blockSize}px`;
  pageEl.style.overflow = 'hidden';
  pageEl.style.whiteSpace = 'normal';
  pageEl.style.contain = 'strict';

  pageEl.appendChild(renderFragmentTree(page, prevBreakToken));
  return pageEl;
}
