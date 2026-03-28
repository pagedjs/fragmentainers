/**
 * Create a text measurer backed by the DOM Range API.
 * Measures substrings of live DOM Text nodes, giving pixel-perfect
 * results that account for kerning, ligatures, letter-spacing, etc.
 *
 * Returns an object: { measureRange(textNode, startOffset, endOffset) => width }
 */
export function createRangeMeasurer() {
  const range = document.createRange();

  return {
    measureRange(textNode, startOffset, endOffset) {
      range.setStart(textNode, startOffset);
      range.setEnd(textNode, endOffset);
      return range.getBoundingClientRect().width;
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
