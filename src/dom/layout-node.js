import { collectInlineItems } from './collect-inlines.js';
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

    this._children = [];
    for (const child of this.element.children) {
      const style = getComputedStyle(child);
      if (style.display === 'none') continue;
      // Skip script, style, template elements
      const tag = child.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'template') continue;
      this._children.push(new DOMLayoutNode(child));
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
