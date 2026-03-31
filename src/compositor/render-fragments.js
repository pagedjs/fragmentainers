import { findChildBreakToken } from "../helpers.js";
import { INLINE_TEXT, INLINE_CONTROL, INLINE_OPEN_TAG, INLINE_CLOSE_TAG, INLINE_ATOMIC, BREAK_TOKEN_INLINE, BOX_DECORATION_CLONE } from "../constants.js";
import { stampNthAttributes } from "../nth-selectors.js";

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
 * @param {Map} [nthFormulas] - formula descriptors from rewriteNthSelectors
 * @param {WeakMap} [sourceRefs] - source element → ref string (stamps data-ref on clones)
 * @returns {DocumentFragment}
 */
export function renderFragmentTree(fragment, inputBreakToken, nthFormulas, sourceRefs) {
  const docFragment = document.createDocumentFragment();
  for (const child of fragment.childFragments) {
    if (!child.node) continue;
    const childInputBT = findChildBreakToken(inputBreakToken, child.node);
    renderFragment(child, childInputBT, docFragment, nthFormulas, sourceRefs);
  }
  return docFragment;
}

/**
 * Render a single fragment into the parent element.
 * Routes to the appropriate renderer based on node type.
 */
export function renderFragment(fragment, inputBreakToken, parentEl, nthFormulas, sourceRefs) {
  if (!fragment.node) return;

  const node = fragment.node;

  if (fragment.multicolData) {
    renderMulticolFragment(fragment, inputBreakToken, parentEl, nthFormulas, sourceRefs);
  } else if (node.isInlineFormattingContext) {
    renderInlineFragment(fragment, inputBreakToken, parentEl, nthFormulas, sourceRefs);
  } else if (hasBlockChildFragments(fragment)) {
    const el = node.element.cloneNode(false);
    stampRef(el, node.element, sourceRefs);
    applySplitAttributes(el, inputBreakToken, fragment);
    if (nthFormulas) stampNthAttributes(el, node, nthFormulas);
    if (inputBreakToken && el.tagName === "OL") {
      applyListContinuation(el, node, inputBreakToken);
    }
    if (node.boxDecorationBreak !== BOX_DECORATION_CLONE) {
      applySliceDecorations(el, inputBreakToken, fragment);
    }
    for (const child of fragment.childFragments) {
      if (!child.node) continue;
      const childInputBT = findChildBreakToken(inputBreakToken, child.node);
      renderFragment(child, childInputBT, el, nthFormulas, sourceRefs);
    }
    // Skip empty container shells — all rendered children were themselves
    // empty and skipped (e.g. an <ol> whose only <li> had no visible text).
    if (el.childNodes.length === 0 && fragment.breakToken) {
      return;
    }
    parentEl.appendChild(el);
  } else if (fragment.childFragments.length === 0 && fragment.breakToken &&
             node.children?.length > 0) {
    // Empty container shell — all children pushed to next fragmentainer.
    // Don't render; content will appear on the next page/column.
    return;
  } else {
    const el = node.element.cloneNode(true);
    stampRefDeep(el, node.element, sourceRefs);
    applySplitAttributes(el, inputBreakToken, fragment);
    if (nthFormulas) stampNthAttributes(el, node, nthFormulas);
    if (node.boxDecorationBreak !== BOX_DECORATION_CLONE) {
      applySliceDecorations(el, inputBreakToken, fragment);
    }

    // Sliced monolithic content: wrap in a clip container and offset
    // by the consumed amount to show the correct portion.
    const consumed = inputBreakToken?.consumedBlockSize || 0;
    if (consumed > 0 || fragment.breakToken) {
      const wrapper = document.createElement("div");
      wrapper.style.height = `${fragment.blockSize}px`;
      wrapper.style.overflow = "hidden";
      if (consumed > 0) {
        el.style.marginTop = `-${consumed}px`;
      }
      wrapper.appendChild(el);
      parentEl.appendChild(wrapper);
    } else {
      parentEl.appendChild(el);
    }
  }
}

/**
 * Render an inline formatting context fragment.
 * Uses inlineItemsData + break token offsets to reconstruct
 * only the visible portion of the content.
 */
function renderInlineFragment(fragment, inputBreakToken, parentEl, nthFormulas, sourceRefs) {
  const node = fragment.node;
  const data = node.inlineItemsData;
  const isAnonymous = !node.element;

  if (!data || !data.items || data.items.length === 0) {
    if (!isAnonymous) {
      const el = node.element.cloneNode(false);
      stampRef(el, node.element, sourceRefs);
      parentEl.appendChild(el);
    }
    return;
  }

  const startOffset = (inputBreakToken && inputBreakToken.type === BREAK_TOKEN_INLINE)
    ? inputBreakToken.textOffset
    : 0;
  const endOffset = (fragment.breakToken && fragment.breakToken.type === BREAK_TOKEN_INLINE)
    ? fragment.breakToken.textOffset
    : data.textContent.length;

  // No visible text in this fragment and content continues on the next
  // fragmentainer — skip rendering to avoid empty element shells (e.g. an
  // <li> that shows only its ::marker with no text).
  if (startOffset >= endOffset && fragment.breakToken) {
    return;
  }

  const ws = isAnonymous ? "normal" : getComputedStyle(node.element).whiteSpace;
  const collapseWS = !ws.startsWith("pre");
  const isHyphenated = fragment.breakToken?.isHyphenated ?? false;

  if (isAnonymous) {
    const docFragment = document.createDocumentFragment();
    buildInlineContent(data.items, data.textContent, startOffset, endOffset, docFragment, collapseWS, isHyphenated);
    parentEl.appendChild(docFragment);
  } else {
    const el = node.element.cloneNode(false);
    stampRef(el, node.element, sourceRefs);
    applySplitAttributes(el, inputBreakToken, fragment);
    if (nthFormulas) stampNthAttributes(el, node, nthFormulas);
    buildInlineContent(data.items, data.textContent, startOffset, endOffset, el, collapseWS, isHyphenated, sourceRefs);
    parentEl.appendChild(el);
  }
}

