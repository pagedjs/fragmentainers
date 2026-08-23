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
	#context = null;

	// Flow context

	/**
	 * The FlowContext of the flow this node belongs to (handlers, clone
	 * map). Set on root nodes by whoever creates them; children inherit
	 * it at construction via adoptContextFrom(). Throws when unset so a
	 * node-creation path that forgot to propagate fails loudly.
	 *
	 * @returns {import('../fragmentation/flow-context.js').FlowContext}
	 */
	get context() {
		if (this.#context === null) {
			throw new Error(`LayoutNode ${this.debugName} has no flow context`);
		}
		return this.#context;
	}

	set context(value) {
		this.#context = value;
	}

	get hasContext() {
		return this.#context !== null;
	}

	/**
	 * Inherit the parent's context (which may still be unset).
	 * @param {LayoutNode} parent
	 */
	adoptContextFrom(parent) {
		this.#context = parent.#context;
	}

	// Structure

	get children() {
		return [];
	}

	/**
	 * True for the anonymous box that holds a block container's inline-level
	 * content (CSS 2.1 §9.2.1.1). Inline content is laid out line by line by
	 * the inline algorithm; the containing block container owns the box —
	 * its size, decorations and fragmentation — so every element node,
	 * whether its children are block-level or inline-level, is a block
	 * container to the driver.
	 */
	get isInlineNode() {
		return false;
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
	// CSS2 §8.3.1 / §4.2: a box that establishes a new block formatting
	// context does not margin-collapse with its in-flow children.
	get establishesBlockFormattingContext() {
		return false;
	}
	get isFloating() {
		return false;
	}
	get isOutOfFlow() {
		return this.isFloating || this.position === "absolute" || this.position === "fixed";
	}
	// Block-size is "auto" (does not block last-child margin collapse) unless an
	// explicit non-auto block-size is set.
	get hasAutoBlockSize() {
		return !this.hasExplicitBlockSize;
	}
	// A non-zero min-block-size blocks last-child margin collapse (CSS2 §8.3.1
	// §3.3); the initial value 0 does not.
	get hasMinBlockSize() {
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
		return { count: 0, lineHeight: 0, firstLineHeight: 0, tops: [], inkTops: [], inkHeights: [] };
	}
	get contentBoxExtent() {
		return null;
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
