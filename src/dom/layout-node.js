import { collectInlineItems } from "./collect-inlines.js";
import {
	createRangeMeasurer,
	createCaretMeasurer,
	measureElementBlockSize,
	getLineHeight,
} from "./measure.js";
import { computedStyleMap } from "./computed-style-map.js";
import { BOX_DECORATION_SLICE } from "../core/constants.js";
import { buildCumulativeHeights } from "../core/speculative-layout.js";

const REPLACED_ELEMENTS = new Set(["img", "video", "canvas", "iframe", "embed", "object", "svg"]);

const INLINE_DISPLAYS = new Set([
	"inline",
	"inline-block",
	"inline-table",
	"inline-flex",
	"inline-grid",
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
	#blockSizeCache = null;
	#cumulativeHeights = null;
	#display = null;
	#textAlign = null;
	#whiteSpace = null;
	#lineHeightCache = null;
	#borderSpacingBlock = undefined;
	#breakBeforeOverride = null;
	#pageOverride = undefined;

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
			// Snapshot values that survive element detachment. The live
			// CSSStyleDeclaration goes empty when the element is removed
			// from the DOM, so these must be captured while attached.
			this.#display = this.#style.display || "block";
			this.#textAlign = this.#style.textAlign || "start";
			this.#whiteSpace = this.#style.whiteSpace || "normal";
		}
		return this.#style;
	}

	getCustomProperty(name) {
		return this.#getStyle().getPropertyValue(`--${name}`).trim() || null;
	}

	get position() {
		return this.#getStyle().position || "static";
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
		return (
			style.overflowY === "scroll" ||
			style.overflowY === "auto" ||
			style.overflowX === "scroll" ||
			style.overflowX === "auto"
		);
	}

	get hasOverflowHidden() {
		return this.#getStyle().overflow === "hidden";
	}

	get hasExplicitBlockSize() {
		const h = this.#getStyle().height;
		return h !== "auto" && h !== "" && h !== "0px";
	}

	get display() {
		if (this.#display === null) this.#getStyle();
		return this.#display;
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

	/**
	 * Vertical border-spacing for tables using the separated borders model.
	 * Returns the table's vertical spacing value for table and table-section
	 * nodes; 0 for everything else and for border-collapse: collapse tables.
	 */
	get borderSpacingBlock() {
		if (this.#borderSpacingBlock !== undefined) return this.#borderSpacingBlock;
		const el = this.isTable ? this.element
			: this.isTableSection ? this.element.closest("table")
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
		return this.#getStyle().flexDirection || "row";
	}

	get flexWrap() {
		return this.#getStyle().flexWrap || "nowrap";
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
		return this.#getStyle().columnFill || "balance";
	}

	//Box model (margins, padding, border)

	get marginBlockStart() {
		const v = this.#getStyleMap().get("margin-top");
		return v && v.unit ? v.value : 0;
	}

	get marginBlockEnd() {
		const v = this.#getStyleMap().get("margin-bottom");
		return v && v.unit ? v.value : 0;
	}

	/**
	 * CSS2 §8.3.1: first child's margin-start that collapses through this
	 * element when it has no block-start border or padding. Returns 0 when
	 * the margin doesn't collapse through (parent has border/padding).
	 */
	get collapsedMarginBlockStart() {
		if (this.paddingBlockStart === 0 && this.borderBlockStart === 0) {
			const first = this.children[0];
			if (first) return first.marginBlockStart;
		}
		return 0;
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
		const v = this.#getStyleMap().get("padding-top");
		return v && v.unit ? v.value : 0;
	}

	get paddingBlockEnd() {
		const v = this.#getStyleMap().get("padding-bottom");
		return v && v.unit ? v.value : 0;
	}

	get borderBlockStart() {
		const v = this.#getStyleMap().get("border-top-width");
		return v && v.unit ? v.value : 0;
	}

	get borderBlockEnd() {
		const v = this.#getStyleMap().get("border-bottom-width");
		return v && v.unit ? v.value : 0;
	}

	//Fragmentation CSS

	get page() {
		if (this.#pageOverride !== undefined) return this.#pageOverride;
		const val = this.#getStyle().page;
		return val && val !== "auto" ? val : null;
	}

	set page(value) {
		this.#pageOverride = value;
	}

	get breakBefore() {
		if (this.#breakBeforeOverride !== null) return this.#breakBeforeOverride;
		return this.#getStyle().breakBefore || "auto";
	}

	set breakBefore(value) {
		this.#breakBeforeOverride = value;
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
		return v && v.unit ? v.value : 2;
	}

	get widows() {
		const v = this.#getStyleMap().get("widows");
		return v && v.unit ? v.value : 2;
	}

	//Counters

	get counterReset() {
		return this.#getStyle().counterReset || "none";
	}
	get counterIncrement() {
		return this.#getStyle().counterIncrement || "none";
	}

	//Compositor-accessed styles (snapshot values so they survive detachment)

	get textAlign() {
		if (this.#textAlign === null) this.#getStyle();
		return this.#textAlign;
	}

	get whiteSpace() {
		if (this.#whiteSpace === null) this.#getStyle();
		return this.#whiteSpace;
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
		if (!sharedRangeMeasurer) {
			sharedRangeMeasurer =
				typeof document.caretPositionFromPoint === "function"
					? createCaretMeasurer()
					: createRangeMeasurer();
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

	get debugName() {
		return "[anon]";
	}
	get element() {
		return null;
	}
	get isInlineFormattingContext() {
		return true;
	}
	get children() {
		return [];
	}

	get inlineItemsData() {
		if (!this.#inlineItemsData) {
			this.#inlineItemsData = collectInlineItems(this.#childNodes);
		}
		return this.#inlineItemsData;
	}

	get lineHeight() {
		return getLineHeight(this.#parentElement);
	}

	get measurer() {
		if (!sharedRangeMeasurer) {
			sharedRangeMeasurer =
				typeof document.caretPositionFromPoint === "function"
					? createCaretMeasurer()
					: createRangeMeasurer();
		}
		return sharedRangeMeasurer;
	}

	/**
	 * Bounding rect of the anonymous block's inline content,
	 * measured via a Range across the child nodes.
	 */
	get contentRect() {
		const nodes = this.#childNodes;
		if (nodes.length === 0) return { top: 0, height: 0 };
		const range = document.createRange();
		range.setStartBefore(nodes[0]);
		range.setEndAfter(nodes[nodes.length - 1]);
		return range.getBoundingClientRect();
	}

	get blockSize() {
		return 0;
	}
	computedBlockSize() {
		return null;
	}

	// Neutral box model
	get marginBlockStart() {
		return 0;
	}
	get marginBlockEnd() {
		return 0;
	}
	get paddingBlockStart() {
		return 0;
	}
	get paddingBlockEnd() {
		return 0;
	}
	get borderBlockStart() {
		return 0;
	}
	get borderBlockEnd() {
		return 0;
	}

	getCustomProperty() {
		return null;
	}

	// No fragmentation properties
	get page() {
		return null;
	}
	get breakBefore() {
		return "auto";
	}
	get breakAfter() {
		return "auto";
	}
	get breakInside() {
		return "auto";
	}
	get boxDecorationBreak() {
		return BOX_DECORATION_SLICE;
	}
	get orphans() {
		return 2;
	}
	get widows() {
		return 2;
	}

	// Classification
	get position() {
		return "static";
	}
	get isReplacedElement() {
		return false;
	}
	get isScrollable() {
		return false;
	}
	get hasOverflowHidden() {
		return false;
	}
	get hasExplicitBlockSize() {
		return false;
	}
	get isTable() {
		return false;
	}
	get isTableRow() {
		return false;
	}
	get isTableHeaderGroup() {
		return false;
	}
	get isFlexContainer() {
		return false;
	}
	get isGridContainer() {
		return false;
	}
	get isMulticolContainer() {
		return false;
	}
	get flexDirection() {
		return "row";
	}
	get flexWrap() {
		return "nowrap";
	}
	get gridRowStart() {
		return null;
	}
	get gridRowEnd() {
		return null;
	}
	get columnCount() {
		return null;
	}
	get columnWidth() {
		return null;
	}
	get columnGap() {
		return null;
	}
	get columnFill() {
		return "balance";
	}
	get cells() {
		return [];
	}

	// Counters
	get counterReset() {
		return "none";
	}
	get counterIncrement() {
		return "none";
	}
}
