/**
 * Abstract base class for layout nodes. Implements the full LayoutNode
 * interface as getters with neutral defaults — the interface becomes real
 * code rather than a JSDoc typedef. Concrete node classes (`DOMLayoutNode`,
 * `AnonymousBlockNode`, `FlowThreadNode`) extend this and override only the
 * getters where the default is incorrect.
 *
 * Layout algorithms only read from LayoutNode — nodes are treated as
 * immutable style/structure snapshots. Subclasses are free to add setters
 * (e.g. `DOMLayoutNode.setChildren`) for flow-thread / anonymous-box
 * wrapping, but those are outside the base interface.
 */
export class LayoutNode {
	// Structure

	get children() {
		return [];
	}

	get element() {
		return null;
	}

	get debugName() {
		return "[layout-node]";
	}

	// Intrinsic size

	get blockSize() {
		return 0;
	}

	computedBlockSize() {
		return null;
	}

	borderBoxBlockSize() {
		return null;
	}

	getCustomProperty() {
		return null;
	}

	// Classification

	get isInlineFormattingContext() {
		return false;
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

	// Box model

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
	get borderSpacingBlock() {
		return 0;
	}

	// Fragmentation

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
	// "slice" matches BOX_DECORATION_SLICE in layout-node.js — kept as a
	// literal here so the base class has no dependency on that module.
	get boxDecorationBreak() {
		return "slice";
	}
	get orphans() {
		return 2;
	}
	get widows() {
		return 2;
	}

	// Algorithm hints

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
	get inlineItemsData() {
		return null;
	}
	measureLines() {
		return { count: 0, lineHeight: 0, firstLineHeight: 0, tops: [] };
	}
	get cells() {
		return [];
	}
	get position() {
		return "static";
	}

	// Counters

	get counterReset() {
		return "none";
	}
	get counterIncrement() {
		return "none";
	}
}
