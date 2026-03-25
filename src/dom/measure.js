/**
 * Create a text measurer backed by a shared CanvasRenderingContext2D.
 * Returns a function: (text, font) => width in px.
 */
export function createTextMeasurer() {
  let canvas = null;
  let ctx = null;
  let cachedFont = '';

  return function measureText(text, font) {
    if (!canvas) {
      canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d');
    }
    if (font !== cachedFont) {
      ctx.font = font;
      cachedFont = font;
    }
    return ctx.measureText(text).width;
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
 * Build the CSS font shorthand from an element's computed style.
 * Used for Canvas measureText.
 */
export function getFont(element) {
  const style = getComputedStyle(element);
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
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
