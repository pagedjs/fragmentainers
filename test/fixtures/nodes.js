/**
 * Factory functions for creating mock LayoutNode objects.
 * These return plain objects matching the LayoutNode interface
 * expected by the layout algorithms.
 */
import { INLINE_TEXT, INLINE_CONTROL } from "../../src/measurement/collect-inlines.js";

const DEFAULTS = {
	children: [],
	blockSize: 0,
	element: null,
	querySelectorAll() {
		return [];
	},
	getCustomProperty() {
		return null;
	},
	position: "static",
	isInlineFormattingContext: false,
	isReplacedElement: false,
	isScrollable: false,
	hasOverflowHidden: false,
	hasExplicitBlockSize: false,
	isTable: false,
	isTableRow: false,
	isTableHeaderGroup: false,
	isFlexContainer: false,
	isGridContainer: false,
	isMulticolContainer: false,
	flexDirection: "row",
	flexWrap: "nowrap",
	gridRowStart: null,
	gridRowEnd: null,
	columnCount: null,
	columnWidth: null,
	columnGap: null,
	columnFill: "balance",
	inlineItemsData: null,
	page: null,
	breakBefore: "auto",
	breakAfter: "auto",
	breakInside: "auto",
	boxDecorationBreak: "slice",
	orphans: 2,
	widows: 2,
	counterReset: "none",
	counterIncrement: "none",
	marginBlockStart: 0,
	marginBlockEnd: 0,
	paddingBlockStart: 0,
	paddingBlockEnd: 0,
	borderBlockStart: 0,
	borderBlockEnd: 0,
};

/**
 * Create a block-level layout node.
 * @param {Object} opts
 * @param {string} [opts.debugName] - Name for debug output
 * @param {number} [opts.blockSize] - Intrinsic block size (for leaf nodes)
 * @param {LayoutNode[]} [opts.children] - Child nodes
 * @param {Object} [opts.overrides] - Any LayoutNode property overrides
 */
export function blockNode({ debugName, blockSize = 0, children = [], ...overrides } = {}) {
	return {
		...DEFAULTS,
		debugName: debugName || `block(${blockSize})`,
		blockSize,
		children,
		computedBlockSize: () => blockSize,
		...overrides,
	};
}

/**
 * Create a replaced element (img, video, etc.) — monolithic.
 */
export function replacedNode({ debugName, blockSize = 0, ...overrides } = {}) {
	return blockNode({
		debugName: debugName || `replaced(${blockSize})`,
		blockSize,
		isReplacedElement: true,
		...overrides,
	});
}

/**
 * Create a scrollable element — monolithic.
 */
export function scrollableNode({ debugName, blockSize = 0, children = [], ...overrides } = {}) {
	return blockNode({
		debugName: debugName || `scrollable(${blockSize})`,
		blockSize,
		children,
		isScrollable: true,
		...overrides,
	});
}

/**
 * Simulate line breaking for mock nodes: walk text word-by-word using
 * measureFn, and return an array of { startOffset, endOffset } per line.
 * Newlines force a line break (matching kControl behavior).
 */
function computeMockLines(text, measureFn, availableInlineSize) {
	const lines = [];
	let lineStart = 0;
	let currentWidth = 0;
	const words = text.split(/(\s+)/);
	let pos = 0;

	for (const word of words) {
		if (word.length === 0) continue;

		// Newline forces a line break
		if (word.includes("\n")) {
			lines.push({ startOffset: lineStart, endOffset: pos + word.length });
			pos += word.length;
			lineStart = pos;
			currentWidth = 0;
			continue;
		}

		const wordWidth = measureFn(word);
		if (currentWidth + wordWidth > availableInlineSize && currentWidth > 0) {
			lines.push({ startOffset: lineStart, endOffset: pos });
			lineStart = pos;
			currentWidth = 0;
		}
		currentWidth += wordWidth;
		pos += word.length;
	}
	if (pos > lineStart) {
		lines.push({ startOffset: lineStart, endOffset: pos });
	}
	return lines;
}

/**
 * Create a node with inline formatting context.
 *
 * The mock node provides a measurer with charTop() and a mock element
 * with getBoundingClientRect(), matching the DOM measurer contract so
 * the browser-height code path is exercised in tests.
 *
 * @param {Object} opts
 * @param {Object} opts.inlineItemsData - { items: InlineItem[], textContent: string }
 * @param {number} [opts.lineHeight] - Line height in px
 * @param {Function} [opts.measureText] - (text) => width in px
 * @param {number} [opts.availableInlineSize] - line width for mock line breaking (default 100)
 */
export function inlineNode({
	debugName,
	inlineItemsData,
	lineHeight = 20,
	measureText,
	availableInlineSize = 100,
	...overrides
} = {}) {
	const measureFn = measureText || ((text) => text.length * 8); // default: 8px per char
	const text = inlineItemsData?.textContent || "";
	const MOCK_TOP = 0;

	// Pre-compute line layout for charTop and element height
	const mockLines = computeMockLines(text, measureFn, availableInlineSize);
	const totalHeight = mockLines.length * lineHeight;

	return {
		...DEFAULTS,
		debugName: debugName || "inline",
		isInlineFormattingContext: true,
		inlineItemsData,
		lineHeight,
		element: {
			getBoundingClientRect() {
				return { top: MOCK_TOP, height: totalHeight };
			},
		},
		measurer: {
			charTop(textNode, localOffset) {
				// Find which line this offset falls on
				const flatOffset = localOffset; // mock textNode covers full text
				for (let i = 0; i < mockLines.length; i++) {
					if (flatOffset < mockLines[i].endOffset) {
						return MOCK_TOP + i * lineHeight;
					}
				}
				return MOCK_TOP + (mockLines.length - 1) * lineHeight;
			},
		},
		computedBlockSize: () => 0,
		...overrides,
	};
}

