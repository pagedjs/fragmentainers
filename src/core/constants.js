/**
 * Shared constants for type discriminators and enum-like values.
 *
 * All magic strings used for type checks, mode flags, and category
 * tags are defined here to avoid typos and enable IDE autocompletion.
 */

// Inline item types (InlineItemsData.items[].type)
export const INLINE_TEXT = "Text";
export const INLINE_CONTROL = "Control";
export const INLINE_OPEN_TAG = "OpenTag";
export const INLINE_CLOSE_TAG = "CloseTag";
export const INLINE_ATOMIC = "AtomicInline";

// Break token types (BreakToken.type)
export const BREAK_TOKEN_BLOCK = "block";
export const BREAK_TOKEN_INLINE = "inline";

// Fragmentation types (ConstraintSpace.fragmentationType)
export const FRAGMENTATION_NONE = "none";
export const FRAGMENTATION_PAGE = "page";
export const FRAGMENTATION_COLUMN = "column";
export const FRAGMENTATION_REGION = "region";

// Box decoration break (node.boxDecorationBreak)
export const BOX_DECORATION_SLICE = "slice";
export const BOX_DECORATION_CLONE = "clone";

// Early break types (EarlyBreak.type)
export const EARLY_BREAK_BEFORE = "before";
export const EARLY_BREAK_INSIDE = "inside";

// Algorithm data types (breakToken.algorithmData.type)
export const ALGORITHM_FLEX = "FlexData";
export const ALGORITHM_FLEX_LINE = "FlexLineData";
export const ALGORITHM_GRID = "GridData";
export const ALGORITHM_TABLE_ROW = "TableRowData";
export const ALGORITHM_MULTICOL = "MulticolData";

// Default overflow threshold: browser default line height (16px * 1.2).
// Used when the fragment's root node has no computed lineHeight.
export const DEFAULT_OVERFLOW_THRESHOLD = 16 * 1.2;

// Named page sizes (CSS pixels at 96 DPI)
export const NAMED_SIZES = {
	A6: { inlineSize: 397, blockSize: 559 },
	A5: { inlineSize: 559, blockSize: 794 },
	A4: { inlineSize: 794, blockSize: 1123 },
	A3: { inlineSize: 1123, blockSize: 1587 },
	B5: { inlineSize: 665, blockSize: 945 },
	B4: { inlineSize: 945, blockSize: 1334 },
	LETTER: { inlineSize: 816, blockSize: 1056 },
	LEGAL: { inlineSize: 816, blockSize: 1344 },
	LEDGER: { inlineSize: 1056, blockSize: 1632 },
};
