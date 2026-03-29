import { collectInlineItems, collectInlineItemsFromNodes } from './collect-inlines.js';
import { createRangeMeasurer, measureElementBlockSize, getLineHeight, parseLength } from './measure.js';

const REPLACED_ELEMENTS = new Set([
  'img', 'video', 'canvas', 'iframe', 'embed', 'object', 'svg',
]);

const INLINE_DISPLAYS = new Set([
  'inline', 'inline-block', 'inline-table', 'inline-flex', 'inline-grid',
]);

// Shared Range-based text measurer instance
let sharedRangeMeasurer = null;

/**
 * Lazy wrapper around a DOM Element that implements the LayoutNode interface.
 *
 * Properties are computed on-demand from getComputedStyle() and cached.
 * Does NOT mutate the DOM — read-only measurement only.
 */
export class DOMLayoutNode {
  constructor(element) {
    this.element = element;
    this._style = null;
    this._children = null;
    this._inlineItemsData = null;
    this._isInlineFormattingContext = null;
    this._measurer = null;
  }

  get debugName() {
    const tag = this.element.tagName?.toLowerCase() || 'unknown';
    const id = this.element.id ? `#${this.element.id}` : '';
    const cls = this.element.className
      ? `.${String(this.element.className).split(/\s+/).join('.')}`
      : '';
    return `${tag}${id}${cls}`;
  }

  _getStyle() {
    if (!this._style) {
      this._style = getComputedStyle(this.element);
    }
    return this._style;
  }

  // --- Layout classification ---

  get isReplacedElement() {
    return REPLACED_ELEMENTS.has(this.element.tagName?.toLowerCase());
  }

  get isScrollable() {
    const style = this._getStyle();
    return style.overflowY === 'scroll' || style.overflowY === 'auto' ||
           style.overflowX === 'scroll' || style.overflowX === 'auto';
  }

  get hasOverflowHidden() {
    return this._getStyle().overflow === 'hidden';
  }

  get hasExplicitBlockSize() {
    const h = this._getStyle().height;
    return h !== 'auto' && h !== '' && h !== '0px';
  }

  get isTable() {
    const d = this._getStyle().display;
    return d === 'table' || d === 'inline-table';
  }

  get isTableRow() {
    return this._getStyle().display === 'table-row';
  }

  get isFlexContainer() {
    const d = this._getStyle().display;
    return d === 'flex' || d === 'inline-flex';
  }

  get isGridContainer() {
    const d = this._getStyle().display;
    return d === 'grid' || d === 'inline-grid';
  }

  // --- Flex/Grid properties ---

  get flexDirection() {
    return this._getStyle().flexDirection || 'row';
  }

  get flexWrap() {
    return this._getStyle().flexWrap || 'nowrap';
  }

  get gridRowStart() {
    const val = this._getStyle().gridRowStart;
    return (val && val !== 'auto') ? parseInt(val) : null;
  }

  get gridRowEnd() {
    const val = this._getStyle().gridRowEnd;
    return (val && val !== 'auto') ? parseInt(val) : null;
  }

  // --- Multicol properties ---

  get isMulticolContainer() {
    const style = this._getStyle();
    const colCount = style.columnCount;
    const colWidth = style.columnWidth;
    return (colCount !== 'auto' && parseInt(colCount) > 0) ||
           (colWidth !== 'auto' && colWidth !== 'none');
  }

  get columnCount() {
    const val = this._getStyle().columnCount;
    return (val && val !== 'auto') ? parseInt(val) : null;
  }

  get columnWidth() {
    const val = this._getStyle().columnWidth;
    return (val && val !== 'auto' && val !== 'none') ? parseFloat(val) : null;
  }

  get columnGap() {
    const val = this._getStyle().columnGap;
    if (val === 'normal') return null;
    return parseFloat(val) || 0;
  }

  get columnFill() {
    return this._getStyle().columnFill || 'balance';
  }

  // --- Box model (margins, padding, border) ---

  get marginBlockStart() {
    return parseFloat(this._getStyle().marginTop) || 0;
  }

