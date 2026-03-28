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
 * Get the computed line height of an element in pixels.
 */
export function getLineHeight(element) {
  const style = getComputedStyle(element);
  const lineHeight = style.lineHeight;
  if (lineHeight === 'normal') {
    return parseFloat(style.fontSize) * 1.2;
  }
  return parseFloat(lineHeight);
}

/**
 * Parse a CSS length value to pixels.
 */
export function parseLength(value, parentSize, fontSize) {
  if (!value || value === 'auto' || value === 'none') return null;
  if (value.endsWith('px')) return parseFloat(value);
  if (value.endsWith('%')) return (parseFloat(value) / 100) * parentSize;
  if (value.endsWith('em')) return parseFloat(value) * fontSize;
  if (value.endsWith('rem')) {
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return parseFloat(value) * rootFontSize;
  }
  return parseFloat(value) || null;
}
