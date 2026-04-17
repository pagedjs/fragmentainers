# Layout Algorithms

Guide to each layout algorithm generator in `fragmentainers`.

---

## How Layout Algorithms Work

Each layout algorithm is a class with a `*layout()` generator method. The generator yields `LayoutRequest` objects when it needs a child laid out. The driver (`runLayoutGenerator` in `src/layout/layout-driver.js`) fulfills each request by instantiating the child's algorithm class and recursively running it, then sends the result back via `generator.next(result)`.

```javascript
export class BlockContainerAlgorithm {
	#node;
	#constraintSpace;
	#breakToken;
	#earlyBreakTarget;

	constructor(node, constraintSpace, breakToken, earlyBreakTarget = null) {
		this.#node = node;
		this.#constraintSpace = constraintSpace;
		this.#breakToken = breakToken;
		this.#earlyBreakTarget = earlyBreakTarget;
	}

	*layout() {
		// ...
		for (const child of children) {
			// Yield a request — driver runs child layout and returns the result
			const result = yield new LayoutRequest(child, childConstraintSpace, childBreakToken);

			// result.fragment — the child's Fragment
			// result.breakToken — non-null if child broke (more content follows)
			childFragments.push(result.fragment);
			blockOffset += result.fragment.blockSize;

			if (result.breakToken) {
				// Child broke — record its token and stop iterating
				childBreakTokens.push(result.breakToken);
				break;
			}
		}

		// Build the output fragment and break token
		const fragment = new Fragment(this.#node, blockOffset, childFragments);
		return { fragment, breakToken: containerToken || null };
	}
}
```

**Key conventions:**

- **Constructor**: `(node, constraintSpace, breakToken)` for all algorithms; `BlockContainerAlgorithm` also accepts an optional `earlyBreakTarget` as a fourth argument
- **Generator method**: `*layout()` — no arguments; reads inputs from instance fields
- **Yield**: `yield new LayoutRequest(childNode, childConstraintSpace, childBreakToken)` to request child layout
- **Return**: `{ fragment, breakToken }` where `breakToken` is `null` if all content fit
- **Two-pass**: Only `BlockContainerAlgorithm` supports `earlyBreakTarget` for Pass 2; other algorithms propagate it through children implicitly

---

## Block Container

**File:** `src/algorithms/block-container.js`
**Dispatch:** Default algorithm when no other type matches
**Class:** `BlockContainerAlgorithm` — `new BlockContainerAlgorithm(node, constraintSpace, breakToken, earlyBreakTarget?)` → `*layout()`

The core algorithm. Lays out block-level children sequentially in the block direction.

### Walk

