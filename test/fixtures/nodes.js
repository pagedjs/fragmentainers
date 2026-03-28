/**
 * Factory functions for creating mock LayoutNode objects.
 * These return plain objects matching the LayoutNode interface
 * expected by the layout algorithms.
 */

const DEFAULTS = {
  children: [],
  blockSize: 0,
  isInlineFormattingContext: false,
  isReplacedElement: false,
  isScrollable: false,
  hasOverflowHidden: false,
  hasExplicitBlockSize: false,
  isTable: false,
  isTableRow: false,
  isFlexContainer: false,
  isGridContainer: false,
  inlineItemsData: null,
  breakBefore: 'auto',
  breakAfter: 'auto',
  breakInside: 'auto',
  orphans: 2,
  widows: 2,
  marginBlockStart: 0,
  marginBlockEnd: 0,
  paddingBlockStart: 0,
  paddingBlockEnd: 0,
  borderBlockStart: 0,
  borderBlockEnd: 0,
};

/**
 * Create a block-level layout node.
 * @param {Object} opts
 * @param {string} [opts.debugName] - Name for debug output
 * @param {number} [opts.blockSize] - Intrinsic block size (for leaf nodes)
 * @param {LayoutNode[]} [opts.children] - Child nodes
 * @param {Object} [opts.overrides] - Any LayoutNode property overrides
 */
export function blockNode({ debugName, blockSize = 0, children = [], ...overrides } = {}) {
  return {
    ...DEFAULTS,
    debugName: debugName || `block(${blockSize})`,
    blockSize,
    children,
    computedBlockSize: () => blockSize,
    ...overrides,
  };
}

/**
 * Create a replaced element (img, video, etc.) — monolithic.
 */
export function replacedNode({ debugName, blockSize = 0, ...overrides } = {}) {
  return blockNode({
    debugName: debugName || `replaced(${blockSize})`,
    blockSize,
    isReplacedElement: true,
    ...overrides,
  });
}

/**
 * Create a scrollable element — monolithic.
 */
export function scrollableNode({ debugName, blockSize = 0, children = [], ...overrides } = {}) {
  return blockNode({
    debugName: debugName || `scrollable(${blockSize})`,
    blockSize,
    children,
    isScrollable: true,
    ...overrides,
  });
}

/**
 * Create a node with inline formatting context.
 * @param {Object} opts
 * @param {Object} opts.inlineItemsData - { items: InlineItem[], textContent: string }
 * @param {number} [opts.lineHeight] - Line height in px
 * @param {Function} [opts.measureText] - (text) => width in px (used to build mock measurer)
 */
export function inlineNode({
  debugName,
  inlineItemsData,
  lineHeight = 20,
  measureText,
  ...overrides
} = {}) {
  const measureFn = measureText || ((text) => text.length * 8); // default: 8px per char
  return {
    ...DEFAULTS,
    debugName: debugName || 'inline',
    isInlineFormattingContext: true,
    inlineItemsData,
    lineHeight,
    measurer: {
      measureRange(textNode, start, end) {
        return measureFn(textNode.textContent.slice(start, end));
      },
    },
    computedBlockSize: () => 0,
    ...overrides,
  };
}

/**
 * Create a table row node with cells.
 * @param {Object} opts
 * @param {LayoutNode[]} opts.cells - Cell nodes
 */
export function tableRowNode({ debugName, cells = [], ...overrides } = {}) {
  return {
    ...DEFAULTS,
    debugName: debugName || 'tr',
    isTableRow: true,
    cells,
    children: cells,
    computedBlockSize: () => 0,
    ...overrides,
  };
}

/**
 * Build InlineItemsData from a simple text string.
 * Splits into kText items per word and inserts kControl for \n.
 * Each kText item includes a mock domNode for Range-based measurement.
 */
export function textToInlineItems(text) {
  const items = [];
  const mockTextNode = { textContent: text };
  let offset = 0;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      if (i > offset) {
        items.push({ type: 'kText', startOffset: offset, endOffset: i, domNode: mockTextNode });
      }
      items.push({ type: 'kControl', startOffset: i, endOffset: i + 1 });
      offset = i + 1;
    }
  }

  if (offset < text.length) {
    items.push({ type: 'kText', startOffset: offset, endOffset: text.length, domNode: mockTextNode });
  }

  return { items, textContent: text };
}
