import { DOMLayoutNode } from './layout-node.js';

export { DOMLayoutNode } from './layout-node.js';
export { collectInlineItems } from './collect-inlines.js';
export { createRangeMeasurer, measureElementBlockSize, getLineHeight, parseLength } from './measure.js';
export { ContentMeasureElement, FragmentContainerElement } from './frag-measure.js';

/**
 * Build a layout tree from a DOM element.
 * Returns a DOMLayoutNode wrapping the root — the main entry point
 * for DOM integration.
 *
 * Properties are resolved lazily during layout traversal.
 *
 * @param {Element} rootElement
 * @returns {DOMLayoutNode}
 */
export function buildLayoutTree(rootElement) {
  return new DOMLayoutNode(rootElement);
}
