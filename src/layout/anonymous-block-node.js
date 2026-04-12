import { collectInlineItems } from "../measurement/collect-inlines.js";
import { getLineHeight, getSharedMeasurer } from "../measurement/line-box.js";
import { BOX_DECORATION_SLICE } from "./layout-node.js";

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
