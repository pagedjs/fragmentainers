/**
 * Spec test page processor — injected into test pages via Playwright.
 *
 * Detects whether the page uses @page rules (pagination) or CSS columns
 * (multicol), then runs the library's fragmentation engine accordingly.
 */
import { paginateContent } from '/src/driver.js';
import { buildLayoutTree } from '/src/dom/index.js';
import { renderFragmentTree } from '/src/compositor/render-fragments.js';

async function run() {
  try {
    await document.fonts.ready;
    await doubleRAF();

    // Detect mode: @page rules or multicol containers
    const pageRules = parsePageRules();
    const multicolContainers = findMulticolContainers(document.body);

    if (pageRules) {
      await runPageMode(pageRules);
    } else if (multicolContainers.length > 0) {
      await runMulticolMode(multicolContainers);
    }

    document.documentElement.dataset.specReady = 'true';
  } catch (err) {
    console.error('Spec process error:', err);
    document.documentElement.dataset.specError = err.message + '\n' + err.stack;
    document.documentElement.dataset.specReady = 'true';
  }
}

// ---- Constants ----

// US Letter at 96 CSS px/inch
const LETTER_WIDTH = 816;   // 8.5"
const LETTER_HEIGHT = 1056; // 11"

// ---- Page mode ----

async function runPageMode({ pageWidth, pageHeight, marginTop, marginRight, marginBottom, marginLeft }) {
  const contentWidth = pageWidth - marginLeft - marginRight;
  const contentHeight = pageHeight - marginTop - marginBottom;

  const isLandscape = pageWidth > pageHeight;
  const paperWidth = isLandscape ? LETTER_HEIGHT : LETTER_WIDTH;
  const paperHeight = isLandscape ? LETTER_WIDTH : LETTER_HEIGHT;

  const offsetX = (paperWidth - pageWidth) / 2;
  const offsetY = (paperHeight - pageHeight) / 2;

  const bodyBg = getComputedStyle(document.body).backgroundColor;

  const wrapper = document.createElement('div');
  wrapper.style.width = `${contentWidth}px`;

  while (document.body.firstChild) {
    wrapper.appendChild(document.body.firstChild);
  }

  document.body.style.margin = '0';
  document.body.style.padding = '0';
  document.body.style.background = 'none';
  document.body.appendChild(wrapper);
  await doubleRAF();

  const tree = buildLayoutTree(wrapper);
  const pages = paginateContent(tree, [{
    inlineSize: contentWidth,
    blockSize: contentHeight,
  }]);

  document.body.removeChild(wrapper);

  for (let i = 0; i < pages.length; i++) {
    const paperEl = document.createElement('div');
    paperEl.className = 'spec-page';
    paperEl.dataset.pageIndex = i;
    paperEl.style.width = `${paperWidth}px`;
    paperEl.style.height = `${paperHeight}px`;
    paperEl.style.position = 'relative';
    paperEl.style.overflow = 'hidden';
    paperEl.style.background = '#fff';

    const pageEl = document.createElement('div');
    pageEl.style.position = 'absolute';
    pageEl.style.left = `${offsetX}px`;
    pageEl.style.top = `${offsetY}px`;
    pageEl.style.width = `${pageWidth}px`;
    pageEl.style.height = `${pageHeight}px`;
    pageEl.style.overflow = 'hidden';
    pageEl.style.boxSizing = 'border-box';
    pageEl.style.background = bodyBg;
    pageEl.style.paddingTop = `${marginTop}px`;
    pageEl.style.paddingRight = `${marginRight}px`;
    pageEl.style.paddingBottom = `${marginBottom}px`;
    pageEl.style.paddingLeft = `${marginLeft}px`;

    const contentArea = document.createElement('div');
    contentArea.style.width = `${contentWidth}px`;
    contentArea.style.height = `${contentHeight}px`;
    contentArea.style.overflow = 'hidden';

    const prevBT = i > 0 ? pages[i - 1].breakToken : null;
    contentArea.appendChild(renderFragmentTree(pages[i], prevBT));

    pageEl.appendChild(contentArea);
    paperEl.appendChild(pageEl);
    document.body.appendChild(paperEl);
  }

  document.documentElement.dataset.pageCount = pages.length;
}

// ---- Multicol mode ----

