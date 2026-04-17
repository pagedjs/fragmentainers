import { collectInlineItems } from "../measurement/collect-inlines.js";
import { measureElementBlockSize, measureCellIntrinsicBlockSize } from "../measurement/block-size.js";
import { getLineHeight, getSharedMeasurer, measureLines } from "../measurement/line-box.js";
import { computedStyleMap } from "../styles/computed-style-map.js";
import { buildCumulativeHeights } from "./layout-helpers.js";
import { AnonymousBlockNode } from "./anonymous-block-node.js";
import { LayoutNode } from "./layout-node-base.js";

// Box decoration break (node.boxDecorationBreak)
export const BOX_DECORATION_SLICE = "slice";
export const BOX_DECORATION_CLONE = "clone";

const REPLACED_ELEMENTS = new Set(["img", "video", "canvas", "iframe", "embed", "object", "svg"]);

const INLINE_DISPLAYS = new Set([
	"inline",
	"inline-block",
	"inline-table",
	"inline-flex",
	"inline-grid",
]);

/**
 * Lazy wrapper around a DOM Element that implements the LayoutNode interface.
 *
 * Read-only: resolves computed styles on demand via CSS Typed OM and caches
 * the results. Does not mutate the DOM.
 */

// `.toString()` fallback covers properties Chromium under-reifies (e.g.
// `border-block-*-width`), which come back as bare CSSStyleValue.
function cssPx(value) {
	if (!value) return 0;
	if (value.unit === "px") return value.value;
	return parseFloat(value.toString()) || 0;
}

function cssKeyword(value, fallback) {
	if (!value) return fallback;
	return typeof value.value === "string" ? value.value : value.toString();
}

export class DOMLayoutNode extends LayoutNode {
	#element;
	#styleMap = null;
	#children = null;
	#inlineItemsData = null;
	#isInlineFormattingContext = null;
	#blockSizeCache = null;
	#intrinsicBlockSizeCache = null;
	#cumulativeHeights = null;
	#display = null;
	#textAlign = null;
	#whiteSpace = null;
	#marginBlockStart = null;
	#marginBlockEnd = null;
	#paddingBlockStart = null;
	#paddingBlockEnd = null;
	#borderBlockStart = null;
	#borderBlockEnd = null;
	#lineHeightCache = null;
	#borderSpacingBlock = undefined;
	#breakBeforeOverride = null;
	#pageOverride = undefined;

	constructor(element) {
		super();
		this.#element = element;
	}

	get element() {
		return this.#element;
	}

	get debugName() {
		const tag = this.element.tagName?.toLowerCase() || "unknown";
		const id = this.element.id ? `#${this.element.id}` : "";
		const cls = this.element.className
			? `.${String(this.element.className).split(/\s+/).join(".")}`
			: "";
		return `${tag}${id}${cls}`;
	}