  get marginBlockEnd() {
    return parseFloat(this._getStyle().marginBottom) || 0;
  }

  get paddingBlockStart() {
    return parseFloat(this._getStyle().paddingTop) || 0;
  }

  get paddingBlockEnd() {
    return parseFloat(this._getStyle().paddingBottom) || 0;
  }

  get borderBlockStart() {
    return parseFloat(this._getStyle().borderTopWidth) || 0;
  }

  get borderBlockEnd() {
    return parseFloat(this._getStyle().borderBottomWidth) || 0;
  }

  // --- Fragmentation CSS ---

  get page() {
    const val = this._getStyle().page;
    return (val && val !== 'auto') ? val : null;
  }

  get breakBefore() {
    return this._getStyle().breakBefore || 'auto';
  }

  get breakAfter() {
    return this._getStyle().breakAfter || 'auto';
  }

  get breakInside() {
    return this._getStyle().breakInside || 'auto';
  }

  get orphans() {
    return parseInt(this._getStyle().orphans) || 2;
  }

  get widows() {
    return parseInt(this._getStyle().widows) || 2;
  }

  // --- Children ---

  get children() {
    if (this._children !== null) return this._children;

    if (this.isInlineFormattingContext) {
      // Inline FC nodes are leaves from the block layout perspective
      this._children = [];
      return this._children;
    }

    // Check for mixed content (inline + block children)
    let hasInline = false;
    let hasBlock = false;
    for (const child of this.element.childNodes) {
      if (isBlockLevelNode(child)) {
        hasBlock = true;
      } else if (isSignificantInlineNode(child)) {
        hasInline = true;
      }
      if (hasInline && hasBlock) break;
    }

    this._children = [];

    if (hasInline && hasBlock) {
      // Mixed content: wrap consecutive inline runs in anonymous blocks
      let inlineGroup = [];
      for (const child of this.element.childNodes) {
        if (isBlockLevelNode(child)) {
          if (inlineGroup.length > 0) {
            this._children.push(new AnonymousBlockNode(this.element, [...inlineGroup]));
            inlineGroup = [];
          }
          this._children.push(new DOMLayoutNode(child));
        } else if (isSignificantInlineNode(child)) {
          inlineGroup.push(child);
        }
      }
      if (inlineGroup.length > 0) {
        this._children.push(new AnonymousBlockNode(this.element, [...inlineGroup]));
      }
    } else {
      // Pure block children
      for (const child of this.element.children) {
        const style = getComputedStyle(child);
        if (style.display === 'none') continue;
        const tag = child.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'template') continue;
        this._children.push(new DOMLayoutNode(child));
      }
    }

    return this._children;
  }

  // --- Block size ---

  get blockSize() {
    return measureElementBlockSize(this.element);
  }

  computedBlockSize(availableInlineSize) {
    const style = this._getStyle();

    if (this.isReplacedElement) {
      return measureElementBlockSize(this.element);
    }

    const h = style.height;
    if (h && h !== 'auto') {
      const fontSize = parseFloat(style.fontSize);
      return parseLength(h, availableInlineSize, fontSize) ?? 0;
    }

    // height: auto — return null to let layout compute from content
    return null;
  }

  // --- Inline formatting context ---

  get isInlineFormattingContext() {
    if (this._isInlineFormattingContext !== null) return this._isInlineFormattingContext;

    // An element is an inline FC if it directly contains text nodes
    // or inline-level elements (and is not replaced/table/etc.)
    if (this.isReplacedElement || this.isTable || this.isTableRow) {
      this._isInlineFormattingContext = false;
      return false;
    }

    let hasInlineContent = false;
    let hasBlockContent = false;

    for (const child of this.element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.textContent.trim().length > 0) {
          hasInlineContent = true;
        }
        continue;
      }
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'br') {
          hasInlineContent = true;
          continue;
        }
        const display = getComputedStyle(child).display;
        if (display === 'none') continue;
        if (INLINE_DISPLAYS.has(display) || display === 'inline') {
          hasInlineContent = true;
        } else {
          hasBlockContent = true;
        }
      }
    }

    // Mixed: if there's inline content, treat as inline FC
    // (real implementation would wrap anonymous blocks)
    this._isInlineFormattingContext = hasInlineContent && !hasBlockContent;
    return this._isInlineFormattingContext;
  }

  get inlineItemsData() {
    if (this._inlineItemsData !== null) return this._inlineItemsData;
    if (!this.isInlineFormattingContext) return null;
    this._inlineItemsData = collectInlineItems(this.element);
    return this._inlineItemsData;
  }

  get lineHeight() {
    return getLineHeight(this.element);
  }

  get measurer() {
    if (!sharedRangeMeasurer) {
      sharedRangeMeasurer = createRangeMeasurer();
    }
    return sharedRangeMeasurer;
  }

  // --- Table row support ---

  get cells() {
    if (!this.isTableRow) return [];
    return this.children;
  }
}