function findMulticolContainers(root) {
  const result = [];
  const all = root.querySelectorAll('*');
  for (const el of all) {
    const style = getComputedStyle(el);
    const colCount = style.columnCount;
    const colWidth = style.columnWidth;
    if ((colCount !== 'auto' && parseInt(colCount) > 0) ||
        (colWidth !== 'auto' && colWidth !== 'none')) {
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
  const columnGapStr = style.columnGap;
  const columnGap = (columnGapStr === 'normal') ? 0 : parseFloat(columnGapStr) || 0;

  const fragmentainerWidth = (totalWidth - (columnCount - 1) * columnGap) / columnCount;
  const fragmentainerHeight = totalHeight;

  if (fragmentainerWidth <= 0 || fragmentainerHeight <= 0) return;

  const wrapper = document.createElement('div');
  wrapper.style.width = `${fragmentainerWidth}px`;

  while (container.firstChild) {
    wrapper.appendChild(container.firstChild);
  }

  container.style.columns = 'auto';
  container.style.columnCount = 'auto';
  container.style.columnWidth = 'auto';
  container.style.columnFill = 'initial';
  container.style.columnGap = '0';

  container.appendChild(wrapper);
  await doubleRAF();

  const tree = buildLayoutTree(wrapper);
  const pages = paginateContent(tree, [{
    inlineSize: fragmentainerWidth,
    blockSize: fragmentainerHeight,
  }]);

  container.innerHTML = '';
  container.style.display = 'flex';
  container.style.flexWrap = 'nowrap';
  container.style.alignItems = 'flex-start';

  for (let i = 0; i < pages.length; i++) {
    if (i > 0 && columnGap > 0) {
      const gapEl = document.createElement('div');
      gapEl.style.width = `${columnGap}px`;
      gapEl.style.flexShrink = '0';
      container.appendChild(gapEl);
    }

    const colEl = document.createElement('div');
    colEl.style.width = `${fragmentainerWidth}px`;
    colEl.style.height = `${fragmentainerHeight}px`;
    colEl.style.overflow = 'hidden';
    colEl.style.flexShrink = '0';

    const prevBT = i > 0 ? pages[i - 1].breakToken : null;
    colEl.appendChild(renderFragmentTree(pages[i], prevBT));
    container.appendChild(colEl);
  }

  await doubleRAF();
}

// ---- @page rule parsing ----

function parsePageRules() {
  let found = false;
  let pageWidth = LETTER_WIDTH;
  let pageHeight = LETTER_HEIGHT;
  let marginTop = 0, marginRight = 0, marginBottom = 0, marginLeft = 0;

  for (const style of document.querySelectorAll('style')) {
    const text = style.textContent;
    const pageMatch = text.match(/@page\s*\{([^}]*)\}/);
    if (!pageMatch) continue;
    found = true;
    const body = pageMatch[1];

    const sizeMatch = body.match(/size\s*:\s*([^;]+)/);
    if (sizeMatch) {
      const parts = sizeMatch[1].trim().split(/\s+/);
      const values = parts.map(parseCSSLength).filter(v => v !== null);
      if (values.length === 1) {
        pageWidth = values[0];
        pageHeight = values[0];
      } else if (values.length >= 2) {
        pageWidth = values[0];
        pageHeight = values[1];
      }
    }

    const marginMatch = body.match(/margin\s*:\s*([^;]+)/);
    if (marginMatch) {
      const parts = marginMatch[1].trim().split(/\s+/);
      const values = parts.map(parseCSSLength).filter(v => v !== null);
      if (values.length === 1) {
        marginTop = marginRight = marginBottom = marginLeft = values[0];
      } else if (values.length === 2) {
        marginTop = marginBottom = values[0];
        marginRight = marginLeft = values[1];
      } else if (values.length === 3) {
        marginTop = values[0];
        marginRight = marginLeft = values[1];
        marginBottom = values[2];
      } else if (values.length >= 4) {
        marginTop = values[0];
        marginRight = values[1];
        marginBottom = values[2];
        marginLeft = values[3];
      }
    }
  }

  if (!found) return null;
  return { pageWidth, pageHeight, marginTop, marginRight, marginBottom, marginLeft };
}

function parseCSSLength(str) {
  const match = str.match(/^([\d.]+)(px|in|cm|mm|pt)?$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = match[2] || 'px';
  switch (unit) {
    case 'px': return value;
    case 'in': return value * 96;
    case 'cm': return value * 96 / 2.54;
    case 'mm': return value * 96 / 25.4;
    case 'pt': return value * 96 / 72;
    default: return value;
  }
}

// ---- Helpers ----

function doubleRAF() {
  return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

// Start processing
run();