/**
 * Create a multicol container node.
 * @param {Object} opts
 * @param {number} [opts.columnCount] - CSS column-count
 * @param {number} [opts.columnWidth] - CSS column-width (null = auto)
 * @param {number} [opts.columnGap] - CSS column-gap
 * @param {string} [opts.columnFill] - 'balance' | 'auto'
 */
export function multicolNode({
	debugName,
	columnCount = 2,
	columnWidth = null,
	columnGap = 0,
	columnFill = "balance",
	children = [],
	...overrides
} = {}) {
	return blockNode({
		debugName: debugName || `multicol(${columnCount}col)`,
		isMulticolContainer: true,
		columnCount,
		columnWidth,
		columnGap,
		columnFill,
		children,
		...overrides,
	});
}

/**
 * Create a flex container node.
 */
export function flexNode({
	debugName,
	flexDirection = "row",
	flexWrap = "nowrap",
	children = [],
	...overrides
} = {}) {
	return blockNode({
		debugName: debugName || "flex",
		isFlexContainer: true,
		flexDirection,
		flexWrap,
		children,
		...overrides,
	});
}

/**
 * Create a grid container node.
 */
export function gridNode({ debugName, children = [], ...overrides } = {}) {
	return blockNode({
		debugName: debugName || "grid",
		isGridContainer: true,
		children,
		...overrides,
	});
}

/**
 * Create a grid item node with row placement.
 */
export function gridItemNode({
	debugName,
	blockSize = 0,
	gridRowStart = 1,
	gridRowEnd = 2,
	...overrides
} = {}) {
	return blockNode({
		debugName: debugName || `grid-item(row${gridRowStart})`,
		blockSize,
		gridRowStart,
		gridRowEnd,
		...overrides,
	});
}

/**
 * Create a table node.
 */
export function tableNode({ debugName, children = [], ...overrides } = {}) {
	return {
		...DEFAULTS,
		debugName: debugName || "table",
		isTable: true,
		children,
		computedBlockSize: () => 0,
		...overrides,
	};
}

/**
 * Create a table header group node (thead).
 */
export function tableHeaderNode({ debugName, children = [], ...overrides } = {}) {
	return {
		...DEFAULTS,
		debugName: debugName || "thead",
		isTableHeaderGroup: true,
		children,
		computedBlockSize: () => 0,
		...overrides,
	};
}

/**
 * Create a table row node with cells.
 * @param {Object} opts
 * @param {LayoutNode[]} opts.cells - Cell nodes
 */
export function tableRowNode({ debugName, cells = [], ...overrides } = {}) {
	return {
		...DEFAULTS,
		debugName: debugName || "tr",
		isTableRow: true,
		cells,
		children: cells,
		computedBlockSize: () => 0,
		...overrides,
	};
}

/**
 * Create a page-float node with a mock element that returns custom properties.
 * @param {Object} opts
 * @param {string} [opts.placement="top"] - "top" or "bottom"
 * @param {number} [opts.blockSize=0] - Intrinsic block size
 */
export function floatNode({
	debugName,
	placement = "top",
	blockSize = 0,
	children = [],
	...overrides
} = {}) {
	const customProps = {
		"float-reference": "page",
		float: placement,
	};
	return blockNode({
		debugName: debugName || `float-${placement}(${blockSize})`,
		blockSize,
		children,
		getCustomProperty(name) {
			return customProps[name] || null;
		},
		...overrides,
	});
}

/**
 * Create a position: fixed node for testing the fixed-position handler.
 * @param {Object} opts
 * @param {string} [opts.anchorEdge="block-start"] - "block-start", "block-end", or "overlay"
 * @param {number} [opts.blockSize=0] - Intrinsic block size
 */
export function fixedNode({
	debugName,
	anchorEdge = "block-start",
	blockSize = 0,
	children = [],
	...overrides
} = {}) {
	// Build mock inline style for anchor edge classification.
	// The handler reads element.style.top / element.style.bottom to
	// classify which edge the fixed element anchors to.
	const inlineStyle = {
		"block-start": { top: "0px", bottom: "" },
		"block-end": { top: "", bottom: "0px" },
		overlay: { top: "", bottom: "" },
	}[anchorEdge];

	return blockNode({
		debugName: debugName || `fixed-${anchorEdge}(${blockSize})`,
		blockSize,
		children,
		position: "fixed",
		element: { style: inlineStyle },
		...overrides,
	});
}

/**
 * Build InlineItemsData from a simple text string.
 * Splits into kText items per word and inserts kControl for \n.
 * Each kText item includes a mock domNode for Range-based measurement.
 */
export function textToInlineItems(text) {
	const items = [];
	const mockTextNode = { textContent: text };
	let offset = 0;

	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\n") {
			if (i > offset) {
				items.push({ type: INLINE_TEXT, startOffset: offset, endOffset: i, domNode: mockTextNode });
			}
			items.push({ type: INLINE_CONTROL, startOffset: i, endOffset: i + 1 });
			offset = i + 1;
		}
	}

	if (offset < text.length) {
		items.push({
			type: INLINE_TEXT,
			startOffset: offset,
			endOffset: text.length,
			domNode: mockTextNode,
		});
	}

	return { items, textContent: text };
}
