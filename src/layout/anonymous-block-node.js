import { collectInlineItems } from "../measurement/collect-inlines.js";
import {
	getLineHeight,
	getSharedMeasurer,
	measureLinesAcrossNodes,
} from "../measurement/line-box.js";
import { LayoutNode } from "./layout-node-base.js";

/**
 * Anonymous block box wrapping consecutive inline content in a mixed-content
 * block container (CSS 2.1 §9.2.1.1). Extends `LayoutNode` — only the
 * non-default getters (debugName, inline-FC plumbing, measurer/contentRect)
 * are overridden here; everything else inherits neutral defaults.
 */
export class AnonymousBlockNode extends LayoutNode {
	#parentElement;
	#childNodes;
	#inlineItemsData = null;
	#lineHeightCache = null;

	#parentNode;

	/**
	 * @param {Element} parentElement - the block container establishing the IFC
	 * @param {Node[]} childNodes - the inline-level content
	 * @param {import("./layout-node.js").DOMLayoutNode|null} [parentNode] - the
	 *   container's layout node; its cached style snapshot supplies the
	 *   line-breaking properties after the element leaves the document
	 */
	constructor(parentElement, childNodes, parentNode = null) {
		super();
		this.#parentElement = parentElement;
		this.#childNodes = childNodes;
		this.#parentNode = parentNode;
	}

	get debugName() {
		return "[anon]";
	}

	get isInlineNode() {
		return true;
	}

	get isInlineFormattingContext() {
		return true;
	}

	// Line-breaking properties apply to the block container that establishes
	// the inline formatting context (CSS Fragmentation §3.3, CSS Text §3);
	// the anonymous box reads them from that element.

	get orphans() {
		return this.#parentNode?.orphans ?? this.#parentIntegerProperty("orphans");
	}

	get widows() {
		return this.#parentNode?.widows ?? this.#parentIntegerProperty("widows");
	}

	get whiteSpace() {
		return this.#parentNode?.whiteSpace ?? (getComputedStyle(this.#parentElement).whiteSpace || "normal");
	}

	#parentIntegerProperty(name) {
		const v = parseInt(getComputedStyle(this.#parentElement)[name], 10);
		return Number.isNaN(v) ? 2 : v;
	}

	get inlineItemsData() {
		if (!this.#inlineItemsData) {
			this.#inlineItemsData = collectInlineItems(this.#childNodes);
		}
		return this.#inlineItemsData;
	}

	get lineHeight() {
		// `line-height: normal` resolves via Range getClientRects (a forced
		// layout); cache it like DOMLayoutNode since it's read repeatedly per pass.
		if (this.#lineHeightCache === null) {
			this.#lineHeightCache = getLineHeight(this.#parentElement);
		}
		return this.#lineHeightCache;
	}

	get measurer() {
		return getSharedMeasurer();
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

	/**
	 * Content-box extent of the box that holds this anonymous block's line
	 * boxes, or null when it is not this element's whole content box.
	 *
	 * Line boxes tile their containing block's content box, so when the
	 * anonymous block is the container's only child its content box is exactly
	 * the extent of these lines — the one measurement that sizes a line box
	 * taller than `line-height` without re-deriving the browser's baseline
	 * alignment. A container with block-level children as well splits its
	 * content box across several anonymous blocks, and none of them owns it.
	 *
	 * The value is a claim, not a guarantee: a specified block-size or a
	 * stretched box makes the content box larger than its lines. Callers check
	 * it against the line geometry (see computeLineExtents).
	 */
	get contentBoxExtent() {
		if (!this.#parentNode?.isInlineFormattingContext) return null;
		const element = this.#parentElement;
		if (!element || typeof element.getBoundingClientRect !== "function") return null;
		const style = getComputedStyle(element);
		const rect = element.getBoundingClientRect();
		const insets =
			parseFloat(style.borderTopWidth) +
			parseFloat(style.paddingTop) +
			parseFloat(style.borderBottomWidth) +
			parseFloat(style.paddingBottom);
		const extent = rect.height - (Number.isFinite(insets) ? insets : 0);
		return extent > 0 ? extent : null;
	}

	measureLines() {
		return measureLinesAcrossNodes(this.#childNodes);
	}
}
