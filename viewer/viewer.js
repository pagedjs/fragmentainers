import { buildLayoutTree } from '../src/dom/index.js';
import { paginateContent } from '../src/driver.js';
import {
  renderFragmentTree,
  getPageSize,
  buildPageElement,
} from '../src/compositor/index.js';

/**
 * Fetch an example HTML file, parse it, and extract CSS + body content.
 */
export async function fetchAndParse(url) {
  const baseURL = url.substring(0, url.lastIndexOf('/') + 1);
  const response = await fetch(url);
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Collect CSS from <style> elements.
  // Each entry is { css, cssBaseURL } so url() paths can be resolved
  // relative to the stylesheet's location, not the HTML document.
  const cssEntries = [];
  for (const style of doc.querySelectorAll('style')) {
    cssEntries.push({ css: style.textContent, cssBaseURL: baseURL });
  }

  // Fetch linked stylesheets
  for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
    const href = link.getAttribute('href');
    if (href) {
      try {
        const cssURL = new URL(href, new URL(url, location.href)).href;
        const cssResponse = await fetch(cssURL);
        const cssBaseURL = cssURL.substring(0, cssURL.lastIndexOf('/') + 1);
        cssEntries.push({ css: await cssResponse.text(), cssBaseURL });
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

  return { bodyHTML, cssEntries, baseURL };
}

/**
 * Inject parsed content and CSS into a container, rebasing relative URLs.
 *
 * When `container` is a <frag-measure> custom element, delegates to its
 * injectContent() method for Shadow DOM isolation. Returns the content root
 * element (the wrapper inside the shadow root, or the container itself for
 * plain div fallback).
 */
export function injectContent({ bodyHTML, cssEntries, baseURL }, container) {
  // Shadow DOM path: <frag-measure> custom element
  if (container.injectContent) {
    return container.injectContent({ bodyHTML, cssEntries, baseURL });
  }

  // Legacy path: plain div container
  const rebasedCSS = cssEntries
    .map(({ css, cssBaseURL }) => css.replace(/url\(\s*['"]?(?!data:|https?:|\/\/)(.*?)['"]?\s*\)/g, (match, path) => {
      return `url('${cssBaseURL}${path}')`;
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

/**
 * Wait for all fonts used by the content to finish loading.
 *
 * document.fonts.ready resolves immediately if no fonts are in the "loading"
 * state. After injecting @font-face CSS + content, the browser must perform a
 * style/layout pass before it discovers which fonts to fetch. We force that
 * pass with offsetHeight, then await document.fonts.ready so layout runs
 * against the final metrics.
 */
export async function waitForFonts(container) {
  // Force style recalc + layout so the browser enqueues font fetches.
  void container.offsetHeight;
  await document.fonts.ready;
}

// ---------------------------------------------------------------------------
// Thumbnail grid and detail overlay (public API)
// ---------------------------------------------------------------------------

/**
 * Render a grid of page thumbnails built from the fragment tree.
 * @param {Object[]} pageSizes - Array of { inlineSize, blockSize } per page
 * @param {Object} [contentStyles] - Content styles for CSS isolation (from FragMeasureElement.getContentStyles)
 */
export async function renderPages(pages, pageSizes, contentStyles, gridContainer, onPageClick) {
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
    const pageEl = await buildPageElement(i, pages, pageSizes, contentStyles);
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
export async function showDetail(pageIndex, pages, pageSizes, contentStyles, overlay) {
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
    showDetail(pageIndex - 1, pages, pageSizes, contentStyles, overlay);
  });

  const pageInfo = document.createElement('span');
  pageInfo.className = 'detail-page-info';
  pageInfo.textContent = `Page ${pageIndex + 1} of ${pages.length} (${size.inlineSize}\u00d7${size.blockSize})`;

  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next \u2192';
  nextBtn.disabled = pageIndex === pages.length - 1;
  nextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showDetail(pageIndex + 1, pages, pageSizes, contentStyles, overlay);
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
  const pageEl = await buildPageElement(pageIndex, pages, pageSizes, contentStyles);
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
      showDetail(pageIndex - 1, pages, pageSizes, contentStyles, overlay);
    }
    if (e.key === 'ArrowRight' && pageIndex < pages.length - 1) {
      showDetail(pageIndex + 1, pages, pageSizes, contentStyles, overlay);
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
