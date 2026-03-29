/**
 * Spec test page processor — injected into test pages via Playwright.
 *
 * Detects whether the page uses @page rules (pagination) or CSS columns
 * (multicol), then runs the library's fragmentation engine accordingly.
 */
import { createFragments } from '/src/driver.js';
import { ConstraintSpace } from '/src/constraint-space.js';
import { buildLayoutTree } from '/src/dom/index.js';
import { renderFragmentTree } from '/src/compositor/render-fragments.js';
import { PageSizeResolver, parsePageRulesFromStyleSheets } from '/src/page-rules.js';

async function run() {
  try {
    await document.fonts.ready;
    await doubleRAF();

    // Detect mode: @page rules or multicol containers
    const pageRules = parsePageRulesFromStyleSheets(document.querySelectorAll('style'));
    const multicolContainers = findMulticolContainers(document.body);

    if (pageRules.length > 0) {
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

async function runPageMode(pageRules) {
  const DEFAULT_SIZE = { inlineSize: LETTER_WIDTH, blockSize: LETTER_HEIGHT };
  const resolver = new PageSizeResolver(pageRules, DEFAULT_SIZE);

  // Use the first page's resolved constraints for measurement width
  const firstConstraints = resolver.resolve(0, null, null);
  const measureWidth = firstConstraints.contentArea.inlineSize;

  const bodyBg = getComputedStyle(document.body).backgroundColor;

  const wrapper = document.createElement('div');
  wrapper.style.width = `${measureWidth}px`;

  while (document.body.firstChild) {
    wrapper.appendChild(document.body.firstChild);
  }

  document.body.style.margin = '0';
  document.body.style.padding = '0';
  document.body.style.background = 'none';
  document.body.appendChild(wrapper);
  await doubleRAF();

  const tree = buildLayoutTree(wrapper);
  const fragments = createFragments(tree, resolver);

  document.body.removeChild(wrapper);

  for (let i = 0; i < fragments.length; i++) {
    const constraints = fragments[i].constraints;
    const { pageBoxSize, margins, contentArea } = constraints;

    const isLandscape = pageBoxSize.inlineSize > pageBoxSize.blockSize;
    const paperWidth = isLandscape ? LETTER_HEIGHT : LETTER_WIDTH;
    const paperHeight = isLandscape ? LETTER_WIDTH : LETTER_HEIGHT;

    const offsetX = (paperWidth - pageBoxSize.inlineSize) / 2;
    const offsetY = (paperHeight - pageBoxSize.blockSize) / 2;

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
    pageEl.style.width = `${pageBoxSize.inlineSize}px`;
    pageEl.style.height = `${pageBoxSize.blockSize}px`;
    pageEl.style.overflow = 'hidden';
    pageEl.style.boxSizing = 'border-box';
    pageEl.style.background = bodyBg;
    pageEl.style.paddingTop = `${margins.top}px`;
    pageEl.style.paddingRight = `${margins.right}px`;
    pageEl.style.paddingBottom = `${margins.bottom}px`;
    pageEl.style.paddingLeft = `${margins.left}px`;

    const contentEl = document.createElement('div');
    contentEl.style.width = `${contentArea.inlineSize}px`;
    contentEl.style.height = `${contentArea.blockSize}px`;
    contentEl.style.overflow = 'hidden';

    const prevBT = i > 0 ? fragments[i - 1].breakToken : null;
    contentEl.appendChild(renderFragmentTree(fragments[i], prevBT));

    pageEl.appendChild(contentEl);
    paperEl.appendChild(pageEl);
    document.body.appendChild(paperEl);
  }

  document.documentElement.dataset.pageCount = fragments.length;
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
  const fragments = createFragments(tree, new ConstraintSpace({
    availableInlineSize: fragmentainerWidth,
    availableBlockSize: fragmentainerHeight,
    fragmentainerBlockSize: fragmentainerHeight,
    fragmentationType: 'column',
  }));

  container.innerHTML = '';
  container.style.display = 'flex';
  container.style.flexWrap = 'nowrap';
  container.style.alignItems = 'flex-start';

  for (let i = 0; i < fragments.length; i++) {
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

    const prevBT = i > 0 ? fragments[i - 1].breakToken : null;
    colEl.appendChild(renderFragmentTree(fragments[i], prevBT));
    container.appendChild(colEl);
  }

  await doubleRAF();
}

// ---- Helpers ----

function doubleRAF() {
  return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

// Start processing
run();