// --- Helpers for mixed content detection ---

const BLOCK_DISPLAYS = new Set([
  'block', 'flex', 'grid', 'table', 'list-item',
  'table-row-group', 'table-header-group', 'table-footer-group',
  'table-row', 'table-cell', 'table-column', 'table-column-group',
  'table-caption',
]);

const SKIP_TAGS = new Set(['script', 'style', 'template']);

function isBlockLevelNode(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const display = getComputedStyle(node).display;
  return BLOCK_DISPLAYS.has(display);
}

function isSignificantInlineNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent.trim().length > 0;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const tag = node.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return false;
    if (tag === 'br') return true;
    const display = getComputedStyle(node).display;
    if (display === 'none') return false;
    return !BLOCK_DISPLAYS.has(display);
  }
  return false;
}

/**
 * Anonymous block box wrapping consecutive inline content in a mixed-content
 * block container (CSS 2.1 §9.2.1.1). Implements the LayoutNode interface
 * with neutral defaults.
 */
export class AnonymousBlockNode {
  constructor(parentElement, childNodes) {
    this._parentElement = parentElement;
    this._childNodes = childNodes;
    this._inlineItemsData = null;
  }

  get debugName() { return '[anon]'; }
  get element() { return null; }
  get isInlineFormattingContext() { return true; }
  get children() { return []; }

  get inlineItemsData() {
    if (!this._inlineItemsData) {
      this._inlineItemsData = collectInlineItemsFromNodes(this._childNodes);
    }
    return this._inlineItemsData;
  }

  get lineHeight() { return getLineHeight(this._parentElement); }

  get measurer() {
    if (!sharedRangeMeasurer) {
      sharedRangeMeasurer = createRangeMeasurer();
    }
    return sharedRangeMeasurer;
  }

  get blockSize() { return 0; }
  computedBlockSize() { return null; }

  // Neutral box model
  get marginBlockStart() { return 0; }
  get marginBlockEnd() { return 0; }
  get paddingBlockStart() { return 0; }
  get paddingBlockEnd() { return 0; }
  get borderBlockStart() { return 0; }
  get borderBlockEnd() { return 0; }

  // No fragmentation properties
  get page() { return null; }
  get breakBefore() { return 'auto'; }
  get breakAfter() { return 'auto'; }
  get breakInside() { return 'auto'; }
  get orphans() { return 2; }
  get widows() { return 2; }

  // Classification
  get isReplacedElement() { return false; }
  get isScrollable() { return false; }
  get hasOverflowHidden() { return false; }
  get hasExplicitBlockSize() { return false; }
  get isTable() { return false; }
  get isTableRow() { return false; }
  get isFlexContainer() { return false; }
  get isGridContainer() { return false; }
  get isMulticolContainer() { return false; }
  get flexDirection() { return 'row'; }
  get flexWrap() { return 'nowrap'; }
  get gridRowStart() { return null; }
  get gridRowEnd() { return null; }
  get columnCount() { return null; }
  get columnWidth() { return null; }
  get columnGap() { return null; }
  get columnFill() { return 'balance'; }
  get cells() { return []; }
}
