import { findChildBreakToken } from "../helpers.js";
import { INLINE_TEXT, INLINE_CONTROL, INLINE_OPEN_TAG, INLINE_CLOSE_TAG, INLINE_ATOMIC, BREAK_TOKEN_INLINE, BOX_DECORATION_CLONE } from "../constants.js";

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
 * @param {import("../fragment.js").PhysicalFragment} fragment
 * @param {import("../tokens.js").BreakToken|null} inputBreakToken - break token from the previous fragmentainer
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
    if (node.boxDecorationBreak !== BOX_DECORATION_CLONE) {
      applySliceDecorations(el, inputBreakToken, fragment);
    }
    for (const child of fragment.childFragments) {
      if (!child.node) continue;
      const childInputBT = findChildBreakToken(inputBreakToken, child.node);
      renderFragment(child, childInputBT, el);
    }
    parentEl.appendChild(el);
  } else {
    const el = node.element.cloneNode(true);
    if (node.boxDecorationBreak !== BOX_DECORATION_CLONE) {
      applySliceDecorations(el, inputBreakToken, fragment);
    }
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

  const startOffset = (inputBreakToken && inputBreakToken.type === BREAK_TOKEN_INLINE)
    ? inputBreakToken.textOffset
    : 0;
  const endOffset = (fragment.breakToken && fragment.breakToken.type === BREAK_TOKEN_INLINE)
    ? fragment.breakToken.textOffset
    : data.textContent.length;

  const ws = isAnonymous ? "normal" : getComputedStyle(node.element).whiteSpace;
  const collapseWS = !ws.startsWith("pre");
  const isHyphenated = fragment.breakToken?.isHyphenated ?? false;

  if (isAnonymous) {
    const docFragment = document.createDocumentFragment();
    buildInlineContent(data.items, data.textContent, startOffset, endOffset, docFragment, collapseWS, isHyphenated);
    parentEl.appendChild(docFragment);
  } else {
    const el = node.element.cloneNode(false);
    buildInlineContent(data.items, data.textContent, startOffset, endOffset, el, collapseWS, isHyphenated);
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
  el.style.columns = "auto";
  el.style.columnCount = "auto";
  el.style.columnWidth = "auto";
  el.style.columnGap = "0";
  el.style.columnFill = "initial";
  el.style.display = "flex";
  el.style.flexWrap = "nowrap";
  el.style.alignItems = "flex-start";

  for (let i = 0; i < fragment.childFragments.length; i++) {
    const colFragment = fragment.childFragments[i];

    if (i > 0 && columnGap > 0) {
      const gapEl = document.createElement("div");
      gapEl.style.width = `${columnGap}px`;
      gapEl.style.flexShrink = "0";
      el.appendChild(gapEl);
    }

    const colEl = document.createElement("div");
    colEl.style.width = `${columnWidth}px`;
    colEl.style.height = `${fragment.blockSize}px`;
    colEl.style.overflow = "hidden";
    colEl.style.flexShrink = "0";

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
 * For box-decoration-break: slice (the CSS default), suppress block-start
 * and/or block-end decorations at fragmentainer break edges.
 *
 * The cloned element carries all original CSS styles. This function zeroes
 * out the border/padding that should not appear at break boundaries.
 *
 * @param {{ style: CSSStyleDeclaration }} el - The cloned element
 * @param {import("../tokens.js").BreakToken|null} inputBreakToken - non-null if continuation
 * @param {import("../fragment.js").PhysicalFragment} fragment - the fragment being rendered
 */
export function applySliceDecorations(el, inputBreakToken, fragment) {
  if (inputBreakToken !== null) {
    el.style.borderBlockStart = "none";
    el.style.paddingBlockStart = "0";
  }
  if (fragment.breakToken !== null) {
    el.style.borderBlockEnd = "none";
    el.style.paddingBlockEnd = "0";
  }
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
export function buildInlineContent(items, textContent, startOffset, endOffset, container, collapseWS = false, isHyphenated = false) {
  let current = container;
  const stack = [];
  let lastTextNode = null;

  for (const item of items) {
    if (item.type === INLINE_TEXT) {
      const itemStart = item.startOffset;
      const itemEnd = item.endOffset;

      if (itemEnd <= startOffset) continue;
      if (itemStart >= endOffset) break;

      const visStart = Math.max(itemStart, startOffset);
      const visEnd = Math.min(itemEnd, endOffset);
      let text = textContent.slice(visStart, visEnd);
      // Strip soft hyphens — they are invisible in flowing text
      text = text.replace(/\u00AD/g, "");
      if (collapseWS) text = text.replace(/\s+/g, " ");

      if (text.length > 0) {
        lastTextNode = document.createTextNode(text);
        current.appendChild(lastTextNode);
      }
    } else if (item.type === INLINE_OPEN_TAG) {
      const el = item.element.cloneNode(false);
      current.appendChild(el);
      stack.push(current);
      current = el;
    } else if (item.type === INLINE_CLOSE_TAG) {
      current = stack.pop() || container;
    } else if (item.type === INLINE_CONTROL) {
      if (item.startOffset >= startOffset && item.startOffset < endOffset) {
        current.appendChild(document.createElement("br"));
      }
    } else if (item.type === INLINE_ATOMIC) {
      if (item.startOffset >= startOffset && item.startOffset < endOffset) {
        current.appendChild(item.element.cloneNode(true));
      }
    }
  }

  // Append visible hyphen when the break follows a soft hyphen
  if (isHyphenated) {
    const hyphenChar = resolveHyphenCharacter(container);
    current.appendChild(document.createTextNode(hyphenChar));
  }
}

/**
 * Resolve the visible hyphen character per CSS `hyphenate-character`.
 * Defaults to U+2010 (HYPHEN), matching Chromium's HyphenString() behavior.
 */
function resolveHyphenCharacter(container) {
  if (container.nodeType === Node.ELEMENT_NODE) {
    const val = getComputedStyle(container).hyphenateCharacter;
    if (val && val !== "auto") return val;
  }
  return "\u2010";
}
