import { FragmentainerLayout } from "../src/fragmentainer-layout.js";
import { preprocessContent } from "../src/dom/css-utils.js";

export { FragmentainerLayout, preprocessContent };

/**
 * Fetch an example HTML file, parse it, and extract CSS + body content.
 */
export async function fetchAndParse(url) {
  const baseURL = url.substring(0, url.lastIndexOf("/") + 1);
  const response = await fetch(url);
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Collect CSS from <style> elements.
  // Each entry is { css, cssBaseURL } so url() paths can be resolved
  // relative to the stylesheet's location, not the HTML document.
  const cssEntries = [];
  for (const style of doc.querySelectorAll("style")) {
    cssEntries.push({ css: style.textContent, cssBaseURL: baseURL });
  }

  // Fetch linked stylesheets
  for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
    const href = link.getAttribute("href");
    if (href) {
      try {
        const cssURL = new URL(href, new URL(url, location.href)).href;
        const cssResponse = await fetch(cssURL);
        const cssBaseURL = cssURL.substring(0, cssURL.lastIndexOf("/") + 1);
        cssEntries.push({ css: await cssResponse.text(), cssBaseURL });
      } catch (e) {
        console.warn(`Failed to fetch stylesheet: ${href}`, e);
      }
    }
  }

  // Extract body content. Special case: <template id="flow">
  let bodyHTML;
  const template = doc.querySelector("template#flow");
  if (template) {
    bodyHTML = template.innerHTML;
  } else {
    bodyHTML = doc.body.innerHTML;
  }

  return { bodyHTML, cssEntries, baseURL };
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
export async function waitForFonts() {
  await document.fonts.ready;
}

// ---------------------------------------------------------------------------
// Thumbnail grid and detail overlay (public API)
// ---------------------------------------------------------------------------

/**
 * Render a grid of fragmentainer thumbnails built from a FragmentedFlow.
 * @param {import('../src/fragmentainer-layout.js').FragmentedFlow} flow
 * @param {HTMLElement} gridContainer
 * @param {function(number): void} onPageClick
 */
export async function renderPages(flow, gridContainer, onPageClick) {
  gridContainer.innerHTML = "";

  const thumbnailHeight = 220;
  let totalHeight = 0;

  for (let i = 0; i < flow.fragmentainerCount; i++) {
    totalHeight += flow.fragments[i].blockSize;
    const { contentArea } = flow.fragments[i].constraints;
    const scale = thumbnailHeight / contentArea.blockSize;
    const thumbnailWidth = contentArea.inlineSize * scale;

    // Outer wrapper sized to thumbnail dimensions
    const wrapper = document.createElement("div");
    wrapper.className = "page-thumb-wrapper";
    wrapper.style.width = `${thumbnailWidth}px`;
    wrapper.style.height = `${thumbnailHeight}px`;

    // Inner: full-size fragmentainer, scaled via transform
    const pageEl = flow.renderFragmentainer(i);
    pageEl.style.transform = `scale(${scale})`;
    pageEl.style.transformOrigin = "top left";

    wrapper.appendChild(pageEl);

    // Page number
    const label = document.createElement("div");
    label.className = "page-label";
    label.textContent = i + 1;
    wrapper.appendChild(label);

    wrapper.addEventListener("click", () => onPageClick(i));
    gridContainer.appendChild(wrapper);
  }

  return totalHeight;
}

/**
 * Show a single fragmentainer at full size in an overlay.
 * @param {number} fragmentainerIndex
 * @param {import('../src/fragmentainer-layout.js').FragmentedFlow} flow
 * @param {HTMLElement} overlay
 */
export async function showDetail(fragmentainerIndex, flow, overlay) {
  overlay.innerHTML = "";
  overlay.classList.add("active");

  const { contentArea } = flow.fragments[fragmentainerIndex].constraints;

  // Fit to viewport (account for detail-page padding)
  const detailPadding = 20;
  const maxWidth = window.innerWidth - 120 - detailPadding * 2;
  const maxHeight = window.innerHeight - 120 - detailPadding * 2;
  const fitScale = Math.min(
    1,
    maxWidth / contentArea.inlineSize,
    maxHeight / contentArea.blockSize,
  );

  // Backdrop
  const backdrop = document.createElement("div");
  backdrop.className = "detail-backdrop";
  backdrop.addEventListener("click", () => closeDetail(overlay));
  overlay.appendChild(backdrop);

  // Detail container
  const detail = document.createElement("div");
  detail.className = "detail-container";

  // Navigation bar
  const nav = document.createElement("div");
  nav.className = "detail-nav";

  const prevBtn = document.createElement("button");
  prevBtn.textContent = "\u2190 Prev";
  prevBtn.disabled = fragmentainerIndex === 0;
  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showDetail(fragmentainerIndex - 1, flow, overlay);
  });

  const pageInfo = document.createElement("span");
  pageInfo.className = "detail-page-info";
  pageInfo.textContent = `Page ${fragmentainerIndex + 1} of ${flow.fragmentainerCount} (${contentArea.inlineSize}\u00d7${contentArea.blockSize})`;

  const nextBtn = document.createElement("button");
  nextBtn.textContent = "Next \u2192";
  nextBtn.disabled = fragmentainerIndex === flow.fragmentainerCount - 1;
  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showDetail(fragmentainerIndex + 1, flow, overlay);
  });

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "\u2715 Close";
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeDetail(overlay);
  });

  nav.append(prevBtn, pageInfo, nextBtn, closeBtn);
  detail.appendChild(nav);

  // Scaled page wrapper
  const scaleWrapper = document.createElement("div");
  scaleWrapper.classList.add("detail-page");
  scaleWrapper.style.width = `${contentArea.inlineSize * fitScale}px`;
  scaleWrapper.style.height = `${contentArea.blockSize * fitScale}px`;
  scaleWrapper.style.overflow = "hidden";

  // Full-size fragmentainer
  const pageEl = flow.renderFragmentainer(fragmentainerIndex);
  pageEl.style.transform = `scale(${fitScale})`;
  pageEl.style.transformOrigin = "top left";

  scaleWrapper.appendChild(pageEl);
  detail.appendChild(scaleWrapper);
  overlay.appendChild(detail);

  // Keyboard navigation
  overlay._keyHandler = (e) => {
    if (e.key === "Escape") closeDetail(overlay);
    if (e.key === "ArrowLeft" && fragmentainerIndex > 0) {
      showDetail(fragmentainerIndex - 1, flow, overlay);
    }
    if (
      e.key === "ArrowRight" &&
      fragmentainerIndex < flow.fragmentainerCount - 1
    ) {
      showDetail(fragmentainerIndex + 1, flow, overlay);
    }
  };
  document.removeEventListener("keydown", overlay._prevKeyHandler);
  document.addEventListener("keydown", overlay._keyHandler);
  overlay._prevKeyHandler = overlay._keyHandler;
}

function closeDetail(overlay) {
  overlay.classList.remove("active");
  overlay.innerHTML = "";
  if (overlay._prevKeyHandler) {
    document.removeEventListener("keydown", overlay._prevKeyHandler);
  }
}
