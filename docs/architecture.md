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
10. [Fragmentation](#10-fragmentation)
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
Fragmenter
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
                                                   Fragment.build()
                                                          |
                                                          v
                                                   DOM output
                                                   (<fragment-container>
                                                    elements with
                                                    light-DOM content)
```

**Layout phase.** `Fragmenter` accepts a `DocumentFragment` or `Element`
(elements are cloned internally). During `layout()`, it creates an off-screen
`<content-measure>` element, injects the content and stylesheets, and builds a
`DOMLayoutNode` tree. `Fragmenter` extends `Iterator` — `next()` lays out one
fragmentainer at a time, while `flow()` runs the shared stepper to exhaustion
and returns a `FragmentationContext`. Each iteration produces one
`<fragment-container>` element. Measurement is released automatically when a
run completes or iteration exits early; `destroy()` additionally tears down
handlers, generated styles, preloaded fonts, and retained layout state.

**Fragmentation phase.** `Fragment.build()` (`src/fragmentation/fragment.js`) walks each
fragment tree and clones DOM elements into visible DOM. For pages,
this produces `<fragment-container>` custom elements that host the cloned
content as light-DOM children (projected through a `<slot>` in a thin
shadow scaffold). For regions, the caller appends each resulting
`<fragment-container>` to the corresponding target region. `Fragment.build()`
registers clone→source mappings in the flow's `CloneMap` while it composes,
allowing handlers to resolve rendered elements back to their sources.

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

`BlockContainerAlgorithm` owns Class A break scoring. Flex, grid, multicol, and
table-row algorithms also accept an `earlyBreakTarget` and forward it to their
descendants; `InlineContentAlgorithm` has the three-argument constructor.

### LayoutRequest

When a generator needs a child laid out, it yields a `LayoutRequest`:

```js
// Inside an algorithm's *layout() method:
const result = yield new LayoutRequest(child, childConstraintSpace, childBreakToken);
```

`LayoutRequest` (in `src/layout/layout-request.js`) has four fields:

- `node` -- the child `LayoutNode` to lay out
- `constraintSpace` -- the `ConstraintSpace` describing available size
- `breakToken` -- the child's break token from a previous fragmentainer, or `null`
- `earlyBreakTarget` -- the optional Pass 2 target to forward to the child

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
		const childAlgo = new ChildAlgoClass(
			request.node,
			request.constraintSpace,
			request.breakToken,
			request.earlyBreakTarget,
		);
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

`Fragmenter` (`src/fragmentation/fragmenter.js`) owns the engine's only
fragmentainer loop. It extends `Iterator` and holds the per-fragmentainer state.
Three entry points share one private step:

- **`next()`** — lays out one fragmentainer and returns its
  `<fragment-container>` element
- **`flow({ start, stop })`** — runs layout to completion and returns a
  `FragmentationContext`
- **`reflow(fromIndex)`** — rewinds to the break token before `fromIndex` and
  re-runs from there

`createFragments(rootNode, constraintSpaceOrResolver, continuation)` (in
`src/fragmentation/create-fragments.js`) is the batch entry point for an
already-built layout tree. It wraps the tree in a flow, runs `flow()`, and
returns the `Fragment[]`. There is nothing to measure and nothing to compose
against, so that flow drives a `NullMeasurer` and produces no elements.

Each step:

```
1. Arrange the measurer for the break token's segment: one batch of DOM writes,
   one reflow. A changed arrangement marks the composite sheet for rebuild at
   the next composition (never during layout: a document sheet mutation forces
   a full layout)
2. If a side-specific break needs a blank page, emit one and skip layout
3. Resolve the ConstraintSpace for this fragmentainer (via resolver or fixed)
4. On the run's first fragmentainer, apply the continuation's block offset
5. Carry the root's block-start margin for first-child margin collapsing
6. Sync the DOM measurement container to the new inline size
7. Reserve block-start/block-end space via handlers.layout()
8. Run Pass 1: runLayoutGenerator(new RootAlgoClass(rootNode, adjustedSpace, breakToken))
9. If result.earlyBreak exists:
     Run Pass 2: runLayoutGenerator(new RootAlgoClass(..., result.earlyBreak))
10. Run handlers.afterContentLayout(); if the reservation moved, redo 8-9
11. Accumulate counter state
12. Advance breakToken and fragmentainerIndex
13. Apply the zero-progress guard and decide whether iteration is finished
14. Return the Fragment
```

The caller decides when to stop. For pages, `flow()` stops when `breakToken`
is null and no parallel flow still holds content. For regions, the caller stops
when region elements run out.

### Post-layout adjustment

Steps 7-9 iterate; `handlers.layout()` itself runs once per fragmentainer, and
always against the unadjusted constraint space. What repeats is the reservation
total, the constraint-space rebuild, and the layout passes.

A handler often cannot know how much block-end space it needs until it sees what
landed on the page — footnotes reserve room for the notes the page actually
references. `afterContentLayout()` reports the reservation the handler now wants;
when that differs from the one layout ran with, the constraint space is rebuilt
and the content is laid out again. Parallel flows are rolled back to their
page-start snapshot before each repeat so a settled flow is not re-laid against
an already-advanced queue. The loop ends when the reservation stabilises, or
after `MAX_POST_LAYOUT_ITERATIONS` (3) re-runs.

### Main-flow completion vs iteration completion

`#mainDone` (the main content has all been placed) is tracked separately from
`#done` (iteration is over). A parallel flow can still hold carry-over when the
main content ends — footnotes pushed off the last page — so the loop keeps
emitting fragmentainers, with empty main content, until every flow has drained.

### Measurer segments

Top-level forced breaks and named-page changes divide content into measurement
segments. The measurer owns one `<content-measure>` and rearranges its slot from
the segment index and break token alone. The live slot contains the active
segment, persistent elements, and any earlier top-level box that still has
in-flow or parallel-overflow content. `measurer.arrange(breakToken, tree)` runs
at the start of every fragment and also when `reflow()` rewinds. An arrangement
is one batch of DOM writes (node moves, `beforeMeasurement()` mutations such as
pseudo materialization and `data-ref` stamps) followed by one reflow; layout's
geometry reads then find the tree clean. Arranging at the start of a fragment
lets that reflow also absorb whatever a consumer wrote between steps, such as an
appended page. A changed arrangement re-stamps handler data refs and
normalization rules, so the flow rebuilds its composite stylesheet, but only at
the next composition: mutating a document stylesheet forces a full layout, which
the segment's own reads would otherwise pay a second time.

When a boundary element becomes active for the first time, the measurer runs
`beforeMeasurement()` and invalidates that element's cached child structure.
This preserves pseudo-elements materialized by handlers without replacing the
element's `DOMLayoutNode` identity used by existing break tokens.

### Constraint space resolution

The engine supports multiple resolver types:

- **`PageResolver`** -- resolves per-page from `@page` rules (page mode)
- **`RegionResolver`** -- reads dimensions from DOM region elements (region mode)
- **Fixed `ConstraintSpace`** -- reused for every fragmentainer (multicol)
- **`width` / `height` sugar** -- creates a fixed constraint space (column mode)

### Continuation support

`options.continuation = { fragmentainerIndex, blockOffset }` starts a flow at a
given fragmentainer index with part of that fragmentainer already consumed. The
first fragmentainer is laid out against a block size reduced by the offset;
every later one gets the full size. The outgoing resume point is on the flow's
`continuation` getter, and `createFragments()` returns it as
`{ fragments, continuation }` when it was given one. This supports flowing
multiple independent elements across a shared sequence of pages (e.g., footnotes
following body content).

`reflow(fromIndex)` resumes from the fragment immediately before the requested
absolute fragmentainer index and returns only the reflowed suffix. That previous
fragment is passed to the new `FragmentationContext` so the first rebuilt
element retains counter state and split-decoration continuity. Segmented
measurement is rearranged to the same input token. With `{ rebuild: true }`,
layout nodes and their tokens are replaced, so reflow restarts from the run's
beginning.

### Zero-progress safety

Real DOM content can contain elements with zero measured height (unloaded images,
empty containers, absolutely positioned children). The loop tracks consecutive
zero-progress fragmentainers and bails after 5 to prevent infinite loops.
Fragments carrying real descendant content after a fixed-size ancestor reaches
its block end count as progress even when that ancestor contributes no extent.
Blank pages do not count — they skip layout, so they say nothing about progress.

---

## 4. Algorithm Dispatch

`getLayoutAlgorithm()` in `src/layout/layout-driver.js` maps a `LayoutNode` to
the correct algorithm **class**:

```js
export function getLayoutAlgorithm(node) {
	if (node.isMulticolContainer) return MulticolAlgorithm;
	if (node.isFlexContainer) return FlexAlgorithm;
	if (node.isGridContainer) return GridAlgorithm;
	if (node.isInlineNode) return InlineContentAlgorithm;
	if (node.isTableRow) return TableRowAlgorithm;
	return BlockContainerAlgorithm;
}
```

Every element node is a block container to the driver; only the anonymous
inline node (`isInlineNode`) goes to `InlineContentAlgorithm`. The block
container owns the box — its specified block-size counts the extent of every
fragment against it (CSS Fragmentation §5.3), clamped by `min-height` and
`max-height`. When the rest of the box does not fit after its content, the box
breaks there (a Class C break point, §4.1) and continues as an empty fragment
carrying the remaining extent and block-end decorations. If content outlives a
fixed-size box, the box reaches `isAtBlockEnd` and that descendant content
continues as a parallel overflow flow with no additional box extent. Repeated
`box-decoration-break: clone` insets wrap each fragment but do not count toward
the consumed block-size. The inline algorithm only places lines and breaks
between them (Class B).

The driver instantiates the returned class with
`(node, constraintSpace, breakToken, earlyBreakTarget)` and calls `*layout()`
to obtain the generator. The inline algorithm ignores the fourth argument;
container algorithms either honor it or forward it to descendants.

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
| `InlineContentAlgorithm`  | `algorithms/inline-content.js`     | Line boxes of an anonymous inline node |
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
   margin-start. Returns `{ marginDelta, collapsedThrough, consumedPrevMarginEnd }`.

2. **`collapseAdjustment(collapsedThrough, isResumingChild)`** — computes the
   adjustment for through-collapse (parent's margin collapsing with first
   child's margin when no padding/border separates them).

3. **`applyAfterLayout(child, collapsedThrough, isResumingChild, childBroke, context)`** — updates
   state after the child is laid out, including self-collapsing boxes, and
   stores the child's margin-end for the next sibling.

4. **`trailingMargin(hasBreak, hasChildren, isForcedBreak)`** — after the child
   loop, adds the last child's deferred margin-end when no break follows or the
   break is forced.

#### Through-collapse

When a parent has no `padding-block-start` and no `border-block-start`, its
margin-block-start collapses with the first child's margin-block-start. This
is recursive — `collectThroughMargins()` walks nested first children to
accumulate margins for multi-level through-collapse.

#### Fragmentation truncation

Per CSS Fragmentation L3 §5.2:

- The first child after an **unforced continuation break** has its
  margin-block-start truncated.
- The last child before an **unforced break** has its margin-block-end
  truncated.
- Margins adjoining a forced Class A break are preserved.

#### Body margin collapsing

The UA stylesheet sets `slot { margin: 8px }` as the body proxy. On the
first page, this margin collapses with the first child's margin:
`max(8px, childMargin)`. On continuation pages, the slot's
`margin-block-start` is zeroed via the UA stylesheet.

`Fragmenter` passes the body margin to the constraint space as
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
  consumed 400px, there are 200px remaining. Insets repeated by
  `box-decoration-break: clone` are excluded because they sit outside the
  box's own block-size.

- **`sequenceNumber`** -- per-node fragment counter. First fragment = 0,
  second = 1, etc. Used by the composition to determine split attributes.

- **`childBreakTokens`** -- array of child break tokens. Each child is either
  unfinished (resume its in-flow content), at its own block end while
  descendants continue as parallel overflow, or fully complete but retained
  for parallel-flow track bookkeeping.

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
- **`textOffset`** -- offset into `InlineItemsData.textContent` (resume cursor: points at the first character of the next fragmentainer, not the last of the current one)
- **`isHyphenated`** -- break falls mid-word; set only when the containing text's CSS `hyphens` allows it (`manual` requires a soft hyphen at the break; `auto` also flags dictionary breaks; `none` never flags). Render layer appends `hyphenateCharacter` to page N's last text node
- **`hyphenateCharacter`** -- resolved glyph to append (parsed from the CSS `hyphenate-character` computed value; defaults to U+2010 HYPHEN when `auto`)
- **`hasTrailingCollapsibleSpace`** -- a collapsible line-end space sits at `textOffset - 1`; the render layer trims it from page N's last text node (CSS Text §4.1.1 — `white-space` values `normal`, `nowrap`, `pre-line`, `pre-wrap`)

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

### Resumption rules

- When `isBreakBefore` is set on a child's token, pass `null` as that child's
  break token to the layout algorithm. The child starts fresh in the new
  fragmentainer.
- `findChildBreakToken(parentBreakToken, childNode, taken?)` (in
  `src/fragmentation/tokens.js`) locates the child's token. The optional set
  disambiguates anonymous flex-line and grid-row siblings that share a node.
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

**Pass 2 (targeted).** The fragmentation loop detects the `earlyBreak` on
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
still have in-flow content, which continue only as overflow past their block
end, and which are done. An `isAtBlockEnd` token contributes no new box extent,
but composition keeps an empty box shell so the parallel track does not
collapse or shift. Descendant overflow is built inside that shell.

### Table rows

`TableRowAlgorithm` (in `src/algorithms/table-row.js`) implements this pattern. Each
`<td>` / `<th>` is dispatched via `yield layoutChild(cell, ...)`. After all
cells return, the row determines the break point. If any cell broke, every cell
gets a break token under the row token; `algorithmData.type` identifies the
table-row token.

### Flex and grid

`FlexAlgorithm` handles `flex-direction: row` items as parallel flows and
`flex-direction: column` items as a sequential flow thread (see
[Flow Thread Pattern](#8-flow-thread-pattern)). `GridAlgorithm` groups items by
row and treats each row's items as parallel flows. Flex and grid container
tokens nest the active line or row's item tokens beneath a single anonymous
wrapper token, so each repeated line/row matches its own continuation state.

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

Most properties are computed on first access and cached:

- **Computed style snapshot** -- CSS Typed OM values via
  `computedStyleMap(element)`, cached in `#styleMap`
- **`#children`** -- child `DOMLayoutNode` wrappers, created on first access. A
  block whose children are inline-level gets a single `AnonymousBlockNode`
  child holding all of them (CSS 2.1 §9.2.1.1); that node collects the
  `InlineItemsData` and is what the inline algorithm lays out.

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
| `isInlineFormattingContext`  | Block with only inline-level children; its one child is the anonymous inline node |
| `isInlineNode`               | The anonymous inline node itself (`AnonymousBlockNode`) |
| `isTableRow`                 | `display: table-row`                           |
| `isReplacedElement`          | `<img>`, `<video>`, `<canvas>`, `<svg>`, etc.  |
| `breakBefore` / `breakAfter` | `break-before` / `break-after` computed values |
| `breakInside`                | `break-inside` computed value                  |
| `blockSize`                  | Measured via `getBoundingClientRect`           |
| `blockSizeLimits()`          | Border-box `height`, `min-height`, and `max-height` limits |
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
`createFragments()` or `Fragmenter.flow()`.

---

## 10. Fragmentation

The `Fragment` class (`src/fragmentation/fragment.js`) converts the fragment
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
2. If `node.isInlineNode` — compose its line boxes straight into the parent's clone
3. If fragment has block children — shallow-clone the element, recurse into
   children
4. Otherwise — leaf node, deep-clone the element

Returns a `DocumentFragment` containing the composed DOM. For block containers,
the element is cloned with `cloneNode(false)` (shallow), and children are
composed recursively. This ensures each fragment gets its own DOM subtree.

As `build()` clones elements, it registers each clone→source pair in the flow's
`CloneMap`. This mapping is used by handlers such as `MutationSync`; there is no
separate mapping pass.

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
custom element. `fragment.build()` produces the composed DOM, which is
appended as light-DOM children of the host (projected visually through the
`<slot>` in the host's shadow scaffold), registering clone→source mappings as
it goes. Stylesheets aren't adopted per-instance — the engine
builds one composite scoped sheet per `Fragmenter` and adopts it on
`document.adoptedStyleSheets` (see [§ Composite scoped sheet](#composite-scoped-sheet)
below). Each `<fragment-container>` represents one page or column in the
output.

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

### Composite scoped sheet

`buildCompositeSheet` (in `src/styles/composite-sheet.js`) assembles one
`CSSStyleSheet` per `Fragmenter` and adopts it on
`document.adoptedStyleSheets`. It's wrapped in
`@scope (fragment-container) { ... }` so engine-generated rules style only
fragment-container subtrees and don't leak onto the host page. In source
order:

1. **`@layer { UA defaults }`** — for page-based flows, restore `body`'s 8px
   margin on the host (see `src/styles/ua-defaults.js`). Column and region
   flows omit this layer.
2. **Body-rewriter rules** — `body`/`html` author rules rewritten to
   `:scope` for the fragment-container side.
3. **Neutralization** — for every author rule whose selector contains a
   structural pseudo (`:nth-child`, `:first-child`, etc.), per-property
   `unset !important` on the same selector (see
   `src/styles/neutralize-structural-pseudos.js`). Suppresses cloned-position
   incorrect matches from the originals in `document.styleSheets`.
4. **StyleResolver per-element rules** — re-emit each matched rule with
   its structural-pseudo segment swapped for `[data-ref="N"]`, so the
   source-position-correct value reapplies on the clone.
5. **OVERRIDES** — split-edge neutralization (see
   `src/styles/overrides.js`); last in source order so it wins source-order
   tiebreaks among `!important` rules.

### OVERRIDES rules

`OVERRIDES_TEXT` (in `src/styles/overrides.js`) holds rules that fix
visual artifacts at break boundaries:

- **`text-indent`** -- suppressed on `[data-split-from]` elements (continuation
  fragments should not re-indent)
- **`::first-letter`** -- suppressed on `[data-split-from]` elements
- **`::before` / `::after`** -- suppressed on continuation fragments to prevent
  duplicate generated content
- **Counters and list markers** -- reset or hidden on continuation fragments
- **`text-align-last: justify`** -- applied on `[data-align-last="justify"]`
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
the layout and composition pipeline without modifying core algorithms. The handler
*classes* live in one ordered catalog, `Fragmenter.handlers` (initialised from
`src/handlers/catalog.js`); each `Fragmenter` resolves that catalog into its own
`HandlerRegistry` of fresh instances, owned by a per-flow `FlowContext` alongside the
flow's `CloneMap`. Layout nodes carry their flow's context (`LayoutNode.context`,
inherited parent → child at construction, and as a fallback at dispatch in the layout
driver), which is how `BlockContainerAlgorithm` reaches `handlers.claim()` and how
`Fragment` composition reaches the clone map without either being threaded through
signatures. Entry points without a flow (`runLayoutGenerator` and `Fragment.build` called
directly on hand-built trees) get a default context built from the catalog.

### Hook points

Handlers interact with the engine at these hook points, listed in lifecycle order:

1. **`resetRules()`** — clear state from a previous CSS rule walk. Called at the
   start of `processRules()`.

2. **`matchRule(rule, context)`** — called once per leaf `CSSStyleRule` during
   the centralized rule walk. `context.wrappers` provides grouping rule
   preambles (e.g., `["@media screen"]`). Handlers accumulate state here.

3. **`appendRules(rules)`** — push CSS rule text strings into `rules[]` to be
   inserted into a shared stylesheet appended to the styles array.

4. **`prepareContent(content)`** — called after rule processing with the full
   source content, before it enters the measurement DOM. Handlers mutate the
   content or set markers (`markPersistent`, `markNativePseudo` from
   `fragmentainers/handlers`) that the measurer and `PseudoElements` read later.

5. **`applyConstraintSpace(constraintSpace)`** — called when the engine sizes
   the measurement container: at setup, before the reflow, and at the start of
   every fragmentainer before its geometry reads. Handlers that keep an
   auxiliary measurer size it here so the write rides the engine's flush.

6. **`beforeMeasurement(contentRoot)`** — called after the active content is
   injected but before the forced reflow. Handlers may materialize or mutate
   measurement DOM here.

7. **`afterMeasurementSetup(contentRoot)`** — called after the measurement
   container is fully set up (content injected, pseudo-elements materialized,
   styles resolved). The live DOM is available for `getComputedStyle()` queries.
   Handlers can probe elements and build internal state (e.g., generated
   stylesheets). Must not modify the measurer's adopted stylesheets.

8. **`getAdoptedSheets()`** — returns `CSSStyleSheet[]` to fold into the
   composite scoped sheet (`document.adoptedStyleSheets`). Called once per
   `Fragmenter` initialization.

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

At layout initialization the registry creates fresh handler instances and calls
`handler.init(options, context)`. `options` contains the `Fragmenter`
constructor options plus the computed `isPageBased` flag; `context` contains
the flow's handler registry, clone map, and `Fragmenter` reference.

See [Layout Handlers](handlers.md) for the full handler interface and how to write
custom handlers.
