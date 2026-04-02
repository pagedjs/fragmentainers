/**
 * Spec test page processor — injected into test pages via Playwright.
 *
 * Detects whether the page uses @page rules (pagination) or CSS columns
 * (multicol), then runs the library's fragmentation engine accordingly.
 */
import { FragmentainerLayout } from "/src/core/fragmentainer-layout.js";
import { ConstraintSpace } from "/src/core/constraint-space.js";
import { buildLayoutTree } from "/src/dom/index.js";
import { createFragments } from "/src/core/layout-request.js";
import { renderFragmentTree } from "/src/compositor/render-fragments.js";
import { PageResolver } from "/src/atpage/page-resolver.js";
import "/src/dom/fragment-container.js";

const SAVE_REF = location.hash === "#ref";

async function run() {
  try {
    await document.fonts.ready;

    const resolver = PageResolver.fromDocument();
    const multicolContainers = findMulticolContainers(document.body);

    if (resolver.pageRules.length > 0) {
      await runPageMode(resolver);
    } else if (multicolContainers.length > 0) {
      await runMulticolMode(multicolContainers);
    }

    document.documentElement.dataset.specReady = "true";
  } catch (err) {
    console.error("Spec process error:", err);
    document.documentElement.dataset.specError = err.message + "\n" + err.stack;
    document.documentElement.dataset.specReady = "true";
  }
}

// ---- Page mode ----

async function runPageMode(resolver) {
  const frag = document.createDocumentFragment();
  while (document.body.firstChild) {
    frag.appendChild(document.body.firstChild);
  }

  document.body.style.margin = "0";
  document.body.style.padding = "0";
  document.body.style.background = "none";

  const styles = collectConstructedSheets();
  const layout = new FragmentainerLayout(frag, { resolver, styles });
  const flow = await layout.flow();

  const pages = [];

  // Render each page sized to the full page box, with @page margins
  // as padding (matching the reference HTML pattern).
  for (let i = 0; i < flow.fragmentainerCount; i++) {
    const { pageBoxSize, margins } = flow.fragments[i].constraints;
    const fragEl = flow.renderFragmentainer(i);
    fragEl.className = "spec-page";
    fragEl.dataset.pageIndex = i;
    fragEl.style.width = `${pageBoxSize.inlineSize}px`;
    fragEl.style.height = `${pageBoxSize.blockSize}px`;
    fragEl.style.boxSizing = "border-box";
    fragEl.style.paddingTop = `${margins.top}px`;
    fragEl.style.paddingRight = `${margins.right}px`;
    fragEl.style.paddingBottom = `${margins.bottom}px`;
    fragEl.style.paddingLeft = `${margins.left}px`;
    document.body.appendChild(fragEl);

    if (SAVE_REF) {
      pages.push({ pageBoxSize, margins, html: fragEl.contentRoot.innerHTML });
    }
  }

  document.documentElement.dataset.pageCount = String(flow.fragmentainerCount);

  if (SAVE_REF) {
    document.documentElement.dataset.refHtml = buildRefHtml(pages);
  }
}

// ---- Multicol mode ----

function findMulticolContainers(root) {
  const result = [];
  for (const el of root.querySelectorAll("*")) {
    const style = getComputedStyle(el);
    if (
      (style.columnCount !== "auto" && parseInt(style.columnCount) > 0) ||
      (style.columnWidth !== "auto" && style.columnWidth !== "none")
    ) {
      result.push(el);
    }
  }
  return result;
}

async function runMulticolMode(containers) {
  for (const container of containers) {
    await processMulticol(container);
  }
}

async function processMulticol(container) {
  const style = getComputedStyle(container);

  const totalWidth = container.clientWidth;
  const totalHeight = container.clientHeight;
  const columnCount = parseInt(style.columnCount) || 1;
  const columnGap =
    style.columnGap === "normal" ? 0 : parseFloat(style.columnGap) || 0;

  const columnWidth =
    (totalWidth - (columnCount - 1) * columnGap) / columnCount;

  if (columnWidth <= 0 || totalHeight <= 0) return;

  const wrapper = document.createElement("div");
  wrapper.style.width = `${columnWidth}px`;

  while (container.firstChild) {
    wrapper.appendChild(container.firstChild);
  }

  container.style.columns = "auto";
  container.style.columnCount = "auto";
  container.style.columnWidth = "auto";
  container.style.columnFill = "initial";
  container.style.columnGap = "0";

  container.appendChild(wrapper);

  const tree = buildLayoutTree(wrapper);
  const fragments = createFragments(
    tree,
    new ConstraintSpace({
      availableInlineSize: columnWidth,
      availableBlockSize: totalHeight,
      fragmentainerBlockSize: totalHeight,
      fragmentationType: "column",
    }),
  );

  container.innerHTML = "";
  container.style.display = "flex";
  container.style.flexWrap = "nowrap";
  container.style.alignItems = "flex-start";
  container.style.gap = `${columnGap}px`;

  for (let i = 0; i < fragments.length; i++) {
    const colEl = document.createElement("div");
    colEl.style.width = `${columnWidth}px`;
    colEl.style.height = `${totalHeight}px`;
    colEl.style.overflow = "hidden";
    colEl.style.flexShrink = "0";

    const prevBT = i > 0 ? fragments[i - 1].breakToken : null;
    colEl.appendChild(renderFragmentTree(fragments[i], prevBT));
    container.appendChild(colEl);
  }
}

