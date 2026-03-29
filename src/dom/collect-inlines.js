import { INLINE_TEXT, INLINE_CONTROL, INLINE_OPEN_TAG, INLINE_CLOSE_TAG, INLINE_ATOMIC } from "../constants.js";

/**
 * Walk DOM inline content and build a flat InlineItemsData structure.
 *
 * Collects text nodes, inline elements, and <br> elements into
 * the format expected by layoutInlineContent.
 *
 * @param {Element} element
 * @returns {{ items: Object[], textContent: string }}
 */
export function collectInlineItems(element) {
  const items = [];
  const textParts = [];
  let offset = 0;

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const content = node.textContent;
      if (content.length > 0) {
        items.push({
          type: INLINE_TEXT,
          startOffset: offset,
          endOffset: offset + content.length,
          domNode: node,
        });
        textParts.push(content);
        offset += content.length;
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = /** @type {Element} */ (node);
    const tagName = el.tagName.toLowerCase();

    // <br> → forced line break
    if (tagName === "br") {
      items.push({
        type: INLINE_CONTROL,
        startOffset: offset,
        endOffset: offset + 1,
        domNode: el,
      });
      textParts.push("\n");
      offset += 1;
      return;
    }

    // Skip non-visual elements
    const display = getComputedStyle(el).display;
    if (display === "none") return;

    const isInline = display === "inline";
    const isAtomicInline = display === "inline-block" || display === "inline-table";

    if (isAtomicInline) {
      // Atomic inline — treated as a single unit
      items.push({
        type: INLINE_ATOMIC,
        startOffset: offset,
        endOffset: offset + 1,
        element: el,
      });
      textParts.push("\uFFFC"); // Object replacement character
      offset += 1;
      return;
    }

    if (isInline) {
      items.push({ type: INLINE_OPEN_TAG, element: el });
      for (const child of el.childNodes) {
        walk(child);
      }
      items.push({ type: INLINE_CLOSE_TAG, element: el });
      return;
    }

    // Block-level child inside inline context — treat as atomic
    items.push({
      type: INLINE_ATOMIC,
      startOffset: offset,
      endOffset: offset + 1,
      element: el,
    });
    textParts.push("\uFFFC");
    offset += 1;
  }

  for (const child of element.childNodes) {
    walk(child);
  }

  return { items, textContent: textParts.join("") };
}

/**
 * Collect inline items from a specific list of DOM nodes (for anonymous blocks).
 *
 * @param {Node[]} nodes
 * @returns {{ items: Object[], textContent: string }}
 */
export function collectInlineItemsFromNodes(nodes) {
  const items = [];
  const textParts = [];
  let offset = 0;

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const content = node.textContent;
      if (content.length > 0) {
        items.push({
          type: INLINE_TEXT,
          startOffset: offset,
          endOffset: offset + content.length,
          domNode: node,
        });
        textParts.push(content);
        offset += content.length;
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = /** @type {Element} */ (node);
    const tagName = el.tagName.toLowerCase();

    if (tagName === "br") {
      items.push({
        type: INLINE_CONTROL,
        startOffset: offset,
        endOffset: offset + 1,
        domNode: el,
      });
      textParts.push("\n");
      offset += 1;
      return;
    }

    const display = getComputedStyle(el).display;
    if (display === "none") return;

    const isInline = display === "inline";
    const isAtomicInline = display === "inline-block" || display === "inline-table";

    if (isAtomicInline) {
      items.push({
        type: INLINE_ATOMIC,
        startOffset: offset,
        endOffset: offset + 1,
        element: el,
      });
      textParts.push("\uFFFC");
      offset += 1;
      return;
    }

    if (isInline) {
      items.push({ type: INLINE_OPEN_TAG, element: el });
      for (const child of el.childNodes) {
        walk(child);
      }
      items.push({ type: INLINE_CLOSE_TAG, element: el });
      return;
    }

    items.push({
      type: INLINE_ATOMIC,
      startOffset: offset,
      endOffset: offset + 1,
      element: el,
    });
    textParts.push("\uFFFC");
    offset += 1;
  }

  for (const node of nodes) {
    walk(node);
  }

  return { items, textContent: textParts.join("") };
}
