import { findChildBreakToken } from '../helpers.js';

/**
 * Check if a fragment has block-level child fragments (not line fragments).
 * Line fragments have node === null.
 */
export function hasBlockChildFragments(fragment) {
  return fragment.childFragments.length > 0 &&
    fragment.childFragments.some(f => f.node !== null);
}

/**
 * Walk a fragment's children and render each into a DocumentFragment.
 *
 * @param {import('../fragment.js').PhysicalFragment} fragment
 * @param {import('../tokens.js').BreakToken|null} inputBreakToken - break token from the previous fragmentainer
 * @returns {DocumentFragment}
 */
export function renderFragmentTree(fragment, inputBreakToken) {
  const docFragment = document.createDocumentFragment();
  for (const child of fragment.childFragments) {
    if (!child.node) continue;
    const childInputBT = findChildBreakToken(inputBreakToken, child.node);
    renderFragment(child, childInputBT, docFragment);
  }
  return docFragment;
}

/**
 * Render a single fragment into the parent element.
 * Routes to the appropriate renderer based on node type.
 */
export function renderFragment(fragment, inputBreakToken, parentEl) {
  if (!fragment.node) return;

  const node = fragment.node;

  if (fragment.multicolData) {
    renderMulticolFragment(fragment, inputBreakToken, parentEl);
  } else if (node.isInlineFormattingContext) {
    renderInlineFragment(fragment, inputBreakToken, parentEl);
  } else if (hasBlockChildFragments(fragment)) {
    const el = node.element.cloneNode(false);
    for (const child of fragment.childFragments) {
      if (!child.node) continue;
      const childInputBT = findChildBreakToken(inputBreakToken, child.node);
      renderFragment(child, childInputBT, el);
    }
    parentEl.appendChild(el);
  } else {
    const el = node.element.cloneNode(true);
    parentEl.appendChild(el);
  }
}

/**
 * Render an inline formatting context fragment.
 * Uses inlineItemsData + break token offsets to reconstruct
 * only the visible portion of the content.
 */
function renderInlineFragment(fragment, inputBreakToken, parentEl) {
  const node = fragment.node;
  const data = node.inlineItemsData;
  const isAnonymous = !node.element;

  if (!data || !data.items || data.items.length === 0) {
    if (!isAnonymous) parentEl.appendChild(node.element.cloneNode(false));
    return;
  }

  const startOffset = (inputBreakToken && inputBreakToken.type === 'inline')
    ? inputBreakToken.textOffset
    : 0;
  const endOffset = (fragment.breakToken && fragment.breakToken.type === 'inline')
    ? fragment.breakToken.textOffset
    : data.textContent.length;

  const ws = isAnonymous ? 'normal' : getComputedStyle(node.element).whiteSpace;
  const collapseWS = !ws.startsWith('pre');

  if (isAnonymous) {
    const docFragment = document.createDocumentFragment();
    buildInlineContent(data.items, data.textContent, startOffset, endOffset, docFragment, collapseWS);
    parentEl.appendChild(docFragment);
  } else {
    const el = node.element.cloneNode(false);
    buildInlineContent(data.items, data.textContent, startOffset, endOffset, el, collapseWS);
    parentEl.appendChild(el);
  }
}

/**
 * Render a multicol container fragment.
 * Clones the element, disables native columns, renders each column
 * child as a flex item with correct width and gap.
 */
function renderMulticolFragment(fragment, inputBreakToken, parentEl) {
  const node = fragment.node;
  const { columnWidth, columnGap } = fragment.multicolData;

  const el = node.element.cloneNode(false);
  el.style.columns = 'auto';
  el.style.columnCount = 'auto';
  el.style.columnWidth = 'auto';
  el.style.columnGap = '0';
  el.style.columnFill = 'initial';
  el.style.display = 'flex';
  el.style.flexWrap = 'nowrap';
  el.style.alignItems = 'flex-start';

  for (let i = 0; i < fragment.childFragments.length; i++) {
    const colFragment = fragment.childFragments[i];

    if (i > 0 && columnGap > 0) {
      const gapEl = document.createElement('div');
      gapEl.style.width = `${columnGap}px`;
      gapEl.style.flexShrink = '0';
      el.appendChild(gapEl);
    }

    const colEl = document.createElement('div');
    colEl.style.width = `${columnWidth}px`;
    colEl.style.height = `${fragment.blockSize}px`;
    colEl.style.overflow = 'hidden';
    colEl.style.flexShrink = '0';

    // Thread break tokens: col 0 uses inputBreakToken, col N uses col N-1's breakToken
    const colInputBT = i === 0 ? inputBreakToken : fragment.childFragments[i - 1].breakToken;

    for (const child of colFragment.childFragments) {
      if (!child.node) continue;
      const childInputBT = findChildBreakToken(colInputBT, child.node);
      renderFragment(child, childInputBT, colEl);
    }

    el.appendChild(colEl);
  }

  parentEl.appendChild(el);
}

/**
 * Build DOM content from inline items within the given text offset range.
 * Reconstructs text nodes, inline elements, <br>s, and atomic inlines
 * for only the visible portion of the content.
 *
 * @param {Object[]} items - InlineItemsData.items array
 * @param {string} textContent - concatenated text string
 * @param {number} startOffset - visible range start (from input break token)
 * @param {number} endOffset - visible range end (from output break token)
 * @param {Element} container - DOM element to append content into
 * @param {boolean} [collapseWS=false] - collapse whitespace runs
 */
export function buildInlineContent(items, textContent, startOffset, endOffset, container, collapseWS = false) {
  let current = container;
  const stack = [];

  for (const item of items) {
    if (item.type === 'kText') {
      const itemStart = item.startOffset;
      const itemEnd = item.endOffset;

      if (itemEnd <= startOffset) continue;
      if (itemStart >= endOffset) break;

      const visStart = Math.max(itemStart, startOffset);
      const visEnd = Math.min(itemEnd, endOffset);
      let text = textContent.slice(visStart, visEnd);
      if (collapseWS) text = text.replace(/\s+/g, ' ');

      if (text.length > 0) {
        current.appendChild(document.createTextNode(text));
      }
    } else if (item.type === 'kOpenTag') {
      const el = item.element.cloneNode(false);
      current.appendChild(el);
      stack.push(current);
      current = el;
    } else if (item.type === 'kCloseTag') {
      current = stack.pop() || container;
    } else if (item.type === 'kControl') {
      if (item.startOffset >= startOffset && item.startOffset < endOffset) {
        current.appendChild(document.createElement('br'));
      }
    } else if (item.type === 'kAtomicInline') {
      if (item.startOffset >= startOffset && item.startOffset < endOffset) {
        current.appendChild(item.element.cloneNode(true));
      }
    }
  }
}