/**
 * Render a multicol container fragment.
 * Clones the element, disables native columns, renders each column
 * child as a flex item with correct width and gap.
 */
function renderMulticolFragment(fragment, inputBreakToken, parentEl, nthFormulas, sourceRefs) {
  const node = fragment.node;
  const { columnWidth, columnGap } = fragment.multicolData;

  const el = node.element.cloneNode(false);
  stampRef(el, node.element, sourceRefs);
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
      renderFragment(child, childInputBT, colEl, nthFormulas, sourceRefs);
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
/**
 * Mark cloned elements with data-split-from / data-split-to attributes
 * so the override stylesheet can suppress first/last-fragment-only CSS.
 *
 * @param {Element} el - The cloned element
 * @param {import("../tokens.js").BreakToken|null} inputBreakToken - non-null if continuation
 * @param {import("../fragment.js").PhysicalFragment} fragment - the fragment being rendered
 */
function applySplitAttributes(el, inputBreakToken, fragment) {
  if (inputBreakToken) el.setAttribute("data-split-from", "");
  if (fragment.breakToken) {
    el.setAttribute("data-split-to", "");
    if (getComputedStyle(fragment.node.element).textAlign === "justify") {
      el.setAttribute("data-justify-last", "");
    }
  }
}

/**
 * Set the start attribute on a continuation <ol> so list numbering
 * continues from the previous fragment rather than restarting at 1.
 *
 * Uses the break token's child structure to count how many list items
 * were rendered in previous fragments.
 */
function applyListContinuation(el, node, inputBreakToken) {
  const originalStart = parseInt(node.element.getAttribute("start"), 10) || 1;
  const firstChildToken = inputBreakToken.childBreakTokens?.[0];
  if (!firstChildToken) return;

  const childIndex = node.children.indexOf(firstChildToken.node);
  if (childIndex < 0) return;

  // Count <li> items before the resumption point. Non-li children
  // (e.g. <div>, <template>) don't increment the list-item counter.
  let itemCount = 0;
  for (let i = 0; i < childIndex; i++) {
    if (node.children[i].element?.tagName === "LI") itemCount++;
  }

  // A split continuation (not pushed) was partially rendered in the
  // previous fragment — its marker was already shown, so count it.
  // But skip counting if the item produced no visible content (e.g.
  // a zero-height inline fragment where no text fit — the compositor
  // suppresses its rendering, so its marker was never shown).
  if (!firstChildToken.isBreakBefore &&
      node.children[childIndex]?.element?.tagName === "LI") {
    const hadVisibleContent = firstChildToken.type === BREAK_TOKEN_INLINE
      ? firstChildToken.textOffset > 0
      : firstChildToken.consumedBlockSize > 0;
    if (hadVisibleContent) {
      itemCount++;
    }
  }

  el.setAttribute("start", String(originalStart + itemCount));
}

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
export function buildInlineContent(items, textContent, startOffset, endOffset, container, collapseWS = false, _isHyphenated = false, sourceRefs) {
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
      if (collapseWS) text = text.replace(/\s+/g, " ");

      if (text.length > 0) {
        lastTextNode = document.createTextNode(text);
        current.appendChild(lastTextNode);
      }
    } else if (item.type === INLINE_OPEN_TAG) {
      const el = item.element.cloneNode(false);
      stampRef(el, item.element, sourceRefs);
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
        const el = item.element.cloneNode(true);
        stampRefDeep(el, item.element, sourceRefs);
        current.appendChild(el);
      }
    }
  }

  // Trim trailing whitespace at break boundaries — the space before
  // the break is not rendered (it belongs to the inter-word gap).
  if (lastTextNode && endOffset < textContent.length) {
    lastTextNode.textContent = lastTextNode.textContent.replace(/\s+$/, "");
  }

  // Soft hyphens (U+00AD) are preserved in the text — the browser renders
  // them as visible hyphens at line break positions and invisible otherwise.
  // No manual hyphen injection needed.
}

// ---------------------------------------------------------------------------
// Ref stamping — sets data-ref on clones from the source WeakMap
// ---------------------------------------------------------------------------

/**
 * Stamp data-ref on a shallow clone from its source element's ref.
 * No-op when sourceRefs is not provided.
 */
function stampRef(clone, source, sourceRefs) {
  if (!sourceRefs) return;
  const ref = sourceRefs.get(source);
  if (ref !== undefined) clone.setAttribute("data-ref", ref);
}

/**
 * Stamp data-ref on a deep clone and all its descendants.
 * Walks both trees in parallel to match clone children to source children.
 */
function stampRefDeep(clone, source, sourceRefs) {
  if (!sourceRefs) return;
  stampRef(clone, source, sourceRefs);
  const sourceChildren = source.children;
  const cloneChildren = clone.children;
  for (let i = 0; i < sourceChildren.length && i < cloneChildren.length; i++) {
    stampRefDeep(cloneChildren[i], sourceChildren[i], sourceRefs);
  }
}