	#getStyleMap() {
		if (!this.#styleMap && this.element.isConnected) {
			this.#styleMap = computedStyleMap(this.element);
			const map = this.#styleMap;
			this.#display = cssKeyword(map.get("display"), "block");
			this.#textAlign = cssKeyword(map.get("text-align"), "start");
			this.#whiteSpace = cssKeyword(map.get("white-space"), "normal");
			this.#marginBlockStart = cssPx(map.get("margin-block-start"));
			this.#marginBlockEnd = cssPx(map.get("margin-block-end"));
			this.#paddingBlockStart = cssPx(map.get("padding-block-start"));
			this.#paddingBlockEnd = cssPx(map.get("padding-block-end"));
			this.#borderBlockStart = cssPx(map.get("border-block-start-width"));
			this.#borderBlockEnd = cssPx(map.get("border-block-end-width"));
		}
		return this.#styleMap || computedStyleMap(this.element);
	}

	getCustomProperty(name) {
		const v = this.#getStyleMap().get(`--${name}`);
		if (!v) return null;
		const s = typeof v.value === "string" ? v.value : v.toString();
		return s.trim() || null;
	}

	get position() {
		return cssKeyword(this.#getStyleMap().get("position"), "static");
	}

	//Layout classification

	get isReplacedElement() {
		return REPLACED_ELEMENTS.has(this.element.tagName?.toLowerCase());
	}

	get isScrollable() {
		const map = this.#getStyleMap();
		const oy = cssKeyword(map.get("overflow-y"), "visible");
		const ox = cssKeyword(map.get("overflow-x"), "visible");
		return oy === "scroll" || oy === "auto" || ox === "scroll" || ox === "auto";
	}

	get hasOverflowHidden() {
		return cssKeyword(this.#getStyleMap().get("overflow"), "visible") === "hidden";
	}

	get hasExplicitBlockSize() {
		const h = this.#getStyleMap().get("height");
		if (!h) return false;
		if (h.unit === "px") return h.value !== 0;
		return cssKeyword(h, "auto") !== "auto";
	}

	get display() {
		if (this.#display === null) this.#getStyleMap();
		return this.#display ?? "block";
	}

	get isTable() {
		const d = this.display;
		return d === "table" || d === "inline-table";
	}

	get isTableRow() {
		return this.display === "table-row";
	}

	get isTableHeaderGroup() {
		return this.display === "table-header-group";
	}

	get isTableSection() {
		const d = this.display;
		return d === "table-row-group" || d === "table-header-group" || d === "table-footer-group";
	}

	get isTableCell() {
		return this.display === "table-cell";
	}

	/**
	 * Vertical border-spacing for tables using the separated borders model.
	 * Returns the table's vertical spacing value for table and table-section
	 * nodes; 0 for everything else and for border-collapse: collapse tables.
	 */
	get borderSpacingBlock() {
		if (this.#borderSpacingBlock !== undefined) return this.#borderSpacingBlock;
		const el = this.isTable
			? this.element
			: this.isTableSection
				? this.element.closest("table")
				: null;
		if (!el) {
			this.#borderSpacingBlock = 0;
			return 0;
		}
		const style = getComputedStyle(el);
		if (style.borderCollapse === "collapse") {
			this.#borderSpacingBlock = 0;
			return 0;
		}
		const val = style.borderSpacing || "";
		const parts = val.split(/\s+/);
		this.#borderSpacingBlock = parseFloat(parts.length >= 2 ? parts[1] : parts[0]) || 0;
		return this.#borderSpacingBlock;
	}

	get isFlexContainer() {
		const d = this.display;
		return d === "flex" || d === "inline-flex";
	}

	get isGridContainer() {
		const d = this.display;
		return d === "grid" || d === "inline-grid";
	}

	//Flex/Grid properties

	get flexDirection() {
		return cssKeyword(this.#getStyleMap().get("flex-direction"), "row");
	}

	get flexWrap() {
		return cssKeyword(this.#getStyleMap().get("flex-wrap"), "nowrap");
	}

	get gridRowStart() {
		const v = this.#getStyleMap().get("grid-row-start");
		if (!v) return null;
		if (v.unit) return v.value;
		// Chromium Typed OM returns CSSStyleValue (no .unit) for grid line numbers
		const n = parseInt(v.toString(), 10);
		return Number.isFinite(n) ? n : null;
	}

	get gridRowEnd() {
		const v = this.#getStyleMap().get("grid-row-end");
		if (!v) return null;
		if (v.unit) return v.value;
		const n = parseInt(v.toString(), 10);
		return Number.isFinite(n) ? n : null;
	}

	//Multicol properties

	get isMulticolContainer() {
		const map = this.#getStyleMap();
		const cc = map.get("column-count");
		const cw = map.get("column-width");
		return (cc && cc.unit && cc.value > 0) || (cw && cw.unit !== undefined);
	}

	get columnCount() {
		const v = this.#getStyleMap().get("column-count");
		return v && v.unit ? v.value : null;
	}

	get columnWidth() {
		const v = this.#getStyleMap().get("column-width");
		return v && v.unit ? v.value : null;
	}

	get columnGap() {
		const v = this.#getStyleMap().get("column-gap");
		return v && v.unit ? v.value : null;
	}

	get columnFill() {
		return cssKeyword(this.#getStyleMap().get("column-fill"), "balance");
	}

	//Box model (margins, padding, border)

	get marginBlockStart() {
		if (this.#marginBlockStart === null) this.#getStyleMap();
		return this.#marginBlockStart ?? 0;
	}

	get marginBlockEnd() {
		if (this.#marginBlockEnd === null) this.#getStyleMap();
		return this.#marginBlockEnd ?? 0;
	}

	/**
	 * CSS2 §8.3.1: last child's margin-end that collapses through this
	 * element when it has no block-end border or padding.
	 */
	get collapsedMarginBlockEnd() {
		if (this.paddingBlockEnd === 0 && this.borderBlockEnd === 0) {
			const children = this.children;
			const last = children[children.length - 1];
			if (last) return last.marginBlockEnd;
		}
		return 0;
	}

	get paddingBlockStart() {
		if (this.#paddingBlockStart === null) this.#getStyleMap();
		return this.#paddingBlockStart ?? 0;
	}

	get paddingBlockEnd() {
		if (this.#paddingBlockEnd === null) this.#getStyleMap();
		return this.#paddingBlockEnd ?? 0;
	}

	get borderBlockStart() {
		if (this.#borderBlockStart === null) this.#getStyleMap();
		return this.#borderBlockStart ?? 0;
	}

	get borderBlockEnd() {
		if (this.#borderBlockEnd === null) this.#getStyleMap();
		return this.#borderBlockEnd ?? 0;
	}

	//Fragmentation CSS

	get page() {
		if (this.#pageOverride !== undefined) return this.#pageOverride;
		const val = cssKeyword(this.#getStyleMap().get("page"), "auto");
		return val && val !== "auto" ? val : null;
	}

	set page(value) {
		this.#pageOverride = value;
	}

	get breakBefore() {
		if (this.#breakBeforeOverride !== null) return this.#breakBeforeOverride;
		return cssKeyword(this.#getStyleMap().get("break-before"), "auto");
	}

	set breakBefore(value) {
		this.#breakBeforeOverride = value;
	}

	get breakAfter() {
		return cssKeyword(this.#getStyleMap().get("break-after"), "auto");
	}

	get breakInside() {
		return cssKeyword(this.#getStyleMap().get("break-inside"), "auto");
	}

	get boxDecorationBreak() {
		return cssKeyword(this.#getStyleMap().get("box-decoration-break"), BOX_DECORATION_SLICE);
	}

	get orphans() {
		const v = this.#getStyleMap().get("orphans");
		return v && v.unit ? v.value : 2;
	}

	get widows() {
		const v = this.#getStyleMap().get("widows");
		return v && v.unit ? v.value : 2;
	}

	//Counters

	get counterReset() {
		return cssKeyword(this.#getStyleMap().get("counter-reset"), "none");
	}
	get counterIncrement() {
		return cssKeyword(this.#getStyleMap().get("counter-increment"), "none");
	}

	//Compositor-accessed styles (snapshot values so they survive detachment)

	get textAlign() {
		if (this.#textAlign === null) this.#getStyleMap();
		return this.#textAlign ?? "start";
	}

	get whiteSpace() {
		if (this.#whiteSpace === null) this.#getStyleMap();
		return this.#whiteSpace ?? "normal";
	}

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

	setChildren(children) {
		this.#children = children;
		this.#cumulativeHeights = null;
	}

	//Block size

	get blockSize() {
		if (this.#blockSizeCache !== null) return this.#blockSizeCache;
		return measureElementBlockSize(this.element);
	}

	setBlockSizeCache(value) {
		this.#blockSizeCache = value;
	}

	/**
	 * Intrinsic content-based block size — unaffected by table-row stretching.
	 * For non-cells, equivalent to blockSize (the browser-measured rect).
	 * For table cells, measures actual content since getBoundingClientRect()
	 * reports the row-stretched height rather than intrinsic content.
	 */
	get intrinsicBlockSize() {
		if (!this.isTableCell) return this.blockSize;
		if (this.#intrinsicBlockSizeCache !== null) return this.#intrinsicBlockSizeCache;
		this.#intrinsicBlockSizeCache = measureCellIntrinsicBlockSize(this.element);
		return this.#intrinsicBlockSizeCache;
	}

	/** @type {Float64Array|null} Prefix sum of child block sizes (lazy, >= 20 children) */
	get cumulativeHeights() {
		if (this.#cumulativeHeights === null && this.children.length >= 20) {
			this.#cumulativeHeights = buildCumulativeHeights(this);
		}
		return this.#cumulativeHeights;
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

	/**
	 * Block-direction border-box size from computed style, normalized for
	 * `box-sizing`. Returns null when `height` is auto.
	 *
	 * Prefer this over `blockSize` when an explicit CSS height is expected:
	 * it reads from the cached style snapshot, avoiding the forced reflow
	 * from `getBoundingClientRect()`.
	 */
	borderBoxBlockSize() {
		const cssHeight = this.computedBlockSize();
		if (cssHeight == null) return null;
		// Replaced elements: measureElementBlockSize already yields border-box.
		if (this.isReplacedElement) return cssHeight;
		if (cssKeyword(this.#getStyleMap().get("box-sizing"), "content-box") === "border-box")
			return cssHeight;
		return (
			cssHeight +
			this.paddingBlockStart +
			this.paddingBlockEnd +
			this.borderBlockStart +
			this.borderBlockEnd
		);
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
		this.#inlineItemsData = collectInlineItems(this.element.childNodes);
		return this.#inlineItemsData;
	}

	get lineHeight() {
		if (this.#lineHeightCache !== null) return this.#lineHeightCache;
		this.#lineHeightCache = getLineHeight(this.element);
		return this.#lineHeightCache;
	}

	get measurer() {
		return getSharedMeasurer();
	}

	measureLines() {
		return measureLines(this.element);
	}

	//Table row support

	get cells() {
		if (!this.isTableRow) return [];
		return this.children;
	}
}

// Helpers for mixed content detection

const BLOCK_DISPLAYS = new Set([
	"block",
	"flex",
	"grid",
	"table",
	"list-item",
	"table-row-group",
	"table-header-group",
	"table-footer-group",
	"table-row",
	"table-cell",
	"table-caption",
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

