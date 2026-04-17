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

	constructor(parentElement, childNodes) {
		super();
		this.#parentElement = parentElement;
		this.#childNodes = childNodes;
	}

	get debugName() {
		return "[anon]";
	}

	get isInlineFormattingContext() {
		return true;
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

	measureLines() {
		return measureLinesAcrossNodes(this.#childNodes);
	}
}