/**
 * Convert document stylesheets into constructed CSSStyleSheets
 * so they can be adopted into shadow roots.
 */
function collectConstructedSheets() {
  const sheets = [];
  for (const sheet of document.styleSheets) {
    try {
      const constructed = new CSSStyleSheet();
      let css = "";
      for (const rule of sheet.cssRules) {
        css += rule.cssText + "\n";
      }
      constructed.replaceSync(css);
      sheets.push(constructed);
    } catch {
      // Cross-origin sheets can't be read — skip
    }
  }
  return sheets;
}

// ---- Ref HTML generation ----

/**
 * Collect CSS text from all document stylesheets, excluding @page rules.
 */
function collectStylesWithoutPageRules() {
  const lines = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.type === CSSRule.PAGE_RULE) continue;
        lines.push(rule.cssText);
      }
    } catch {
      // Cross-origin sheets can't be read — skip
    }
  }
  return lines.join("\n  ");
}

const SPLIT_OVERRIDES = `
  /* Split element overrides (matches compositor shadow DOM) */
  [data-split-from] {
    text-indent: unset !important;
    margin-block-start: unset !important;
    padding-block-start: unset !important;
    initial-letter: unset !important;
    counter-increment: unset !important;
    counter-set: unset !important;
  }
  [data-split-from]:not(ol) {
    counter-reset: unset !important;
  }
  [data-split-from]::first-letter {
    color: unset !important;
    font-size: unset !important;
    font-weight: unset !important;
    font-family: unset !important;
    line-height: unset !important;
    float: unset !important;
    padding: unset !important;
    margin: unset !important;
  }
  [data-split-from]::before {
    content: unset !important;
  }
  li[data-split-from]:first-of-type {
    list-style: none !important;
  }
  [data-split-to] {
    margin-block-end: unset !important;
    padding-block-end: unset !important;
  }
  [data-split-to][data-justify-last] {
    text-align-last: justify !important;
  }
  [data-split-to]::after {
    content: unset !important;
  }`;

/**
 * Build a static reference HTML document from rendered pages.
 * Uses .page/.body wrapper pattern matching existing ref files.
 *
 * @param {{ pageBoxSize: { inlineSize: number, blockSize: number }, margins: object, html: string }[]} pages
 * @returns {string}
 */
function buildRefHtml(pages) {
  const contentStyles = collectStylesWithoutPageRules();

  // Collect unique page sizes for .page CSS rules
  const pageSizes = new Map();
  for (const { pageBoxSize, margins } of pages) {
    const key = `${pageBoxSize.inlineSize},${pageBoxSize.blockSize},${margins.top},${margins.right},${margins.bottom},${margins.left}`;
    if (!pageSizes.has(key)) {
      pageSizes.set(key, { pageBoxSize, margins });
    }
  }

  // Build .page rule(s) — use the first (most common) size
  const { pageBoxSize, margins } = pageSizes.values().next().value;
  const pageRule = `.page {
    width: ${pageBoxSize.inlineSize}px;
    height: ${pageBoxSize.blockSize}px;
    padding: ${margins.top}px ${margins.right}px ${margins.bottom}px ${margins.left}px;
    box-sizing: border-box;
    overflow: hidden;
    display: flex;
    flex-shrink: 0;
  }`;

  const pageHtml = pages
    .map(({ html }) =>
      `<section class="page">\n  <section class="body">\n${html}\n  </section>\n</section>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<style>
  body {
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
  }
  ${pageRule}
  .body {
    flex-grow: 1;
  }

  /* Test styles */
  ${contentStyles}
${SPLIT_OVERRIDES}
</style>
${pageHtml}
`;
}

// Start processing
run();
