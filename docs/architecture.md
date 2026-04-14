# Architecture Guide

This document covers the engine's pipeline, its generator-based layout model, the
break token tree, two-pass break scoring, and the composition step that converts
layout output back into visible DOM.

For per-algorithm details see [layout-algorithms.md](layout-algorithms.md).

For mappings to browser engine equivalents in Blink, Gecko, and WebKit, see [browser-engine-reference.md](browser-engine-reference.md).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Generator-Based Layout](#2-generator-based-layout)
3. [The Fragmentation Loop](#3-the-fragmentation-loop)
4. [Algorithm Dispatch](#4-algorithm-dispatch)
5. [Break Tokens](#5-break-tokens)
6. [Two-Pass Break Scoring](#6-two-pass-break-scoring)
7. [Parallel Flows](#7-parallel-flows)
8. [Flow Thread Pattern](#8-flow-thread-pattern)
9. [DOM Adapter](#9-dom-adapter)
10. [Fragmentation](#10-composition)
11. [Layout Handlers](#11-layout-handlers)

---

## 1. Overview

The engine accepts a `DocumentFragment`, `Element`, or mock node and produces a
sequence of fragments, one per fragmentainer (page or column). The `Fragment` class composes those fragments back into visible DOM elements
that the browser can paint.

### Pipeline

```
                          Layout Phase                     Fragmentation Phase
                    ________________________            ______________________

DocumentFragment
or Element
     |
     v
FragmentedFlow
  layout()
     |
     ├── <content-measure>   (internal, off-screen)
     │     injectFragment()
     │          |
     │          v
     ├── new DOMLayoutNode()
     │          |
     │          v
     └── DOMLayoutNode ──> next() / flow()  ────> Fragment[]
                                                          |
                                                          v
                                                  composeFragment()
                                                          |
                                                          v
                                                   DOM output
                                                   (<fragment-container>
                                                    elements with
                                                    shadow DOM)
```

**Layout phase.** `FragmentedFlow` accepts a `DocumentFragment` or `Element`
(elements are cloned internally). During `layout()`, it creates an off-screen
`<content-measure>` element, injects the content and stylesheets via
`injectFragment()`, and builds a `DOMLayoutNode` tree. `FragmentedFlow` extends
`Iterator` — `next()` lays out one fragmentainer at a time, and `flow()` runs
`next()` until content is exhausted, returning a `FragmentationContext`. Each
iteration produces one `<fragment-container>` element. Call
`destroy()` to remove the internal measurement container when done.

**Fragmentation phase.** `Fragment.build()` (`src/fragmentation/fragment.js`) walks each
fragment tree and clones DOM elements into visible DOM. For pages,
this produces `<fragment-container>` custom elements with shadow DOM. For
regions, the caller composes each fragment into the target region element
directly. `Fragment.map()` registers clone→source mappings for handlers
that need to resolve composed elements back to their source.

**Resolver pattern.** The engine supports multiple fragmentation modes through
resolvers -- objects with a `resolve(index, ...)` method that returns
per-fragmentainer constraints:

- **`PageResolver`** -- resolves dimensions from `@page` rules
- **`RegionResolver`** -- reads dimensions from DOM region elements via
  `getBoundingClientRect`
- **Custom resolvers** -- any object with `resolve()` returning an object with
  `toConstraintSpace()`

---

## 2. Generator-Based Layout

Each layout algorithm is a class (e.g. `BlockContainerAlgorithm`) with a
`*layout()` generator method. This design gives the engine cooperative
multitasking without callbacks or promises: the generator pauses at each
`yield`, hands control to a synchronous driver, and resumes when the driver
sends back a result.

### Why generators

A block container laying out its children needs to invoke child layout algorithms
that may themselves invoke further descendants. In a traditional recursive design,
this would be a deeply nested call stack with no opportunity for the top-level
driver to inspect or intercept intermediate results. Generators flatten this: each
algorithm yields a `LayoutRequest` to the driver, which decides how to fulfill it.

### Algorithm classes

An algorithm class stores the layout inputs on the instance (via private fields)
and exposes a single `*layout()` method:

```js
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
		// yield LayoutRequest objects, consume results, return { fragment, breakToken }
	}
}
```

`BlockContainerAlgorithm` is the only algorithm that accepts an
`earlyBreakTarget` — the other algorithms (`FlexAlgorithm`, `GridAlgorithm`,
`InlineContentAlgorithm`, `MulticolAlgorithm`, `TableRowAlgorithm`) have a
three-argument constructor.

### LayoutRequest

When a generator needs a child laid out, it yields a `LayoutRequest`:

```js
// Inside an algorithm's *layout() method:
const result = yield new LayoutRequest(child, childConstraintSpace, childBreakToken);
```

`LayoutRequest` (in `src/layout/layout-request.js`) has three fields:

- `node` -- the child `LayoutNode` to lay out
- `constraintSpace` -- the `ConstraintSpace` describing available size
- `breakToken` -- the child's break token from a previous fragmentainer, or `null`

### The driver: runLayoutGenerator

`runLayoutGenerator` (in `src/layout/layout-driver.js`) is the recursive driver
that runs algorithm instances to completion:

```js
export function runLayoutGenerator(algorithm) {
	const gen = algorithm.layout();
	let genResult = gen.next();

	while (!genResult.done) {
		const request = genResult.value;

		// Look up the algorithm class for the child node, instantiate it, and recurse
		const ChildAlgoClass = getLayoutAlgorithm(request.node);
		const childAlgo = new ChildAlgoClass(request.node, request.constraintSpace, request.breakToken);
		const childResult = runLayoutGenerator(childAlgo);

		// If child returned an earlyBreak, propagate it up immediately
		if (childResult.earlyBreak) return childResult;

		// Send the child's result back into the parent generator
		genResult = gen.next(childResult);
	}

	return genResult.value;
}
```

The loop works like this:

1. Call `algorithm.layout()` to obtain the generator.
2. Call `gen.next()` to advance to the first `yield`.
3. The yielded value is a `LayoutRequest`. Look up the correct child algorithm
   class via `getLayoutAlgorithm`, construct an instance, then recursively call
   `runLayoutGenerator(childAlgo)`.
4. If the child's result carries an `earlyBreak` (see
   [Two-Pass Break Scoring](#6-two-pass-break-scoring)), propagate it upward
   immediately -- the current pass is being abandoned.
5. Otherwise, send the child result back into the parent generator via
   `gen.next(childResult)`. The parent receives it as the return value of its
   `yield` expression.
6. Repeat until `genResult.done` is true. The final value is the parent's layout
   result.

### What a layout result contains

Each algorithm's `*layout()` generator returns an object with:

- `fragment` -- a `Fragment` for the portion that fit
- `breakToken` -- a `BlockBreakToken` or `InlineBreakToken` if content remains,
  or `null` if the node completed
- `earlyBreak` -- an `EarlyBreak` object if Pass 1 found a better breakpoint
  (see [Two-Pass Break Scoring](#6-two-pass-break-scoring))

---

## 3. The Fragmentation Loop

`FragmentedFlow.next()` lays out one fragmentainer per call. `flow()` is
sugar that calls `next()` until `breakToken` is null. Internally this is
implemented by `LayoutDriver` (in `src/layout/layout-driver.js`), which
extends `Iterator` and holds the per-fragmentainer state. The shim
`createFragments()` in `src/layout/layout-request.js` wraps
`new LayoutDriver(...).run()` for batch use.

Each `next()` call:

```
1. Resolve the ConstraintSpace for this fragmentainer (via resolver or fixed)
2. Sync the DOM measurement container to the new inline size
3. Run Pass 1: runLayoutGenerator(new RootAlgoClass(rootNode, constraintSpace, breakToken))
4. If result.earlyBreak exists:
     Run Pass 2: runLayoutGenerator(new RootAlgoClass(..., result.earlyBreak))
5. Accumulate counter state
6. Advance breakToken and fragmentainerIndex
7. Return the Fragment
```

The caller decides when to stop. For pages, `flow()` stops when `breakToken`
is null. For regions, the caller stops when region elements run out.

### Constraint space resolution

The engine supports multiple resolver types:

- **`PageResolver`** -- resolves per-page from `@page` rules (page mode)
- **`RegionResolver`** -- reads dimensions from DOM region elements (region mode)
- **Fixed `ConstraintSpace`** -- reused for every fragmentainer (multicol)
- **`width` / `height` sugar** -- creates a fixed constraint space (column mode)

### Continuation support

An optional `continuation` parameter allows `LayoutDriver` (and the
`createFragments` shim) to start at a specific fragmentainer index and block
offset. This supports flowing multiple independent elements across a shared
sequence of pages (e.g., footnotes following body content).

### Zero-progress safety

Real DOM content can contain elements with zero measured height (unloaded images,
empty containers, absolutely positioned children). The loop tracks consecutive
zero-progress fragmentainers and bails after 5 to prevent infinite loops.

---

## 4. Algorithm Dispatch

`getLayoutAlgorithm()` in `src/layout/layout-driver.js` maps a `LayoutNode` to
the correct algorithm **class**:

```js
export function getLayoutAlgorithm(node) {
	if (node.isMulticolContainer) return MulticolAlgorithm;
	if (node.isFlexContainer) return FlexAlgorithm;
	if (node.isGridContainer) return GridAlgorithm;
	if (node.isInlineFormattingContext) return InlineContentAlgorithm;
	if (node.isTableRow) return TableRowAlgorithm;
	return BlockContainerAlgorithm;
}
```

The driver instantiates the returned class with `(node, constraintSpace, breakToken)`
(plus an optional `earlyBreakTarget` for `BlockContainerAlgorithm`) and calls
`*layout()` to obtain the generator.

### Why order matters

The checks are ordered from most specific to least specific. A multicol container
with `display: flex` is both a multicol container and a flex container, but it
must be handled by `MulticolAlgorithm` because multicol establishes a
fragmentation context that wraps the flex layout. Checking `isMulticolContainer`
first ensures correct dispatch.

### Algorithm summary

| Algorithm                 | Source file                        | Handles                          |
| ------------------------- | ---------------------------------- | -------------------------------- |
| `MulticolAlgorithm`       | `algorithms/multicol-container.js` | `column-count` / `column-width`  |
| `FlexAlgorithm`           | `algorithms/flex-container.js`     | `display: flex` (row and column) |
| `GridAlgorithm`           | `algorithms/grid-container.js`     | `display: grid`                  |
| `InlineContentAlgorithm`  | `algorithms/inline-content.js`     | Line breaking, inline boxes      |
| `TableRowAlgorithm`       | `algorithms/table-row.js`          | `<tr>` with parallel cell flows  |
| `BlockContainerAlgorithm` | `algorithms/block-container.js`    | Default block layout             |

`BlockContainerAlgorithm` is the fallback and handles the majority of elements.
It is also the algorithm that multicol delegates to via the flow thread pattern
(see [Flow Thread Pattern](#8-flow-thread-pattern)).

### Margin collapsing

Block margin collapsing (CSS2 §8.3.1) is handled by `MarginState` in
`src/layout/margin-collapsing.js`. It adopts Chromium's LayoutNG `MarginStrut`
concept for correct handling of positive, negative, and mixed margins.

#### MarginStrut

Accumulates margins for CSS2 collapse resolution:

- All positive → `max(margins)`
- All negative → `min(margins)` (most negative)
- Mixed → `max(positives) + min(negatives)`

#### MarginState

Stateful tracker used by `BlockContainerAlgorithm`. Instantiated at the top of
the child loop and called at four points per child:

1. **`computeMarginBefore(child, params)`** — resolves the collapsed margin
   between the previous sibling's margin-end and the current child's
   margin-start. Returns `{ marginDelta, collapsedThrough }`.

2. **`collapseAdjustment(collapsedThrough, isResumingChild)`** — computes the
   adjustment for through-collapse (parent's margin collapsing with first
   child's margin when no padding/border separates them).

3. **`applyAfterLayout(child, collapsedThrough, isResumingChild)`** — updates
   state after the child is laid out, storing the child's margin-end for the
   next sibling.

4. **`trailingMargin(hasBreak, hasChildren)`** — after the child loop, adds
   the last child's deferred margin-end when no break follows.

#### Through-collapse

When a parent has no `padding-block-start` and no `border-block-start`, its
margin-block-start collapses with the first child's margin-block-start. This
is recursive — `collectThroughMargins()` walks nested first children to
accumulate margins for multi-level through-collapse.

#### Fragmentation truncation

Per CSS Fragmentation L3 §5.2:

- The first child on a **continuation page** has its margin-block-start
  truncated (unless through-collapse is active or body margin is present).
- The last child before a **break** has its margin-block-end truncated.

#### Body margin collapsing

The UA stylesheet sets `slot { margin: 8px }` as the body proxy. On the
first page, this margin collapses with the first child's margin:
`max(8px, childMargin)`. On continuation pages, the slot's
`margin-block-start` is zeroed via the UA stylesheet.

`FragmentedFlow` passes the body margin to the constraint space as
`bodyMarginBlockStart`, and `MarginState` includes it in the first child's
margin strut.

---

## 5. Break Tokens

A break token is a continuation token for layout. When content does not fit in
the current fragmentainer, the layout algorithm produces a fragment for the
portion that fits and attaches a break token that encodes how to resume in the
next fragmentainer.

### Tree structure

Break tokens form a **sparse tree** that mirrors the CSS box tree. A
`BlockBreakToken` has a `childBreakTokens` array containing tokens for its
child nodes. Only children that need resumption (or have been marked as
completed) appear in the array -- children not yet visited have no token entry.

```
BlockBreakToken (root)
  consumedBlockSize: 400
  childBreakTokens:
    BlockBreakToken (section)
      consumedBlockSize: 200
      childBreakTokens:
        InlineBreakToken (paragraph)
          itemIndex: 3
          textOffset: 147
```

### BlockBreakToken

Defined in `src/fragmentation/tokens.js`. Key fields:

- **`consumedBlockSize`** -- cumulative block-axis space consumed by ALL
  previous fragments of this node. For a node with `height: 600px` that has
  consumed 400px, there are 200px remaining. For `height: auto`, this tracks
  how much content has been produced so far.

- **`sequenceNumber`** -- per-node fragment counter. First fragment = 0,
  second = 1, etc. Used by the composition to determine split attributes.

- **`childBreakTokens`** -- array of child break tokens. Each child is either
  unfinished (resume it) or finished with `isAtBlockEnd: true` (skip it, but
  keep it for parallel flow bookkeeping).

- **`algorithmData`** -- optional layout-mode-specific resumption state.
  Different algorithms (table, grid, flex, multicol) attach their own data
  here (e.g., `multicolData` with column break tokens and flow thread state).

### Factory methods

```js
BlockBreakToken.createBreakBefore(node, isForcedBreak);
// Break before a node -- no fragment was produced. Used when a node is pushed
// to the next fragmentainer or a forced break (break-before: page) fires.

BlockBreakToken.createRepeated(node, sequenceNumber);
// For repeated content like table headers that appear in every fragmentainer.
```

### InlineBreakToken

For inline formatting contexts (text and inline-level boxes). Key fields:

- **`itemIndex`** -- index into the flat `InlineItemsData.items` array
- **`textOffset`** -- offset into `InlineItemsData.textContent`

These are **content-addressed**, not geometry-addressed. The token says "resume
at character 147 of inline item 3" rather than "resume at pixel offset 312".
This means inline break tokens survive changes in inline size between
fragmentainers -- the line-breaking algorithm re-wraps text from the content
offset, adapting to the new available width.

### Key flags

All break token types inherit these boolean flags from `BreakToken`:

| Flag                      | Meaning                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `isBreakBefore`           | Break before this node -- pass `null` as the child's token     |
| `isForcedBreak`           | Break was caused by `break-before` / `break-after` CSS         |
| `isAtBlockEnd`            | Node completed -- keep token for parallel flow bookkeeping     |
| `hasSeenAllChildren`      | All children visited, even if some remain unfinished           |
| `isRepeated`              | Repeated content (table headers/footers in each fragmentainer) |
| `isCausedByColumnSpanner` | Break caused by a column-spanning element                      |

### Resumption rules

- When `isBreakBefore` is set on a child's token, pass `null` as that child's
  break token to the layout algorithm. The child starts fresh in the new
  fragmentainer.
- `findChildBreakToken(parentBreakToken, childNode)` (in `src/fragmentation/tokens.js`)
  locates the child's token within the parent's `childBreakTokens` array.
- When all placed children have completed but unvisited children remain,
  `createBreakBefore(nextChild)` is pushed so the next fragmentainer picks up
  at the correct child index.

---

## 6. Two-Pass Break Scoring

Not all breakpoints are equal. CSS Fragmentation Level 3 defines rules for
where breaks should and should not occur. The engine uses a two-pass approach
to find the best breakpoint.

### BreakScore

Scores are ordered from best (lowest) to worst (highest):

| Value | Name                       | Meaning                                     |
| ----- | -------------------------- | ------------------------------------------- |
| 0     | `PERFECT`                  | No rules violated                           |
| 1     | `VIOLATING_ORPHANS_WIDOWS` | Violates `orphans` or `widows` constraint   |
| 2     | `VIOLATING_BREAK_AVOID`    | Violates `break-before/after/inside: avoid` |
| 3     | `LAST_RESORT`              | No valid Class A breakpoint exists          |

`scoreClassABreak(prevChild, nextChild)` evaluates the break quality between two
siblings by checking `break-after` on the previous child and `break-before` on
the next. `applyBreakInsideAvoid(node, score)` degrades the score if the parent
has `break-inside: avoid`.

### EarlyBreak chain

An `EarlyBreak` records the best breakpoint found during layout:

```js
class EarlyBreak {
	node; // which node to break at
	score; // BreakScore value
	type; // EARLY_BREAK_BEFORE or EARLY_BREAK_INSIDE
	childEarlyBreak; // link to a deeper EarlyBreak, or null
}
```

The `childEarlyBreak` field forms a linked chain. This chain describes the path
from the root down to the optimal breakpoint, which may be arbitrarily deep in
the box tree. For example: "break inside the root > inside section > before
paragraph 3."

### How the two passes work

**Pass 1 (discovery).** Layout runs normally. As each child completes, the
algorithm scores the breakpoint. If the score is better than the current best, a
new `EarlyBreak` is recorded. When content overflows the fragmentainer, the
algorithm compares the actual break's score against the best early break's score.
If the early break is better, the result carries `earlyBreak` back to the driver.

**Pass 2 (targeted).** The `createFragments` loop detects the `earlyBreak` on
the result and re-runs `runLayoutGenerator` with the `earlyBreak` as the
`earlyBreakTarget` parameter. During Pass 2, the algorithm breaks at the
targeted node instead of waiting for overflow. This produces a fragment with the
better breakpoint.

Pass 2 only runs when needed -- if the actual break is already `PERFECT`, there
is nothing to improve and the result is used as-is.

---

## 7. Parallel Flows

Some layout modes contain multiple independent flows that must be fragmented in
parallel:

- **Table rows** -- each cell in a `<tr>` is an independent flow
- **Flex rows** -- each item in a `flex-direction: row` container
- **Grid rows** -- grid items sharing the same row

### The pattern

In parallel flow layout, all sibling items are laid out independently for the
current fragmentainer. The tallest item determines how much block-axis space the
row consumes. If any item breaks, all items get break tokens -- even items that
completed without breaking. Completed items receive a token with
`isAtBlockEnd: true`.

On resumption in the next fragmentainer, the algorithm must know which items
still have content and which are done. An `isAtBlockEnd` token produces a
zero-height empty fragment for that item, keeping the parallel structure intact.
Without it, the algorithm would lose track of item positions within the row.

### Table rows

`TableRowAlgorithm` (in `src/algorithms/table-row.js`) implements this pattern. Each
`<td>` / `<th>` is dispatched via `yield layoutChild(cell, ...)`. After all
cells return, the row determines the break point. If any cell broke, every cell
gets a break token. The `algorithmData` on the row's `BlockBreakToken` stores
per-cell state for resumption.

### Flex and grid

`FlexAlgorithm` handles `flex-direction: row` items as parallel flows and
`flex-direction: column` items as a sequential flow thread (see
[Flow Thread Pattern](#8-flow-thread-pattern)). `GridAlgorithm` groups
items by row and treats each row's items as parallel flows.

---

## 8. Flow Thread Pattern

Multicol layout uses an anonymous block wrapper called the **flow thread**. This
is borrowed directly from Chromium's LayoutNG architecture.

### The problem

`MulticolAlgorithm` manages columns (fragmentainers within a
fragmentainer). If it dispatched its children directly via
`getLayoutAlgorithm`, each child would be routed to its own algorithm -- and
the multicol container would need to duplicate all of `BlockContainerAlgorithm`'s
logic for managing child sequences, margins, and break tokens.

### The solution

Instead, `MulticolAlgorithm` creates a synthetic `LayoutNode` that wraps
the container's children. When this synthetic node is passed to
`getLayoutAlgorithm`, none of the special checks (`isMulticolContainer`,
`isFlexContainer`, etc.) match, so it falls through to `BlockContainerAlgorithm`.

This means the multicol algorithm only needs to manage the column loop (creating
column constraint spaces, collecting column fragments, handling column breaks).
The actual content layout is delegated to `BlockContainerAlgorithm` running against
the synthetic flow thread node.

### Column flow

```
MulticolAlgorithm
  |
  +-- for each column:
  |     resolve column ConstraintSpace
  |     yield layoutChild(flowThreadNode, columnConstraintSpace, columnBreakToken)
  |       |
  |       +-- getLayoutAlgorithm(flowThreadNode) -> BlockContainerAlgorithm
  |             (lays out the multicol container's children sequentially)
  |
  +-- collect column fragments
  +-- if column broke, continue to next column
  +-- if all columns filled or content exhausted, return
```

`flex-direction: column` also uses this pattern. The flex container creates a
flow thread for its items and delegates to `BlockContainerAlgorithm` for the
sequential item flow within each fragmentainer.

---

## 9. DOM Adapter

`DOMLayoutNode` in `src/layout/layout-node.js` wraps a real DOM `Element` in the
`LayoutNode` interface that layout algorithms expect. It is read-only and never
mutates the DOM.

### Lazy resolution

All properties are computed on first access and cached:

- **`_style`** -- result of `getComputedStyle(element)`, cached on first read
- **`_styleMap`** -- CSS Typed OM values via `computedStyleMap(element)`, cached
  on first read
- **`_children`** -- child `DOMLayoutNode` wrappers, created on first access
- **`_inlineItemsData`** -- flat `InlineItemsData` collected only when
  `isInlineFormattingContext` is true

This laziness matters because layout often skips subtrees entirely (monolithic
content, elements pushed to the next fragmentainer). Eagerly computing styles
and wrapping children for every node in the DOM tree would be wasteful.

### Key properties

Layout algorithms read these properties from `LayoutNode`:

| Property                     | Source                                         |
| ---------------------------- | ---------------------------------------------- |
| `isMulticolContainer`        | `column-count` or `column-width` is set        |
| `isFlexContainer`            | `display: flex` or `display: inline-flex`      |
| `isGridContainer`            | `display: grid` or `display: inline-grid`      |
| `isInlineFormattingContext`  | Block with only inline-level children          |
| `isTableRow`                 | `display: table-row`                           |
| `isReplacedElement`          | `<img>`, `<video>`, `<canvas>`, `<svg>`, etc.  |
| `breakBefore` / `breakAfter` | `break-before` / `break-after` computed values |
| `breakInside`                | `break-inside` computed value                  |
| `blockSize`                  | Measured via `getBoundingClientRect`           |
| `children`                   | Array of child `DOMLayoutNode` wrappers        |
| `inlineItemsData`            | Flat inline content representation             |

### InlineItemsData

For inline formatting contexts, `collectInlineItems()` (in
`src/measurement/collect-inlines.js`) walks the DOM subtree and produces a flat
representation:

- `items` -- array of typed items (`INLINE_TEXT`, `INLINE_OPEN_TAG`,
  `INLINE_CLOSE_TAG`, `INLINE_ATOMIC`, `INLINE_CONTROL`)
- `textContent` -- concatenated text content of all text items

This flat representation is what `InlineBreakToken` indexes into with
`itemIndex` and `textOffset`, and what `Fragment.buildInlineContent()` uses
to reconstruct DOM from offset ranges.

### DOMLayoutNode

`new DOMLayoutNode(element)` from `src/layout/layout-node.js` wraps a DOM element
as a lazy layout tree root. The resulting node is the `rootNode` passed to
`createFragments()` or `FragmentedFlow.flow()`.

---

## 10. Fragmentation

The `Fragment` class (`src/fragmentation/fragment.js`) converts the immutable fragment
tree produced by layout into visible DOM that the browser can paint. This is
analogous to Chromium's `BoxFragmentPainter`, but instead of producing display
lists we clone DOM elements and let the browser compose them.

The cloned-DOM approach is inspired by Gecko/Firefox, which for print and print
preview builds a non-destructive static clone of the source document
(`nsIDocument::CreateStaticClone`) and runs pagination against the clone.

### Fragment.build()

`build(inputBreakToken)` walks a fragment's child fragments and dispatches
based on node type:

1. If `fragment.multicolData` exists — compose as a multicol container
2. If `node.isInlineFormattingContext` — compose inline content
3. If fragment has block children — shallow-clone the element, recurse into
   children
4. Otherwise — leaf node, deep-clone the element

Returns a `DocumentFragment` containing the composed DOM. For block containers,
the element is cloned with `cloneNode(false)` (shallow), and children are
composed recursively. This ensures each fragment gets its own DOM subtree.

### Fragment.map()

`map(inputBreakToken, composedParent)` walks the fragment tree and composed
DOM in parallel, registering each clone→source pair in the handler registry's
shared map. This mapping is used by handlers (NthSelectors, MutationSync)
to resolve composed elements back to their source.

### Inline content reconstruction

`Fragment.buildInlineContent(items, textContent, startOffset, endOffset, container)`
reconstructs DOM from the flat `InlineItemsData` list. It walks items between
the start and end offsets (determined by `InlineBreakToken` positions), creating
text nodes, opening/closing inline elements, and inserting atomic inlines.

This approach means inline composition is driven entirely by content offsets,
not by DOM node references — no splitting or modification of the original DOM
text nodes is needed.

### Fragment containers

`FragmentationContext.createFragmentainer(index)` creates a `<fragment-container>`
custom element with a shadow DOM root. The shadow root adopts the content
stylesheets and `OVERRIDES`, then `fragment.build()` produces the composed DOM
and `fragment.map()` registers the clone→source mappings. Each
`<fragment-container>` represents one page or column in the output.

### Split attributes

`#applySplitAttributes(el, inputBreakToken)` marks elements at break
boundaries:

- `data-split-from` -- set on the first element in a continuation fragment
  (the element was split from a previous fragmentainer)
- `data-split-to` -- set on the last element before a break (the element
  continues in the next fragmentainer)

These attributes serve two purposes: they allow CSS authors to style split
elements differently, and they drive the `OVERRIDES` stylesheet's suppression
rules.

### OVERRIDES stylesheet

`OVERRIDES` (in `src/styles/overrides.js`) is a shared `CSSStyleSheet`
adopted last in every fragment container's shadow DOM. It contains rules that
fix visual artifacts at break boundaries:

- **`text-indent`** -- suppressed on `[data-split-from]` elements (continuation
  fragments should not re-indent)
- **`::first-letter`** -- suppressed on `[data-split-from]` elements
- **`::before` / `::after`** -- suppressed on continuation fragments to prevent
  duplicate generated content
- **Counters and list markers** -- reset or hidden on continuation fragments
- **`text-align-last: justify`** -- applied on `[data-split-to][data-justify-last]`
  elements so that the last visible line of a justified paragraph is fully
  justified when the paragraph continues in the next fragmentainer

### Box decoration handling

For elements with `box-decoration-break: slice` (the default), the composition
adjusts borders, padding, and margins at break boundaries. The top
border/padding/margin is removed on `data-split-from` elements, and the bottom
border/padding/margin is removed on `data-split-to` elements, giving the
appearance that the box was sliced across fragmentainers.

For `box-decoration-break: clone`, each fragment gets the full box decoration
(all four sides of border, padding, and margin).

---

## 11. Layout Handlers

The engine supports **layout handlers** — self-contained extensions that hook into
the layout and composition pipeline without modifying core algorithms. Handlers are
managed by a global `HandlerRegistry` and all built-in handlers are registered
automatically at import time.

### Hook points

Handlers interact with the engine at these hook points, listed in lifecycle order:

1. **`resetRules()`** — clear state from a previous CSS rule walk. Called at the
   start of `processRules()`.

2. **`matchRule(rule, context)`** — called once per leaf `CSSStyleRule` during
   the centralized rule walk. `context.wrappers` provides grouping rule
   preambles (e.g., `["@media screen"]`). Handlers accumulate state here.

3. **`appendRules(rules)`** — push CSS rule text strings into `rules[]` to be
   inserted into a shared stylesheet prepended to the styles array.

4. **`claimPersistent(content)`** — called before measurement begins. Returns
   elements that must be present in every measurement segment (e.g.,
   `position: fixed` elements).

5. **`claimPseudo(element, pseudo, contentValue)`** — called during pseudo-element
   materialization. Return `true` to claim the pseudo and prevent default handling.

6. **`claimPseudoRule(rule, pseudo)`** — called during CSS pseudo-element rule
   rewriting. Return `true` to skip rewriting this rule.

7. **`afterMeasurementSetup(contentRoot)`** — called after the measurement
   container is fully set up (content injected, pseudo-elements materialized,
   styles resolved). The live DOM is available for `getComputedStyle()` queries.
   Handlers can probe elements and build internal state (e.g., generated
   stylesheets). Must not modify the measurer's adopted stylesheets.

8. **`getAdoptedSheets()`** — returns `CSSStyleSheet[]` to be adopted on each
   fragment-container's shadow DOM. Called when creating a `FragmentationContext`.

9. **`layout(rootNode, constraintSpace, breakToken, layoutChild)`** — called
   before the normal layout pass for each fragmentainer. Scans root children,
   claims nodes, lays out claimed content via the `layoutChild` callback, and
   returns space reservations (`reservedBlockStart`, `reservedBlockEnd`) plus an
   `afterRender` closure.

10. **`claim(node)`** — during block container layout, each child is checked
    against all handlers. If any handler returns `true`, the child is skipped in
    normal flow.

11. **`beforeChildren(node, constraintSpace, breakToken)`** — called before the
    child loop in `BlockContainerAlgorithm`. Returns a layout request descriptor for
    content to prepend (e.g., repeated table headers), or `null`.

12. **`afterContentLayout(fragment, constraintSpace, inputBreakToken)`** — called
    after content layout completes. Handlers can inspect the fragment and request
    additional block-end space (e.g., footnotes). Returning a different
    `reservedBlockEnd` triggers a re-layout.

### Handler options

`FragmentedFlow` passes its constructor options to all registered handlers via
`handlers.setOptions(options)`. Handlers read `this.options` to check for flags.
This avoids tight coupling between `FragmentedFlow` and individual handlers.

See [Layout Handlers](handlers.md) for the full handler interface and how to write
custom handlers.
