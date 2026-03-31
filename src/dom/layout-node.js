import { collectInlineItems, collectInlineItemsFromNodes } from "./collect-inlines.js";
import { createRangeMeasurer, measureElementBlockSize, getLineHeight } from "./measure.js";
import { computedStyleMap } from "./computed-style-map.js";
import { BOX_DECORATION_SLICE } from "../constants.js";

const REPLACED_ELEMENTS = new Set([
  "img", "video", "canvas", "iframe", "embed", "object", "svg",
]);

const INLINE_DISPLAYS = new Set([
  "inline", "inline-block", "inline-table", "inline-flex", "inline-grid",
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
  #style = null;
  #styleMap = null;
  #children = null;
  #inlineItemsData = null;
  #isInlineFormattingContext = null;

  constructor(element) {
    this.element = element;
  }

  get debugName() {
    const tag = this.element.tagName?.toLowerCase() || "unknown";
    const id = this.element.id ? `#${this.element.id}` : "";
    const cls = this.element.className
      ? `.${String(this.element.className).split(/\s+/).join(".")}`
      : "";
    return `${tag}${id}${cls}`;
  }

  #getStyle() {
    if (!this.#style) {
      this.#style = getComputedStyle(this.element);
    }
    return this.#style;
  }

  #getStyleMap() {
    if (!this.#styleMap) {
      this.#styleMap = computedStyleMap(this.element);
    }
    return this.#styleMap;
  }

  //Layout classification

  get isReplacedElement() {
    return REPLACED_ELEMENTS.has(this.element.tagName?.toLowerCase());
  }

  get isScrollable() {
    const style = this.#getStyle();
    return style.overflowY === "scroll" || style.overflowY === "auto" ||
           style.overflowX === "scroll" || style.overflowX === "auto";
  }

  get hasOverflowHidden() {
    return this.#getStyle().overflow === "hidden";
  }

  get hasExplicitBlockSize() {
    const h = this.#getStyle().height;
    return h !== "auto" && h !== "" && h !== "0px";
  }

  get isTable() {
    const d = this.#getStyle().display;
    return d === "table" || d === "inline-table";
  }

  get isTableRow() {
    return this.#getStyle().display === "table-row";
  }

  get isFlexContainer() {
    const d = this.#getStyle().display;
    return d === "flex" || d === "inline-flex";
  }

  get isGridContainer() {
    const d = this.#getStyle().display;
    return d === "grid" || d === "inline-grid";
  }

  //Flex/Grid properties

  get flexDirection() {
    return this.#getStyle().flexDirection || "row";
  }

  get flexWrap() {
    return this.#getStyle().flexWrap || "nowrap";
  }

  get gridRowStart() {
    const v = this.#getStyleMap().get("grid-row-start");
    return (v && v.unit) ? v.value : null;
  }

  get gridRowEnd() {
    const v = this.#getStyleMap().get("grid-row-end");
    return (v && v.unit) ? v.value : null;
  }

  //Multicol properties

  get isMulticolContainer() {
    const map = this.#getStyleMap();
    const cc = map.get("column-count");
    const cw = map.get("column-width");
    return (cc && cc.unit && cc.value > 0) ||
           (cw && cw.unit !== undefined);
  }

  get columnCount() {
    const v = this.#getStyleMap().get("column-count");
    return (v && v.unit) ? v.value : null;
  }

  get columnWidth() {
    const v = this.#getStyleMap().get("column-width");
    return (v && v.unit) ? v.value : null;
  }

  get columnGap() {
    const v = this.#getStyleMap().get("column-gap");
    return (v && v.unit) ? v.value : null;
  }

  get columnFill() {
    return this.#getStyle().columnFill || "balance";
  }

  //Box model (margins, padding, border)

  get marginBlockStart() {
    const v = this.#getStyleMap().get("margin-top");
    return (v && v.unit) ? v.value : 0;
  }

  get marginBlockEnd() {
    const v = this.#getStyleMap().get("margin-bottom");
    return (v && v.unit) ? v.value : 0;
  }

  get paddingBlockStart() {
    const v = this.#getStyleMap().get("padding-top");
    return (v && v.unit) ? v.value : 0;
  }

  get paddingBlockEnd() {
    const v = this.#getStyleMap().get("padding-bottom");
    return (v && v.unit) ? v.value : 0;
  }

  get borderBlockStart() {
    const v = this.#getStyleMap().get("border-top-width");
    return (v && v.unit) ? v.value : 0;
  }

  get borderBlockEnd() {
    const v = this.#getStyleMap().get("border-bottom-width");
    return (v && v.unit) ? v.value : 0;
  }

  //Fragmentation CSS

  get page() {
    const val = this.#getStyle().page;
    return (val && val !== "auto") ? val : null;
  }

  get breakBefore() {
    return this.#getStyle().breakBefore || "auto";
  }

  get breakAfter() {
    return this.#getStyle().breakAfter || "auto";
  }

  get breakInside() {
    return this.#getStyle().breakInside || "auto";
  }

  get boxDecorationBreak() {
    return this.#getStyle().boxDecorationBreak || BOX_DECORATION_SLICE;
  }

  get orphans() {
    const v = this.#getStyleMap().get("orphans");
    return (v && v.unit) ? v.value : 2;
  }

  get widows() {
    const v = this.#getStyleMap().get("widows");
    return (v && v.unit) ? v.value : 2;
  }

  //Counters

  get counterReset() { return this.#getStyle().counterReset || "none"; }
  get counterIncrement() { return this.#getStyle().counterIncrement || "none"; }

  //Children

  get children() {
    if (this.#children !== null) return this.#children;

    if (this.isInlineFormattingContext) {
      // Inline FC nodes are leaves from the block layout perspective
      this.#children = [];
      return this.#children;
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

    this.#children = [];

    if (hasInline && hasBlock) {
      // Mixed content: wrap consecutive inline runs in anonymous blocks
      let inlineGroup = [];
      for (const child of this.element.childNodes) {
        if (isBlockLevelNode(child)) {
          if (inlineGroup.length > 0) {
            this.#children.push(new AnonymousBlockNode(this.element, [...inlineGroup]));
            inlineGroup = [];
          }
          this.#children.push(new DOMLayoutNode(child));
        } else if (isSignificantInlineNode(child)) {
          inlineGroup.push(child);
        }
      }
      if (inlineGroup.length > 0) {
        this.#children.push(new AnonymousBlockNode(this.element, [...inlineGroup]));
      }
    } else {
      // Pure block children
      for (const child of this.element.children) {
        const tag = child.tagName.toLowerCase();
        if (SKIP_TAGS.has(tag)) continue;
        const display = getComputedStyle(child).display;
        if (display === "none" || SKIP_DISPLAYS.has(display)) continue;
        this.#children.push(new DOMLayoutNode(child));
      }
    }

    return this.#children;
  }

  //Block size

  get blockSize() {
    return measureElementBlockSize(this.element);
  }

  computedBlockSize(_availableInlineSize) {
    if (this.isReplacedElement) {
      return measureElementBlockSize(this.element);
    }

    const map = this.#getStyleMap();
    const h = map.get("height");
    if (h && h.unit) {
      // Resolved length — use directly
      return h.value;
    }

    // height: auto (keyword) — return null to let layout compute from content
    return null;
  }

  //Inline formatting context

  get isInlineFormattingContext() {
    if (this.#isInlineFormattingContext !== null) return this.#isInlineFormattingContext;

    // An element is an inline FC if it directly contains text nodes
    // or inline-level elements (and is not replaced/table/etc.)
    if (this.isReplacedElement || this.isTable || this.isTableRow) {
      this.#isInlineFormattingContext = false;
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
        if (tag === "br") {
          hasInlineContent = true;
          continue;
        }
        const display = getComputedStyle(child).display;
        if (display === "none") continue;
        if (INLINE_DISPLAYS.has(display) || display === "inline") {
          hasInlineContent = true;
        } else {
          hasBlockContent = true;
        }
      }
    }

    // Mixed: if there's inline content, treat as inline FC
    // (real implementation would wrap anonymous blocks)
    this.#isInlineFormattingContext = hasInlineContent && !hasBlockContent;
    return this.#isInlineFormattingContext;
  }

  get inlineItemsData() {
    if (this.#inlineItemsData !== null) return this.#inlineItemsData;
    if (!this.isInlineFormattingContext) return null;
    this.#inlineItemsData = collectInlineItems(this.element);
    return this.#inlineItemsData;
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

  //Table row support

  get cells() {
    if (!this.isTableRow) return [];
    return this.children;
  }
}

// Helpers for mixed content detection

const BLOCK_DISPLAYS = new Set([
  "block", "flex", "grid", "table", "list-item",
  "table-row-group", "table-header-group", "table-footer-group",
  "table-row", "table-cell", "table-caption",
]);

// Display types that don't participate in content flow — skipped during
// children enumeration. <colgroup>/<col> are styling-only and have no
// rendered block size, but getBoundingClientRect reports the table's height.
const SKIP_DISPLAYS = new Set(["table-column", "table-column-group", "none"]);

const SKIP_TAGS = new Set(["script", "style", "template"]);

function isBlockLevelNode(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const display = getComputedStyle(node).display;
  if (SKIP_DISPLAYS.has(display)) return false;
  return BLOCK_DISPLAYS.has(display);
}

function isSignificantInlineNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent.trim().length > 0;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const tag = node.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return false;
    if (tag === "br") return true;
    const display = getComputedStyle(node).display;
    if (display === "none" || SKIP_DISPLAYS.has(display)) return false;
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
  #parentElement;
  #childNodes;
  #inlineItemsData = null;

  constructor(parentElement, childNodes) {
    this.#parentElement = parentElement;
    this.#childNodes = childNodes;
  }

  get debugName() { return "[anon]"; }
  get element() { return null; }
  get isInlineFormattingContext() { return true; }
  get children() { return []; }

  get inlineItemsData() {
    if (!this.#inlineItemsData) {
      this.#inlineItemsData = collectInlineItemsFromNodes(this.#childNodes);
    }
    return this.#inlineItemsData;
  }

  get lineHeight() { return getLineHeight(this.#parentElement); }

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
  get breakBefore() { return "auto"; }
  get breakAfter() { return "auto"; }
  get breakInside() { return "auto"; }
  get boxDecorationBreak() { return BOX_DECORATION_SLICE; }
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
  get flexDirection() { return "row"; }
  get flexWrap() { return "nowrap"; }
  get gridRowStart() { return null; }
  get gridRowEnd() { return null; }
  get columnCount() { return null; }
  get columnWidth() { return null; }
  get columnGap() { return null; }
  get columnFill() { return "balance"; }
  get cells() { return []; }

  // Counters
  get counterReset() { return "none"; }
  get counterIncrement() { return "none"; }
}
