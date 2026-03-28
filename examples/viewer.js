import { buildLayoutTree } from '../src/dom/index.js';
import { paginateContent } from '../src/driver.js';
import { findChildBreakToken } from '../src/helpers.js';

/**
 * Fetch an example HTML file, parse it, and extract CSS + body content.
 */
export async function fetchAndParse(url) {
  const baseURL = url.substring(0, url.lastIndexOf('/') + 1);
  const response = await fetch(url);
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Collect CSS from <style> elements
  const cssTexts = [];
  for (const style of doc.querySelectorAll('style')) {
    cssTexts.push(style.textContent);
  }

  // Fetch linked stylesheets
  for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
    const href = link.getAttribute('href');
    if (href) {
      try {
        const cssURL = new URL(href, new URL(url, location.href)).href;
        const cssResponse = await fetch(cssURL);
        cssTexts.push(await cssResponse.text());
      } catch (e) {
        console.warn(`Failed to fetch stylesheet: ${href}`, e);
      }
    }
  }

  // Extract body content. Special case: <template id="flow">
  let bodyHTML;
  const template = doc.querySelector('template#flow');
  if (template) {
    bodyHTML = template.innerHTML;
  } else {
    bodyHTML = doc.body.innerHTML;
  }

  return { bodyHTML, cssTexts, baseURL };
}

/**
 * Inject parsed content and CSS into a container, rebasing relative URLs.
 */
