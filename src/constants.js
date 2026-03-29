/**
 * Shared constants for type discriminators and enum-like values.
 *
 * All magic strings used for type checks, mode flags, and category
 * tags are defined here to avoid typos and enable IDE autocompletion.
 */

// ---------------------------------------------------------------------------
// Inline item types (InlineItemsData.items[].type)
// ---------------------------------------------------------------------------

export const INLINE_TEXT = "Text";
export const INLINE_CONTROL = "Control";
export const INLINE_OPEN_TAG = "OpenTag";
export const INLINE_CLOSE_TAG = "CloseTag";
export const INLINE_ATOMIC = "AtomicInline";

// ---------------------------------------------------------------------------
// Break token types (BreakToken.type)
// ---------------------------------------------------------------------------

export const BREAK_TOKEN_BLOCK = "block";
export const BREAK_TOKEN_INLINE = "inline";

// ---------------------------------------------------------------------------
// Fragmentation types (ConstraintSpace.fragmentationType)
// ---------------------------------------------------------------------------

export const FRAGMENTATION_NONE = "none";
export const FRAGMENTATION_PAGE = "page";
export const FRAGMENTATION_COLUMN = "column";

// ---------------------------------------------------------------------------
// Box decoration break (node.boxDecorationBreak)
// ---------------------------------------------------------------------------

export const BOX_DECORATION_SLICE = "slice";
export const BOX_DECORATION_CLONE = "clone";

// ---------------------------------------------------------------------------
// Early break types (EarlyBreak.type)
// ---------------------------------------------------------------------------

export const EARLY_BREAK_BEFORE = "before";
export const EARLY_BREAK_INSIDE = "inside";

// ---------------------------------------------------------------------------
// Algorithm data types (breakToken.algorithmData.type)
// ---------------------------------------------------------------------------

export const ALGORITHM_FLEX = "FlexData";
export const ALGORITHM_FLEX_LINE = "FlexLineData";
export const ALGORITHM_GRID = "GridData";
export const ALGORITHM_TABLE_ROW = "TableRowData";
export const ALGORITHM_MULTICOL = "MulticolData";