1. Determine `startIndex` from break token's first child token
2. For each child from `startIndex`:
   - Resolve child's break token (convert `isBreakBefore` to `null` for fresh layout)
   - Calculate margin collapsing between adjacent siblings
   - Check for forced breaks (`break-before: page|column|always|left|right|recto|verso`)
   - Check for named page changes (forces page break in page mode)
   - Handle monolithic content (push to next fragmentainer if it doesn't fit)
   - Build child constraint space with propagated `blockOffsetInFragmentainer`
   - `yield new LayoutRequest(child, childConstraint, childBreakToken)`
   - Accumulate `blockOffset` and track break tokens

### Container Box Insets

Padding and border are handled differently based on `box-decoration-break`:

- **`slice`** (default): Top padding/border on first fragment only, bottom on last fragment only
- **`clone`**: Top and bottom padding/border on every fragment (repeated decorations)

```javascript
const isClone = node.boxDecorationBreak === BOX_DECORATION_CLONE;
let blockOffset = breakToken && !isClone ? 0 : containerBoxStart;
```

### Leaf Nodes

When `children.length === 0`, the algorithm uses the node's intrinsic `blockSize`:

- **Monolithic leaf** (replaced element, scrollable): In page mode, slices at fragmentainer boundary when element exceeds the full page. Otherwise placed whole.
- **Non-monolithic leaf** (e.g., empty div with explicit height): Fragments across fragmentainers, splitting remaining height.

### Break Scoring (Two-Pass)

The block container implements the two-pass break scoring system:

**Pass 1** — At each Class A breakpoint (between siblings), scores the break quality using `scoreClassABreak()` and tracks the best `EarlyBreak`. If space runs out at a worse breakpoint, returns `{ earlyBreak }` to signal re-layout.

**Pass 2** — When `earlyBreakTarget` is provided, breaks at the designated node instead of waiting for space exhaustion:

```javascript
if (earlyBreakForChild && earlyBreakForChild.node === child &&
    earlyBreakForChild.type === EARLY_BREAK_BEFORE) {
  childBreakTokens.push(BlockBreakToken.createBreakBefore(child));
  break;
}
```

### Margin Truncation

Per CSS Fragmentation: margins adjoining a fragmentainer break are truncated to zero. Trailing margins are only applied when all children complete without breaking.

---

## Inline Content

**File:** `src/algorithms/inline-content.js`
**Dispatch:** `node.isInlineFormattingContext === true`
**Class:** `InlineContentAlgorithm` — `new InlineContentAlgorithm(node, constraintSpace, breakToken)` → `*layout()`

Handles text content and inline-level boxes. Breaks at word boundaries across lines and fragmentainers.

Never yields a `LayoutRequest` — all measurement happens via the node's `inlineItemsData` plus the measurer. The `*layout()` generator still runs under the standard dispatch protocol; it returns the final `{ fragment, breakToken }` on its first `.next()`.

### Break Offset Resolution

The algorithm uses the element's rendered height from `getBoundingClientRect()` to compute total lines, then resolves the break offset via `measurer.offsetAtLine(items, lineTops, targetLineIndex)`.

`offsetAtLine` binary-searches the flat text range using `lineIndexAtOffset`, which snaps each candidate char's rendered rect to a known line-top from `measureLines().tops`. Comparing integer line indices rather than scalar Y cutoffs eliminates sub-pixel boundary artifacts — notably the zero-width leading rect that `Range.getClientRects()` emits for chars at hyphenated soft-wrap boundaries (handled by `renderedRect`, which picks the rect with the largest top).

`getClientRects()` works for offscreen layout, so the same path runs inside `content-measure`'s `left: -9999px` harness.

### Content-Addressed Break Tokens

`InlineBreakToken` stores `itemIndex` and `textOffset` into `InlineItemsData` — not pixel positions or line numbers. This makes tokens survive inline-size changes between fragmentainers (e.g., different page widths).

```javascript
const inlineToken = new InlineBreakToken(node);
inlineToken.itemIndex = itemIndex; // index into items array
inlineToken.textOffset = textOffset; // offset into textContent string
```

### Collapsible Space at the Break

Before emitting the token, the algorithm consults each `INLINE_TEXT` item's `whiteSpace` (captured at inline-item collection) to decide whether the space straddling the break is collapsible per CSS Text §4.1.1. Two adjustments:

- **Leading collapsed space** — if `breakFlatOffset` lands inside a multi-space run whose `white-space` collapses (`normal`, `nowrap`, `pre-line`, `pre-wrap`), the offset advances past it so page N+1 does not start with a rendered space.
- **Trailing collapsed space** — if the char at `breakFlatOffset - 1` is a collapsible space under the same policy, `hasTrailingCollapsibleSpace` is set on the token. `Fragment.buildInlineContent` reads the flag and trims one trailing space from page N's last text node; without the flag, the slice is preserved verbatim (required for `pre` and `break-spaces`).

This mirrors Chromium's `RemoveTrailingCollapsibleSpace` — see `references/chromium-inline-break-token-findings.md`.

### Orphans and Widows

When fragmentation is active, the algorithm enforces orphans/widows constraints (CSS Fragmentation §4.4 Rule 3):

1. Calculate `fittingLines` from available block space
2. Clamp for orphans: ensure at least `orphans` lines before the break
3. Clamp for widows: ensure at least `widows` lines will remain after the break
4. When constraints can't be satisfied, score as `VIOLATING_ORPHANS_WIDOWS`

```javascript
const orphans = node.orphans || 2;
const widows = node.widows || 2;

if (linesToPlace < orphans && fittingLines >= orphans) {
	linesToPlace = orphans;
}
const linesAfter = remainingLines - linesToPlace;
if (linesAfter < widows && linesAfter > 0) {
	const maxLines = remainingLines - widows;
	if (maxLines >= orphans && maxLines > 0) {
		linesToPlace = maxLines;
	}
}
```

### Hyphenation Detection and Rendering

The containing `INLINE_TEXT` item carries the computed `hyphens` and `hyphenate-character` CSS values (captured in `collectInlineItems`). At break-token creation, `computeHyphenation` classifies the break:

- `hyphens: none` — never flags
- `hyphens: manual` — flags only when U+00AD sits at `textOffset - 1`
- `hyphens: auto` — flags on a soft-hyphen break OR a mid-word dictionary break (non-whitespace chars on both sides of the offset)

When flagged, the token carries `isHyphenated: true` and the resolved `hyphenateCharacter` (U+2010 HYPHEN by default, or the parsed CSS value). The render layer in `Fragment.buildInlineContent` strips any trailing U+00AD from page N's last text node and appends `hyphenateCharacter`, producing the visible hyphen that the source-text slice alone would not trigger in the shadow DOM.

The CSS `hyphenate-limit-*` properties are honored by the browser's own line-breaking decisions (which our algorithm observes via `offsetAtLine`); we do not re-implement them.

---

## Table Row

**File:** `src/algorithms/table-row.js`
**Dispatch:** `node.isTableRow === true`
**Class:** `TableRowAlgorithm` — `new TableRowAlgorithm(node, constraintSpace, breakToken)` → `*layout()`

Implements the **parallel flow** pattern. Each cell is laid out independently, and the tallest cell drives the row height.

### Parallel Flow Rule

When any cell overflows the fragmentainer, ALL cells receive break tokens — even completed cells:

```javascript
if (anyChildBroke) {
	for (let i = 0; i < cellBreakTokens.length; i++) {
		if (cellBreakTokens[i] === null) {
			const doneToken = new BlockBreakToken(cells[i]);
			doneToken.isAtBlockEnd = true;
			doneToken.hasSeenAllChildren = true;
			cellBreakTokens[i] = doneToken;
		}
	}
}
```

Completed cells get `isAtBlockEnd: true` so they produce zero-height empty fragments on resumption. This is essential — without it, the break token tree would be inconsistent and resumption would fail.

### Algorithm Data

The row's break token carries `algorithmData: { type: ALGORITHM_TABLE_ROW }` to distinguish table row tokens from regular block tokens.

---

## Multicol Container

**File:** `src/algorithms/multicol-container.js`
**Dispatch:** `node.isMulticolContainer === true` (checked first in dispatch chain)
**Class:** `MulticolAlgorithm` — `new MulticolAlgorithm(node, constraintSpace, breakToken)` → `*layout()`

Implements CSS Multi-column Layout fragmentation.

### Column Dimension Resolution

Uses `resolveColumnDimensions()` (CSS Multicol §3) to compute column count and width from the container's available inline size, `column-count`, `column-width`, and `column-gap`.

```javascript
const { count, width } = resolveColumnDimensions(
	containerInlineSize,
	node.columnWidth,
	node.columnCount,
	gap,
);
```

### Flow Thread Pattern

Creates an **anonymous flow thread node** (`FlowThreadNode` from `src/layout/flow-thread-node.js`) wrapping the multicol container's children. This prevents infinite recursion — `getLayoutAlgorithm(flowThread)` returns `BlockContainerAlgorithm` instead of `MulticolAlgorithm` because the flow thread is not itself a multicol container.

### Column Loop

Each iteration lays out one column as a fragmentainer with `fragmentationType: "column"`:

```javascript
do {
  const result = yield new LayoutRequest(flowThread, columnCS, contentToken);
  columnFragments.push(result.fragment);
  contentToken = result.breakToken;
} while (contentToken !== null);
```

The loop stops when content runs out (`contentToken === null`) or column count is reached (for `column-fill: auto`).

### Multicol Data

The fragment carries `multicolData: { columnWidth, columnGap, columnCount }` so the compositor knows how to render columns. The break token carries `algorithmData.type: ALGORITHM_MULTICOL` with the resolved dimensions.

---

## Flex Container

**File:** `src/algorithms/flex-container.js`
**Dispatch:** `node.isFlexContainer === true`
**Class:** `FlexAlgorithm` — `new FlexAlgorithm(node, constraintSpace, breakToken)` → `*layout()`

Handles both row and column flex directions differently.

### Row Direction (Parallel Flows)

Items within a flex line are laid out as parallel flows — the same pattern as table rows:

1. Group children into flex lines using `groupFlexLines()` (respects `flex-wrap`)
2. For each flex line, the `layoutFlexLine` helper method follows the table-row parallel flow pattern
3. Stack flex lines in the block direction with Class A breaks between lines

The break token carries `algorithmData: { type: ALGORITHM_FLEX, flexLineIndex }` to resume at the correct flex line.

### Column Direction (Flow Thread)

Column-direction flex delegates to a `FlowThreadNode` (same pattern as multicol). The flow thread wraps the flex children so `getLayoutAlgorithm(flowThread)` returns `BlockContainerAlgorithm` for sequential block layout:

```javascript
const flowThread = new FlowThreadNode(this.#node);
const result = yield new LayoutRequest(flowThread, this.#constraintSpace, contentToken);
// Wrap result in flex container fragment
```

### Flex Line Grouping

`groupFlexLines()` splits children based on `flex-wrap`:

- **`nowrap`**: All items on one line
- **`wrap`**: Items that exceed available inline size start a new line

---

## Grid Container

**File:** `src/algorithms/grid-container.js`
**Dispatch:** `node.isGridContainer === true`
**Class:** `GridAlgorithm` — `new GridAlgorithm(node, constraintSpace, breakToken)` → `*layout()`

Grid items sharing the same row are parallel flows. Rows are stacked in the block direction.

### Row Grouping

Items are grouped by their `gridRowStart` property via `groupGridRows()`. Items without explicit placement are auto-placed, each getting its own row.

### Layout Pattern

1. Group children into grid rows
2. For each row, the `layoutGridRow` helper method runs the parallel flow pattern (same as table row)
3. Stack rows in the block direction with Class A breaks between rows

### Algorithm Data

The break token carries `algorithmData: { type: ALGORITHM_GRID, rowIndex }` to resume at the correct grid row.

---

## Adding a New Layout Algorithm

Step-by-step guide for adding a new layout mode:

### 1. Create the Algorithm Class

Create `src/algorithms/my-container.js`:

```javascript
import { BlockBreakToken } from "../fragmentation/tokens.js";
import { ConstraintSpace } from "../fragmentation/constraint-space.js";
import { Fragment } from "../fragmentation/fragment.js";
import { LayoutRequest } from "../layout/layout-request.js";

export const ALGORITHM_MY_CONTAINER = "MyContainerData";

export class MyContainerAlgorithm {
	#node;
	#constraintSpace;
	#breakToken;

	constructor(node, constraintSpace, breakToken) {
		this.#node = node;
		this.#constraintSpace = constraintSpace;
		this.#breakToken = breakToken;
	}

	*layout() {
		// 1. Process children (sequential or parallel)
		// 2. yield new LayoutRequest(child, cs, bt) for each child
		// 3. Build fragment and break token

		const fragment = new Fragment(this.#node, blockOffset, childFragments);
		return { fragment, breakToken: containerToken || null };
	}
}
```

### 2. Register in Algorithm Dispatch

Add the check in `getLayoutAlgorithm()` in `src/layout/layout-driver.js`. Order matters — place it before any type it might overlap with:

```javascript
export function getLayoutAlgorithm(node) {
	if (node.isMulticolContainer) return MulticolAlgorithm;
	if (node.isMyContainer) return MyContainerAlgorithm; // add here
	if (node.isFlexContainer) return FlexAlgorithm;
	// ...
}
```

### 3. Define Algorithm Data Constants

The `ALGORITHM_MY_CONTAINER` constant lives at the top of your container's file, co-located with the class that uses it (see step 1).

### 4. Add LayoutNode Properties

Add detection properties to the `LayoutNode` typedef and implement them in `src/layout/layout-node.js`. Constants used by the layout node (e.g. `BOX_DECORATION_SLICE`) also live there.

### 5. Write Tests

Create unit tests in `test/` using mock node factories. Add a factory function to `test/fixtures/nodes.js`:

```javascript
export function myContainerNode({ debugName, children = [], ...overrides } = {}) {
	return blockNode({
		debugName: debugName || "my-container",
		isMyContainer: true,
		children,
		...overrides,
	});
}
```

### 6. Export

Add the class to the algorithms barrel at `src/algorithms/index.js`:

```javascript
export { MyContainerAlgorithm } from "./my-container.js";
```

---

## Algorithm Patterns Summary

| Algorithm       | Pattern                   | Break Between                  | Algorithm Data        |
| --------------- | ------------------------- | ------------------------------ | --------------------- |
| Block container | Sequential children       | Class A (sibling boundaries)   | None                  |
| Inline content  | Line-by-line              | Within text at word boundaries | None                  |
| Table row       | Parallel flows (cells)    | Tallest cell drives break      | `ALGORITHM_TABLE_ROW` |
| Multicol        | Flow thread + column loop | Between columns                | `ALGORITHM_MULTICOL`  |
| Flex (row)      | Parallel flows per line   | Between flex lines             | `ALGORITHM_FLEX`      |
| Flex (column)   | Flow thread               | Sequential block               | `ALGORITHM_FLEX`      |
| Grid            | Parallel flows per row    | Between grid rows              | `ALGORITHM_GRID`      |