export function injectContent({ bodyHTML, cssTexts, baseURL }, container) {
  const rebasedCSS = cssTexts
    .map(css => css.replace(/url\(\s*['"]?(?!data:|https?:|\/\/)(.*?)['"]?\s*\)/g, (match, path) => {
      return `url('${baseURL}${path}')`;
    }))
    .join('\n');

  const rebasedHTML = bodyHTML
    .replace(/src\s*=\s*["'](?!data:|https?:|\/\/)(.*?)["']/g, (match, path) => {
      return `src="${baseURL}${path}"`;
    })
    .replace(/href\s*=\s*["'](?!data:|https?:|\/\/|#)(.*?)["']/g, (match, path) => {
      return `href="${baseURL}${path}"`;
    });

  container.innerHTML = `<style>${rebasedCSS}</style>${rebasedHTML}`;
  return container;
}

/**
 * Run the fragmentation engine on a content element.
 */
export function runFragmentation(contentEl, pageSizes) {
  const tree = buildLayoutTree(contentEl);
  console.log("Layout tree:", tree);
  const sizes = Array.isArray(pageSizes) ? pageSizes : [pageSizes];
  const pages = paginateContent(tree, sizes);
  console.log("Pagination result:", pages);
  return pages;
}

// ---------------------------------------------------------------------------
// Fragment-tree rendering
// ---------------------------------------------------------------------------

/**
 * Build a page's DOM by walking the fragment tree.
 * Each fragment's node.element is cloned into the page, preserving
 * DOM hierarchy so CSS selectors continue to match.
 *
 * @param {Object} pageFragment - The root PhysicalFragment for this page
 * @param {Object|null} inputBreakToken - Break token from the PREVIOUS page
 *   (tells us where resumed content starts)
 * @param {Element} pageEl - The page container to render into
 */
async function renderFragmentTree(pageFragment, inputBreakToken, pageEl) {
  for (const child of pageFragment.childFragments) {
    if (!child.node) continue; // skip line fragments (node is null)

    const childInputBT = findChildBreakToken(inputBreakToken, child.node);
    renderFragment(child, childInputBT, pageEl);
    await new Promise(r => requestAnimationFrame(r));
  }
}

/**
 * Render a single fragment into the parent element.
 */
function renderFragment(fragment, inputBreakToken, parentEl) {
  if (!fragment.node) return;

  const node = fragment.node;

  if (node.isInlineFormattingContext) {
    renderInlineFragment(fragment, inputBreakToken, parentEl);
  } else if (hasBlockChildFragments(fragment)) {
    // Block container — shallow clone + recurse into childFragments
    const el = node.element.cloneNode(false);
    for (const child of fragment.childFragments) {
      if (!child.node) continue;
      const childInputBT = findChildBreakToken(inputBreakToken, child.node);
      renderFragment(child, childInputBT, el);
    }
    parentEl.appendChild(el);
  } else {
    // Leaf node (img, hr, empty div, etc.) — full clone
    const el = node.element.cloneNode(true);
    parentEl.appendChild(el);
  }
}

/**
 * Check if a fragment has block-level child fragments (not line fragments).
 */
function hasBlockChildFragments(fragment) {
  return fragment.childFragments.length > 0 &&
    fragment.childFragments.some(f => f.node !== null);
}

/**
 * Render an inline formatting context fragment.
 * Clones the full element then trims text nodes to only include
 * content between startOffset and endOffset.
 */
function renderInlineFragment(fragment, inputBreakToken, parentEl) {
  const node = fragment.node;
  const data = node.inlineItemsData;

  if (!data || !data.items || data.items.length === 0) {
    // No inline content — clone empty element
    parentEl.appendChild(node.element.cloneNode(false));
    return;
  }

  // Determine visible text range from break tokens
  const startOffset = (inputBreakToken && inputBreakToken.type === 'inline')
    ? inputBreakToken.textOffset
    : 0;
  const endOffset = (fragment.breakToken && fragment.breakToken.type === 'inline')
    ? fragment.breakToken.textOffset
    : data.textContent.length;

  // Check white-space on the original element to decide whether to collapse
  const ws = node.element ? getComputedStyle(node.element).whiteSpace : 'normal';
  const collapseWS = !ws.startsWith('pre');

  // Build content from inline items within the visible range
  const el = node.element.cloneNode(false);
  buildInlineContent(data.items, data.textContent, startOffset, endOffset, el, collapseWS);
  parentEl.appendChild(el);
}

/**
 * Build DOM content from inline items within the given text offset range.
 * Reconstructs the DOM structure (text nodes, inline elements, <br>s)
 * for only the visible portion of the content.
 */
function buildInlineContent(items, textContent, startOffset, endOffset, container, collapseWS = false) {
  let current = container;
  const stack = [];

  for (const item of items) {
    if (item.type === 'kText') {
      const itemStart = item.startOffset;
      const itemEnd = item.endOffset;

      // Skip items entirely before visible range
      if (itemEnd <= startOffset) continue;
      // Stop if past visible range
      if (itemStart >= endOffset) break;

      // Get the visible substring
      const visStart = Math.max(itemStart, startOffset);
      const visEnd = Math.min(itemEnd, endOffset);
      let text = textContent.slice(visStart, visEnd);
      if (collapseWS) text = text.replace(/\s+/g, ' ');

      if (text.length > 0) {
        current.appendChild(document.createTextNode(text));
      }
    } else if (item.type === 'kOpenTag') {
      // Always include open tags — empty inline elements are invisible
      const el = item.element.cloneNode(false);
      current.appendChild(el);
      stack.push(current);
      current = el;
    } else if (item.type === 'kCloseTag') {
      current = stack.pop() || container;
    } else if (item.type === 'kControl') {
      // <br> — include if within visible range
      if (item.startOffset >= startOffset && item.startOffset < endOffset) {
        current.appendChild(document.createElement('br'));
      }
    } else if (item.type === 'kAtomicInline') {
      // Inline-block, inline-table, etc. — include if within visible range
      if (item.startOffset >= startOffset && item.startOffset < endOffset) {
        current.appendChild(item.element.cloneNode(true));
      }
    }
  }
}

/**
 * Get the page size for a given page index from a sizes array.
 * Reuses the last entry for pages beyond the array length.
 */
function getPageSize(pageSizes, pageIndex) {
  return pageSizes[pageIndex] || pageSizes[pageSizes.length - 1];
}

/**
 * Create a page container element and populate it from the fragment tree.
 */
async function buildPageElement(pageIndex, pages, pageSizes) {
  const page = pages[pageIndex];
  const size = getPageSize(pageSizes, pageIndex);
  const prevBreakToken = pageIndex > 0 ? pages[pageIndex - 1].breakToken : null;

  const pageEl = document.createElement('div');
  pageEl.className = 'page-content';
  pageEl.style.width = `${size.inlineSize}px`;
  pageEl.style.height = `${size.blockSize}px`;
  pageEl.style.overflow = 'hidden';
  pageEl.style.contain = 'strict';

  await renderFragmentTree(page, prevBreakToken, pageEl);
  return pageEl;
}

// ---------------------------------------------------------------------------
// Thumbnail grid and detail overlay (public API)
// ---------------------------------------------------------------------------

/**
 * Render a grid of page thumbnails built from the fragment tree.
 * @param {Object[]} pageSizes - Array of { inlineSize, blockSize } per page
 */
export async function renderPages(pages, pageSizes, contentEl, gridContainer, onPageClick) {
  gridContainer.innerHTML = '';

  const thumbnailHeight = 220;
  let totalHeight = 0;

  for (let i = 0; i < pages.length; i++) {
    totalHeight += pages[i].blockSize;
    const size = getPageSize(pageSizes, i);
    const scale = thumbnailHeight / size.blockSize;
    const thumbnailWidth = size.inlineSize * scale;

    // Outer wrapper sized to thumbnail dimensions
    const wrapper = document.createElement('div');
    wrapper.className = 'page-thumb-wrapper';
    wrapper.style.width = `${thumbnailWidth}px`;
    wrapper.style.height = `${thumbnailHeight}px`;

    // Inner: full-size page, scaled via transform
    const pageEl = await buildPageElement(i, pages, pageSizes);
    pageEl.style.transform = `scale(${scale})`;
    pageEl.style.transformOrigin = 'top left';

    wrapper.appendChild(pageEl);

    // Page number
    const label = document.createElement('div');
    label.className = 'page-label';
    label.textContent = i + 1;
    wrapper.appendChild(label);

    wrapper.addEventListener('click', () => onPageClick(i));
    gridContainer.appendChild(wrapper);
  }

  return totalHeight;
}

/**
 * Show a single page at full size in an overlay.
 */
export async function showDetail(pageIndex, pages, pageSizes, contentEl, overlay) {
  overlay.innerHTML = '';
  overlay.classList.add('active');

  const size = getPageSize(pageSizes, pageIndex);

  // Fit to viewport
  const maxWidth = window.innerWidth - 120;
  const maxHeight = window.innerHeight - 120;
  const fitScale = Math.min(1, maxWidth / size.inlineSize, maxHeight / size.blockSize);

  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'detail-backdrop';
  backdrop.addEventListener('click', () => closeDetail(overlay));
  overlay.appendChild(backdrop);

  // Detail container
  const detail = document.createElement('div');
  detail.className = 'detail-container';

  // Navigation bar
  const nav = document.createElement('div');
  nav.className = 'detail-nav';

  const prevBtn = document.createElement('button');
  prevBtn.textContent = '\u2190 Prev';
  prevBtn.disabled = pageIndex === 0;
  prevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showDetail(pageIndex - 1, pages, pageSizes, contentEl, overlay);
  });

  const pageInfo = document.createElement('span');
  pageInfo.className = 'detail-page-info';
  pageInfo.textContent = `Page ${pageIndex + 1} of ${pages.length} (${size.inlineSize}\u00d7${size.blockSize})`;

  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next \u2192';
  nextBtn.disabled = pageIndex === pages.length - 1;
  nextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showDetail(pageIndex + 1, pages, pageSizes, contentEl, overlay);
  });

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '\u2715 Close';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeDetail(overlay);
  });

  nav.append(prevBtn, pageInfo, nextBtn, closeBtn);
  detail.appendChild(nav);

  // Scaled page wrapper
  const scaleWrapper = document.createElement('div');
  scaleWrapper.style.width = `${size.inlineSize * fitScale}px`;
  scaleWrapper.style.height = `${size.blockSize * fitScale}px`;
  scaleWrapper.style.overflow = 'hidden';
  scaleWrapper.style.margin = '0 auto';

  // Full-size page
  const pageEl = await buildPageElement(pageIndex, pages, pageSizes);
  pageEl.classList.add('detail-page');
  pageEl.style.transform = `scale(${fitScale})`;
  pageEl.style.transformOrigin = 'top left';

  scaleWrapper.appendChild(pageEl);
  detail.appendChild(scaleWrapper);
  overlay.appendChild(detail);

  // Keyboard navigation
  overlay._keyHandler = (e) => {
    if (e.key === 'Escape') closeDetail(overlay);
    if (e.key === 'ArrowLeft' && pageIndex > 0) {
      showDetail(pageIndex - 1, pages, pageSizes, contentEl, overlay);
    }
    if (e.key === 'ArrowRight' && pageIndex < pages.length - 1) {
      showDetail(pageIndex + 1, pages, pageSizes, contentEl, overlay);
    }
  };
  document.removeEventListener('keydown', overlay._prevKeyHandler);
  document.addEventListener('keydown', overlay._keyHandler);
  overlay._prevKeyHandler = overlay._keyHandler;
}

function closeDetail(overlay) {
  overlay.classList.remove('active');
  overlay.innerHTML = '';
  if (overlay._prevKeyHandler) {
    document.removeEventListener('keydown', overlay._prevKeyHandler);
  }
}
