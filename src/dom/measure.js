import { computedStyleMap } from "./computed-style-map.js";

/**
 * Create a text measurer backed by the DOM Range API.
 *
 * Uses getClientRects() on the live DOM text to read the browser's
 * actual line layout, avoiding re-implementation of line breaking.
 */
export function createRangeMeasurer() {
  const range = document.createRange();

  return {
    /**
     * Measure the width of a substring within a text node.
     */
    measureRange(textNode, startOffset, endOffset) {
      range.setStart(textNode, startOffset);
      range.setEnd(textNode, endOffset);
      return range.getBoundingClientRect().width;
    },

    /**
     * Get the top position of a character at a given offset in a text node.
     * Returns the vertical position from getBoundingClientRect().
     */
    charTop(textNode, offset) {
      const safeEnd = Math.min(offset + 1, textNode.textContent.length);
      if (offset >= safeEnd) return Infinity;
      range.setStart(textNode, offset);
      range.setEnd(textNode, safeEnd);
      const rects = range.getClientRects();
      return rects.length > 0 ? rects[0].top : Infinity;
    },
  };
}

/**
 * Measure the rendered block size (height) of a DOM element.
 */
export function measureElementBlockSize(element) {
  return element.getBoundingClientRect().height;
}

/**
 * Count the number of rendered line boxes in an element using getClientRects().
 *
 * Creates a Range spanning the element's contents and counts distinct
 * vertical positions in the returned rects (one rect per line box).
 *
 * @param {Element} element
 * @returns {number}
 */
export function countLines(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const rects = range.getClientRects();
  if (rects.length === 0) return 0;

  let count = 1;
  let prevTop = rects[0].top;
  for (let i = 1; i < rects.length; i++) {
    if (rects[i].top > prevTop + 0.5) {
      count++;
      prevTop = rects[i].top;
    }
  }
  return count;
}

/**
 * Get the computed line height of an element in pixels.
 */
export function getLineHeight(element) {
  const map = computedStyleMap(element);
  const lh = map.get("line-height");

  // "normal" returns a keyword (no .unit property)
  if (!lh || !lh.unit) {
    const fs = map.get("font-size");
    return ((fs && fs.unit) ? fs.value : 16) * 1.2;
  }

  return lh.value;
}

/**
 * Parse a CSS length value to pixels.
 */
export function parseLength(value, parentSize, fontSize) {
  if (!value || value === "auto" || value === "none") return null;
  if (value.endsWith("px")) return parseFloat(value);
  if (value.endsWith("%")) return (parseFloat(value) / 100) * parentSize;
  if (value.endsWith("rem")) {
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return parseFloat(value) * rootFontSize;
  }
  if (value.endsWith("em")) return parseFloat(value) * fontSize;
  return parseFloat(value) || null;
}
