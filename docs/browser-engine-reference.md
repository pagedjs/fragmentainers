# Browser Engine Reference

This document maps the fragmentainer engine's data structures, algorithms, and methods to their W3C CSS specification origins and browser engine equivalents in Blink (Chromium), Gecko (Firefox), and WebKit (Safari), with links to reference implementations.

## Table of Contents

1. [BreakToken / BlockBreakToken / InlineBreakToken](#1-break-tokens)
2. [PhysicalFragment](#2-physicalfragment)
3. [ConstraintSpace](#3-constraintspace)
4. [EarlyBreak / BreakScore](#4-earlybreak--breakscore)
5. [LayoutRequest](#5-layoutrequest)
6. [LayoutNode / DOMLayoutNode](#6-layoutnode--domlayoutnode)
7. [InlineItemsData / InlineItem](#7-inlineitemsdata--inlineitem)
8. [PageRule / PageConstraints / PageResolver](#8-pagerule--pageconstraints--pagesizeresolver)
9. [Algorithm Data](#9-algorithm-data)
10. [FragmentedFlow / FragmentationContext](#10-fragmentainerlayout--fragmentedflow)
11. [Architecture Diagram](#architecture-diagram)

---

## 1. Break Tokens

**Source:** `src/fragmentation/tokens.js`

Break tokens are continuation tokens that capture enough state to resume layout in the next fragmentainer when content overflows. They form a sparse tree mirroring the CSS box tree.

### BreakToken (base class)

| Property                    | Type                    | Description                                                                              |
| --------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `type`                      | `"block"` \| `"inline"` | Token type discriminator                                                                 |
| `node`                      | `LayoutNode`            | The node being resumed                                                                   |
| `isBreakBefore`             | `boolean`               | Node didn't fit; pushed whole to next fragmentainer                                      |
| `isForcedBreak`             | `boolean`               | Break caused by `break-before: page`/`column`/`left`/`right`/`recto`/`verso`             |
| `forcedBreakValue`          | `string \| null`        | The CSS break value that triggered the forced break (e.g. `"left"`, `"right"`, `"page"`) |
| `isRepeated`                | `boolean`               | Repeated content (e.g. table `thead`/`tfoot` across pages)                               |
| `isAtBlockEnd`              | `boolean`               | Node finished but a sibling in a parallel flow broke                                     |
| `hasSeenAllChildren`        | `boolean`               | All children laid out (early exit signal)                                                |
| `isCausedByColumnSpanner`   | `boolean`               | Break caused by a column-spanning element                                                |
| `hasUnpositionedListMarker` | `boolean`               | Orphaned list marker needing placement                                                   |

### BlockBreakToken (extends BreakToken)

| Property            | Type                | Description                                                  |
| ------------------- | ------------------- | ------------------------------------------------------------ |
| `consumedBlockSize` | `number`            | **Cumulative** height consumed across ALL previous fragments |
| `sequenceNumber`    | `number`            | Fragment index (0, 1, 2, ...)                                |
| `childBreakTokens`  | `BlockBreakToken[]` | Sparse tree of child tokens                                  |
| `algorithmData`     | `object \| null`    | Algorithm-specific state (see [§9](#9-algorithm-data))       |

**Static factories:**

- `createBreakBefore(node, isForcedBreak, forcedBreakValue?)` — node pushed whole to next fragmentainer
- `createRepeated(node, sequenceNumber)` — paint-only repeated content
- `createForBreakInRepeatedFragment(node, sequenceNumber, consumedBlockSize)` — break inside repeated content

### InlineBreakToken (extends BreakToken)

| Property       | Type      | Description                               |
| -------------- | --------- | ----------------------------------------- |
| `itemIndex`    | `number`  | Index into `InlineItemsData.items`        |
| `textOffset`   | `number`  | Offset into `InlineItemsData.textContent` |
| `flags`        | `number`  | Inline-specific state bits                |
| `isHyphenated` | `boolean` | Break follows soft hyphen (U+00AD)        |

> **Design note:** `InlineBreakToken` is content-addressed (item index + text offset), not geometry-addressed. This means it survives inline-size changes between fragmentainers.

### Blink Equivalent

- **`BreakToken`** — [`break_token.h`](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/layout/break_token.h)
- **`BlockBreakToken`** — [`block_break_token.h`](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/layout/block_break_token.h)
- **`InlineBreakToken`** — [`inline_break_token.h`](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/layout/inline/inline_break_token.h)

### Gecko Equivalent

Gecko does not use explicit break tokens. Instead it uses **continuation frames** — when a frame (the Gecko equivalent of a layout box) is split across fragmentainers, a new frame object is created and linked to the original via a doubly-linked list.

- **`nsIFrame::GetNextContinuation()`** / **`GetPrevContinuation()`** — traverse the full continuation chain, including non-fluid (bidi) continuations
- **`nsIFrame::GetNextInFlow()`** / **`GetPrevInFlow()`** — traverse only fluid continuations (the subset relevant to fragmentation)
- **`nsContainerFrame::CreateContinuingFrame()`** — factory for creating the next continuation
- **`nsReflowStatus`** — the reflow status returned from `Reflow()` indicates `IsIncomplete()` or `IsOverflowIncomplete()`, signaling that a continuation is needed

Source: [`layout/generic/nsIFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsIFrame.h), [`layout/generic/nsContainerFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsContainerFrame.h)

> **Key difference:** Blink's LayoutNG and this engine use an immutable token that captures resumption state. Gecko mutates the frame tree itself — creating a new frame object as the continuation, with consumed block size implicitly tracked by the frame's position in the flow.

### WebKit Equivalent

WebKit also uses a **continuation model** similar to Gecko's, not explicit break tokens. When a render object breaks across fragmentainers, WebKit creates continuation render objects linked via a chain.

- **`RenderBoxModelObject::continuation()`** — returns the next continuation in the chain
- **`RenderBlockFlow::adjustBlockChildForPagination()`** — handles pagination decisions during block child layout, determining where breaks occur
- **`RenderBox::pageLogicalHeightForOffset()`** — queries the fragmentainer height at a given offset

Source: [`Source/WebCore/rendering/RenderBlockFlow.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderBlockFlow.cpp)

> **Key difference:** WebKit's pagination logic is embedded in `RenderBlockFlow::layoutBlock()` rather than separated into a token data structure. Break decisions are made inline during layout and continuations are created on the render tree directly.

### W3C Specification

- [CSS Fragmentation Level 3 §2](https://drafts.csswg.org/css-break/#fragmentation-model) — Fragmentation model: break tokens as the mechanism for continuing layout across fragmentainers
- [CSS Fragmentation Level 3 §3](https://drafts.csswg.org/css-break/#breaking-controls) — Breaking controls (`break-before`, `break-after`, `break-inside`)

### Divergences

| Engine          | Approach                                                               | Cumulative size tracking   |
| --------------- | ---------------------------------------------------------------------- | -------------------------- |
| **This engine** | Immutable `BlockBreakToken` with `consumedBlockSize`                   | Explicit on token          |
| **Blink**       | Immutable `BlockBreakToken` with `consumed_block_size_` (`LayoutUnit`) | Explicit on token          |
| **Gecko**       | Mutable continuation frames linked via `GetNextInFlow()`               | Implicit in frame geometry |
| **WebKit**      | Mutable continuation render objects via `continuation()`               | Implicit in render tree    |

---

## 2. PhysicalFragment

**Source:** `src/fragmentation/fragment.js`

The immutable output of a layout algorithm. Represents one positioned portion of a CSS box within exactly one fragmentainer.

| Property         | Type                      | Description                                                                                 |
| ---------------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| `node`           | `LayoutNode \| null`      | The CSS box that produced this fragment                                                     |
| `blockSize`      | `number`                  | Block-axis size of this fragment                                                            |
| `inlineSize`     | `number`                  | Inline-axis size                                                                            |
| `childFragments` | `PhysicalFragment[]`      | Nested child fragments                                                                      |
| `breakToken`     | `BreakToken \| null`      | Continuation token for next fragmentainer                                                   |
| `constraints`    | `PageConstraints \| null` | Fragmentainer constraint info                                                               |
| `multicolData`   | `object \| null`          | `{ columnWidth, columnGap, columnCount }` for multicol containers                           |
| `lineCount`      | `number`                  | Line count (inline content only)                                                            |
| `isRepeated`     | `boolean`                 | Fragment is repeated content (e.g. table thead across pages)                                |
| `isBlank`        | `boolean`                 | Fragment is a blank page inserted for side-specific breaks (`left`/`right`/`recto`/`verso`) |
| `counterState`   | `object \| null`          | CSS counter state snapshot at end of fragment                                               |

### Blink Equivalent

- **`PhysicalBoxFragment`** — [`physical_box_fragment.h`](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/layout/physical_box_fragment.h)
- Paint consumer: **`BoxFragmentPainter`** — [`box_fragment_painter.h`](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/paint/box_fragment_painter.h)

### Gecko Equivalent

Gecko does not produce an immutable fragment tree. The **`nsIFrame`** itself is both the layout input and output — after `Reflow()`, the frame's rect (`GetRect()`) holds its positioned size. Each continuation frame effectively _is_ the fragment for its fragmentainer.

- **`nsIFrame`** — [`layout/generic/nsIFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsIFrame.h) — base frame class; `GetRect()` returns position + size after reflow
- **`nsBlockFrame`** — [`layout/generic/nsBlockFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsBlockFrame.h) — block-level frame with line list
- **`ReflowOutput`** (formerly `nsHTMLReflowMetrics`) — [`layout/generic/ReflowOutput.h`](https://searchfox.org/mozilla-central/source/layout/generic/ReflowOutput.h) — output struct filled during `Reflow()` with the frame's desired size

> **Key difference:** Blink/this engine separate layout output (immutable fragment) from the layout input (node/box). Gecko merges them — the frame is mutated in place.

### WebKit Equivalent

Like Gecko, WebKit does not have a separate fragment tree. The **`RenderBox`** itself stores layout results directly.

- **`RenderBox`** — [`Source/WebCore/rendering/RenderBox.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderBox.h) — base box class; stores `width()`, `height()`, `x()`, `y()` after layout
- **`RenderBlock`** — [`Source/WebCore/rendering/RenderBlock.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderBlock.h) — block container
- **`RenderBlockFlow`** — [`Source/WebCore/rendering/RenderBlockFlow.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderBlockFlow.cpp) — block-flow layout with pagination support

> **Key difference:** WebKit's modern Layout Formatting Context (LFC) work in `Source/WebCore/layout/` is moving toward a more Blink-like model with separate layout results, but the legacy render tree remains the primary production path.

### W3C Specification

- [CSS Fragmentation Level 3 §2](https://drafts.csswg.org/css-break/#fragmentation-model) — "A box fragment is the portion of a box that belongs to exactly one fragmentainer"

### Divergences

| Engine          | Fragment model                                                   | Mutability |
| --------------- | ---------------------------------------------------------------- | ---------- |
| **This engine** | `PhysicalFragment` tree (separate from input)                    | Immutable  |
| **Blink**       | `PhysicalBoxFragment` tree                                       | Immutable  |
| **Gecko**       | `nsIFrame` continuation chain (frame _is_ the fragment)          | Mutable    |
| **WebKit**      | `RenderBox` continuation chain (render object _is_ the fragment) | Mutable    |

---

## 3. ConstraintSpace

**Source:** `src/fragmentation/constraint-space.js`

Carries fragmentainer dimensions and fragmentation context to layout algorithms. Created fresh for each fragmentainer or child layout.

| Property                     | Type                               | Description                                       |
| ---------------------------- | ---------------------------------- | ------------------------------------------------- |
| `availableInlineSize`        | `number`                           | Width available for content                       |
| `availableBlockSize`         | `number`                           | Height available in current fragmentainer         |
| `fragmentainerBlockSize`     | `number`                           | Total height of the fragmentainer                 |
| `blockOffsetInFragmentainer` | `number`                           | Current vertical position within fragmentainer    |
| `fragmentationType`          | `"none"` \| `"page"` \| `"column"` | Active fragmentation mode                         |
| `isNewFormattingContext`     | `boolean`                          | Whether this establishes a new formatting context |

### Blink Equivalent

- **`ConstraintSpace`** — [`constraint_space.h`](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/layout/constraint_space.h)
- Builder: **`ConstraintSpaceBuilder`** — [`constraint_space_builder.h`](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/layout/constraint_space_builder.h)

### Gecko Equivalent

- **`ReflowInput`** (formerly `nsHTMLReflowState`) — [`layout/generic/ReflowInput.h`](https://searchfox.org/mozilla-central/source/layout/generic/ReflowInput.h) — constructed by the parent frame before calling a child's `Reflow()`. Contains `AvailableISize()`, `AvailableBSize()`, and computed border/padding. The available space is calculated by subtracting the container's border and padding from the parent's available space.
- **`nsReflowStatus`** — signals whether layout is complete, incomplete, or overflow-incomplete (controls continuation creation)

> **Key difference:** Gecko's `ReflowInput` is heavier — it includes resolved margin/padding/border, computed offsets, and constraint resolution. This engine and Blink carry only the fields needed for fragmentation.

### WebKit Equivalent

- **`LayoutState`** — [`Source/WebCore/rendering/LayoutState.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/LayoutState.h) — pushed/popped on a stack during layout; tracks pagination offset, page logical height, and whether layout is paginated
- **`RenderBox::availableLogicalWidth()`** / **`availableLogicalHeight()`** — methods on the render object itself that compute available space contextually
- WebKit's modern LFC introduces **`ConstraintSpace`** in [`Source/WebCore/layout/`](https://github.com/WebKit/WebKit/tree/main/Source/WebCore/layout) that is closer to Blink's model

> **Key difference:** In legacy WebKit, constraint information is distributed across `LayoutState`, parent render objects, and method calls, rather than bundled into a single input struct.

### W3C Specification

- [CSS Fragmentation Level 3 §2](https://drafts.csswg.org/css-break/#fragmentation-model) — Fragmentainer dimensions define the constraint space
- [CSS Fragmentation Level 3 §5](https://drafts.csswg.org/css-break/#varying-size-fragmentainers) — Variable-size fragmentainers (page mode)

### Divergences

| Engine          | Constraint delivery                         | Structure                                           |
| --------------- | ------------------------------------------- | --------------------------------------------------- |
| **This engine** | `ConstraintSpace` object per layout call    | Minimal (6 fields)                                  |
| **Blink**       | `ConstraintSpace` object per layout call    | Large (writing mode, exclusions, BFC offsets, etc.) |
| **Gecko**       | `ReflowInput` constructed by parent         | Heavy (resolved metrics, computed offsets)          |
| **WebKit**      | `LayoutState` stack + render object methods | Distributed across multiple objects                 |

---

## 4. EarlyBreak / BreakScore

**Source:** `src/fragmentation/break-scoring.js`

Implements the two-pass break optimization. Pass 1 discovers the optimal breakpoint (tracking `EarlyBreak` chains); if the actual break is suboptimal, Pass 2 re-runs layout to break at the `EarlyBreak` target.

### BreakScore

| Value | Constant                   | Meaning                                            |
| ----- | -------------------------- | -------------------------------------------------- |
| `0`   | `PERFECT`                  | Ideal breakpoint — no constraints violated         |
| `1`   | `VIOLATING_ORPHANS_WIDOWS` | Breaks orphans/widows requirement                  |
| `2`   | `VIOLATING_BREAK_AVOID`    | Breaks a `break-inside: avoid` or `break-*: avoid` |
| `3`   | `LAST_RESORT`              | No valid breakpoint found; forced break            |

### EarlyBreak

| Property          | Type                     | Description                                  |
| ----------------- | ------------------------ | -------------------------------------------- |
| `node`            | `LayoutNode`             | Which node to break at                       |
| `score`           | `BreakScore`             | Quality of this breakpoint (lower is better) |
| `type`            | `"before"` \| `"inside"` | Break before or inside the node              |
| `childEarlyBreak` | `EarlyBreak \| null`     | Chain to deeper nested breakpoint            |

**Helper functions:**

- `isBetterBreak(a, b)` — returns `true` if `a` has a lower (better) score
- `scoreClassABreak(prevChild, nextChild)` — evaluates break quality between siblings
- `applyBreakInsideAvoid(node, score)` — degrades score if parent has `break-inside: avoid`

### Blink Equivalent

- **`EarlyBreak`** — [`early_break.h`](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/layout/early_break.h)
- **`BreakAppeal`** — [`break_appeal.h`](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/layout/break_appeal.h) — enum with `kBreakAppealPerfect`, `kBreakAppealViolatingBreakAvoid`, etc.

### Gecko Equivalent

Gecko does not use a two-pass EarlyBreak optimization. Break avoidance is handled during a single reflow pass:

- **`nsBlockFrame::Reflow()`** — [`layout/generic/nsBlockFrame.cpp`](https://searchfox.org/mozilla-central/source/layout/generic/nsBlockFrame.cpp) — evaluates `break-before`, `break-after`, `break-inside: avoid` while reflowing children. When `break-inside: avoid` is set, Gecko attempts to push the entire block to the next fragmentainer if it doesn't fit.
- **`BlockReflowState`** — [`layout/generic/BlockReflowState.h`](https://searchfox.org/mozilla-central/source/layout/generic/BlockReflowState.h) — tracks fragmentation state during block reflow, including available block size remaining

> **Key difference:** Gecko's single-pass approach can produce suboptimal break placement when nested `break-inside: avoid` creates conflicts. Blink's two-pass system (and this engine's) re-runs layout to find a provably better breakpoint.

### WebKit Equivalent

WebKit also uses a single-pass approach:

- **`RenderBlockFlow::adjustBlockChildForPagination()`** — [`Source/WebCore/rendering/RenderBlockFlow.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderBlockFlow.cpp) — checks break avoidance properties after laying out each child and pushes content to the next page/column if `break-inside: avoid` is violated
- **`RenderBlockFlow::pageLogicalHeightForOffset()`** — determines the fragmentainer height at a given block offset

> **Key difference:** Like Gecko, WebKit lacks a two-pass optimization. Break scoring is implicit in the pagination adjustment logic rather than an explicit data structure.

### W3C Specification

- [CSS Fragmentation Level 3 §4](https://drafts.csswg.org/css-break/#breaking-rules) — Rules for breaking: Class A (forced), Class B (avoid), Class C (last-resort)
- [CSS Fragmentation Level 3 §4.2](https://drafts.csswg.org/css-break/#break-between) — Breaks between siblings
- [CSS Fragmentation Level 3 §4.4](https://drafts.csswg.org/css-break/#break-within) — Breaks within boxes

### Divergences

| Engine          | Break optimization                | Scoring model                    |
| --------------- | --------------------------------- | -------------------------------- |
| **This engine** | Two-pass with `EarlyBreak` chains | Explicit `BreakScore` enum (0–3) |
| **Blink**       | Two-pass with `EarlyBreak` chains | `BreakAppeal` enum               |
| **Gecko**       | Single-pass, push on conflict     | No explicit scoring              |
| **WebKit**      | Single-pass, push on conflict     | No explicit scoring              |

---

## 5. LayoutRequest

**Source:** `src/layout/layout-request.js`

Yielded from layout algorithm generators to the driver. Represents a request to lay out a child node. The driver fulfills it by recursively dispatching to the appropriate algorithm.

| Property          | Type                 | Description                      |
| ----------------- | -------------------- | -------------------------------- |
| `node`            | `LayoutNode`         | Child node to lay out            |
| `constraintSpace` | `ConstraintSpace`    | Constraint space for the child   |
| `breakToken`      | `BreakToken \| null` | Continuation token (if resuming) |

**Driver functions:**

- `runLayoutGenerator(generatorFn, node, constraintSpace, breakToken, earlyBreakTarget)` — runs a generator, fulfills yielded requests recursively
- `getLayoutAlgorithm(node)` — dispatches to correct layout algorithm by node type
- `createFragments(rootNode, constraintSpaceOrResolver, continuation)` — top-level fragmentainer loop

### Blink Equivalent

- **`LayoutAlgorithm::Layout()`** — [`layout_algorithm.h`](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/layout/layout_algorithm.h) — base algorithm interface. Blink uses virtual method dispatch (`Layout()` on algorithm subclasses) rather than generators.

### Gecko Equivalent

- **`nsIFrame::Reflow(ReflowInput&, ReflowOutput&)`** — [`layout/generic/nsIFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsIFrame.h) — virtual method on every frame. The parent calls `child->Reflow(...)` directly during its own reflow, with the call stack providing implicit recursion.

> **No direct equivalent.** Gecko's dispatch is simply C++ virtual method dispatch on `nsIFrame::Reflow()`. Each frame subclass (`nsBlockFrame`, `nsFlexContainerFrame`, etc.) overrides `Reflow()`.

### WebKit Equivalent

- **`RenderObject::layout()`** — [`Source/WebCore/rendering/RenderObject.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderObject.h) — virtual method; each subclass (`RenderBlock`, `RenderFlexibleBox`, etc.) overrides it.
- **`RenderBlock::layoutBlock(bool relayoutChildren)`** — [`Source/WebCore/rendering/RenderBlock.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderBlock.h) — the primary block layout entry point

> **No direct equivalent.** Like Gecko, WebKit uses virtual method dispatch for layout recursion. The generator-yield pattern is unique to this engine.

### W3C Specification

- [CSS Layout API Level 1](https://www.w3.org/TR/css-layout-api-1/) — Defines a `layoutWorklet` interface with `intrinsicSizes()` and `layout()` methods that return fragments. The generator-yield pattern parallels this design.

### Divergences

| Engine          | Layout dispatch mechanism                                            |
| --------------- | -------------------------------------------------------------------- |
| **This engine** | JavaScript generators (`function*`) yielding `LayoutRequest` objects |
| **Blink**       | C++ virtual method dispatch (`LayoutAlgorithm::Layout()`)            |
| **Gecko**       | C++ virtual method dispatch (`nsIFrame::Reflow()`)                   |
| **WebKit**      | C++ virtual method dispatch (`RenderObject::layout()`)               |

---

## 6. LayoutNode / DOMLayoutNode

**Source:** `src/layout/layout-node.js`

Read-only wrapper around a DOM `Element`, providing the layout-relevant properties that algorithms consume. Properties are lazily computed from `getComputedStyle()` and cached.

### LayoutNode (interface)

| Property                     | Type                       | Description                                                  |
| ---------------------------- | -------------------------- | ------------------------------------------------------------ |
| `element`                    | `Element \| null`          | Backing DOM element (null for anonymous blocks)              |
| `children`                   | `LayoutNode[]`             | Child nodes in block layout                                  |
| `blockSize`                  | `number \| null`           | Intrinsic block size (leaf nodes)                            |
| `isInlineFormattingContext`  | `boolean`                  | Contains inline content                                      |
| `isReplacedElement`          | `boolean`                  | `img`, `video`, `canvas`, `iframe`, `embed`, `object`, `svg` |
| `isScrollable`               | `boolean`                  | `overflow: scroll \| auto`                                   |
| `hasOverflowHidden`          | `boolean`                  | `overflow: hidden`                                           |
| `isTable` / `isTableRow`     | `boolean`                  | Table display types                                          |
| `isFlexContainer`            | `boolean`                  | `display: flex \| inline-flex`                               |
| `isGridContainer`            | `boolean`                  | `display: grid \| inline-grid`                               |
| `isMulticolContainer`        | `boolean`                  | `column-count` or `column-width` set                         |
| `marginBlockStart/End`       | `number`                   | Block-axis margins                                           |
| `paddingBlockStart/End`      | `number`                   | Block-axis padding                                           |
| `borderBlockStart/End`       | `number`                   | Block-axis border widths                                     |
| `breakBefore/After/Inside`   | `string`                   | CSS break properties                                         |
| `boxDecorationBreak`         | `"slice" \| `"clone"`      | Decoration continuity mode                                   |
| `orphans` / `widows`         | `number`                   | Minimum lines before/after break                             |
| `page`                       | `string \| null`           | CSS `page` property value                                    |
| `columnCount/Width/Gap/Fill` | `number \| string \| null` | Multicol properties                                          |
| `flexDirection/Wrap`         | `string`                   | Flex container properties                                    |
| `gridRowStart/End`           | `number \| null`           | Grid item placement                                          |

### AnonymousBlockNode

Wraps consecutive inline content in mixed-content containers per [CSS 2.1 §9.2.1.1](https://www.w3.org/TR/CSS2/visuren.html#anonymous-block-level). All box-model properties are zero; `isInlineFormattingContext` is always `true`.

### Blink Equivalent

- **`LayoutBox`** — [`layout_box.h`](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/layout/layout_box.h)
- **`LayoutObject`** — [`layout_object.h`](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/layout/layout_object.h)
- Monolithic detection: [`layout_box.cc`](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/layout/layout_box.cc)

### Gecko Equivalent

- **`nsIFrame`** — [`layout/generic/nsIFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsIFrame.h) — base class for all layout objects (called "frames" in Gecko). Provides style access via `Style()`, geometry via `GetRect()`, and type checks via `IsBlockFrame()`, `IsFlexContainerFrame()`, etc.
- **`nsBlockFrame`** — [`layout/generic/nsBlockFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsBlockFrame.h) — block container frame
- **`nsInlineFrame`** — [`layout/generic/nsInlineFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsInlineFrame.h) — inline-level frame
- **`nsTextFrame`** — [`layout/generic/nsTextFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsTextFrame.h) — text content frame
- **`nsContainerFrame`** — [`layout/generic/nsContainerFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsContainerFrame.h) — base for frames that contain children

> **Key difference:** Gecko's `nsIFrame` is mutable — it is modified during reflow — and persistent across frames. `DOMLayoutNode` is a read-only snapshot rebuilt each layout pass.

### WebKit Equivalent

- **`RenderObject`** — [`Source/WebCore/rendering/RenderObject.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderObject.h) — base of the render tree
- **`RenderBox`** — [`Source/WebCore/rendering/RenderBox.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderBox.h) — box model base class (width, height, margins, padding, borders)
- **`RenderBlock`** — [`Source/WebCore/rendering/RenderBlock.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderBlock.h) — block-level container
- **`RenderBlockFlow`** — [`Source/WebCore/rendering/RenderBlockFlow.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderBlockFlow.cpp) — block flow layout with pagination
- **`RenderInline`** — [`Source/WebCore/rendering/RenderInline.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderInline.h) — inline-level box
- **`RenderText`** — [`Source/WebCore/rendering/RenderText.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderText.h) — text content

> **Key difference:** Like Gecko's frames, `RenderObject` is mutable and persistent. WebKit's `isReplacedElement()` on `RenderObject` provides similar monolithic detection.

### W3C Specification

- [CSS Display Module Level 3](https://drafts.csswg.org/css-display/) — Box generation, display types, anonymous box creation
- [CSS 2.1 §9.2.1.1](https://www.w3.org/TR/CSS2/visuren.html#anonymous-block-level) — Anonymous block boxes

### Divergences

| Engine          | Layout object                                       | Lifecycle                               |
| --------------- | --------------------------------------------------- | --------------------------------------- |
| **This engine** | `DOMLayoutNode` (lazy `getComputedStyle()` wrapper) | Rebuilt per layout pass; read-only      |
| **Blink**       | `LayoutBox` / `LayoutObject`                        | Persistent; mutated during style recalc |
| **Gecko**       | `nsIFrame` / `nsBlockFrame` / etc.                  | Persistent; mutated during reflow       |
| **WebKit**      | `RenderObject` / `RenderBox` / etc.                 | Persistent; mutated during layout       |

---

## 7. InlineItemsData / InlineItem

**Source:** `src/dom/collect-inlines.js`

Flat representation of inline formatting context content. Built by walking the DOM subtree and collecting text, controls, tags, and atomic inlines into a single array with a concatenated text string.

### InlineItemsData

| Property      | Type           | Description                    |
| ------------- | -------------- | ------------------------------ |
| `items`       | `InlineItem[]` | Ordered array of inline items  |
| `textContent` | `string`       | Concatenated text of all items |

### InlineItem (by type)

| Type Constant      | Properties                            | Description                                           |
| ------------------ | ------------------------------------- | ----------------------------------------------------- |
| `INLINE_TEXT`      | `startOffset`, `endOffset`, `domNode` | Text run from a DOM `Text` node                       |
| `INLINE_CONTROL`   | `startOffset`, `endOffset`, `domNode` | `<br>` element (maps to `"\n"`)                       |
| `INLINE_ATOMIC`    | `startOffset`, `endOffset`, `element` | Atomic inline (`img`, `inline-block`); maps to U+FFFC |
| `INLINE_OPEN_TAG`  | `element`                             | Opening boundary of an inline element                 |
| `INLINE_CLOSE_TAG` | `element`                             | Closing boundary of an inline element                 |

### Blink Equivalent

- **`InlineItemsData`** — [`inline_items_data.h`](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/layout/inline/inline_items_data.h)
- **`InlineItem`** — [`inline_item.h`](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/layout/inline/inline_item.h)

### Gecko Equivalent

Gecko does not pre-flatten inline content into an array. Instead it uses a **frame-per-text-run** model:

- **`nsLineBox`** — [`layout/generic/nsLineBox.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsLineBox.h) — represents one line in a block frame; owns a linked list of child frames for that line
- **`nsTextFrame`** — [`layout/generic/nsTextFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsTextFrame.h) — one frame per text run; stores content offset + length into the DOM text node. Multiple `nsTextFrame` objects can reference the same `nsTextNode`, each covering a substring.
- **`nsLineLayout`** — [`layout/generic/nsLineLayout.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsLineLayout.h) — drives inline reflow for one line, managing the sequence of inline frames

> **Key difference:** Gecko's model is frame-based (one `nsTextFrame` per text run) while Blink and this engine use a flat item array with text offsets into a single string.

### WebKit Equivalent

WebKit has both a legacy and modern inline model:

**Legacy (production):**

- **`RenderText`** — [`Source/WebCore/rendering/RenderText.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderText.h) — text content render object
- **`LegacyInlineFlowBox`** / **`LegacyRootInlineBox`** / **`LegacyInlineTextBox`** — box-per-run model for inline layout (similar to Gecko's line box model)

**Modern (LFC inline formatting context):**

- **`InlineItem`** — `Source/WebCore/layout/inline/InlineItem.h` — flat item representation; types include `Text`, `Box` (atomic), `InlineBoxStart`, `InlineBoxEnd`, `LineBreak`
- **`InlineItemsBuilder`** — `Source/WebCore/layout/inline/InlineItemsBuilder.h` — builds the flat item list
- **`InlineContentBreaker`** — `Source/WebCore/layout/inline/InlineContentBreaker.h` — line breaking over the flat item list
- **`InlineFormattingContext`** — `Source/WebCore/layout/inline/InlineFormattingContext.h` — drives inline layout

> **Key difference:** WebKit's modern LFC `InlineItem` is the closest match to this engine's model. The legacy path uses a box-per-run approach like Gecko.

### W3C Specification

- [CSS Inline Layout Module Level 3](https://drafts.csswg.org/css-inline/) — Inline formatting context model
- [CSS Text Module Level 3](https://drafts.csswg.org/css-text/) — Text processing, white space, line breaking

### Divergences

| Engine              | Inline representation                                  | Text model                                        |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------- |
| **This engine**     | Flat `InlineItem[]` + concatenated `textContent`       | Content-addressed offsets                         |
| **Blink**           | Flat `InlineItem` vector + text string                 | Content-addressed offsets                         |
| **Gecko**           | `nsTextFrame` per text run in `nsLineBox` lists        | Frame references DOM text node with offset/length |
| **WebKit (legacy)** | `LegacyInlineTextBox` per run in `LegacyRootInlineBox` | Box-per-run                                       |
| **WebKit (LFC)**    | Flat `InlineItem` list                                 | Content-addressed (like Blink)                    |

---

## 8. PageRule / PageConstraints / PageResolver

**Source:** `src/resolvers/page-resolver.js`

Implements `@page` rule parsing, matching, cascading, and per-page constraint resolution.

### PageRule

| Property          | Type                         | Description                                                    |
| ----------------- | ---------------------------- | -------------------------------------------------------------- |
| `name`            | `string \| null`             | Named page type (`"chapter"`, `"cover"`) or null for universal |
| `pseudoClass`     | `string \| null`             | `:first`, `:left`, `:right`, `:blank`                          |
| `size`            | `string \| number[] \| null` | `"a4"`, `"letter landscape"`, `[width, height]`                |
| `margin`          | `object \| null`             | `{ top, right, bottom, left }` in CSS px                       |
| `pageOrientation` | `string \| null`             | `"rotate-left"`, `"rotate-right"`                              |

### PageConstraints

| Property      | Type                           | Description                                                         |
| ------------- | ------------------------------ | ------------------------------------------------------------------- |
| `pageIndex`   | `number`                       | Zero-based page number                                              |
| `namedPage`   | `string \| null`               | Named page type for this page                                       |
| `pageBoxSize` | `{ inlineSize, blockSize }`    | Full page dimensions                                                |
| `margins`     | `{ top, right, bottom, left }` | Page margins                                                        |
| `contentArea` | `{ inlineSize, blockSize }`    | The fragmentainer (page box minus margins)                          |
| `isFirstPage` | `boolean`                      | Matches `:first` pseudo-class                                       |
| `isLeftPage`  | `boolean`                      | Matches `:left` pseudo-class                                        |
| `isBlank`     | `boolean`                      | Matches `:blank` pseudo-class (blank page from side-specific break) |

**Methods:**

- `toConstraintSpace()` — converts to a `ConstraintSpace` with `fragmentationType: "page"`

### PageResolver

| Method                                               | Description                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `resolve(pageIndex, rootNode, breakToken, isBlank?)` | Returns `PageConstraints` for a specific page                                   |
| `matchRules(pageIndex, namedPage, isBlank?)`         | Filters applicable `@page` rules (`:blank` matches only when `isBlank` is true) |
| `cascadeRules(matchingRules)`                        | Cascades by specificity                                                         |
| `resolveSize(sizeValue)`                             | Parses size to `{ inlineSize, blockSize }`                                      |
| `resolveMargins(marginDecl, pageSize)`               | Resolves margins to px                                                          |
| `isLeftPage(pageIndex)`                              | Page 0 is right (recto) in LTR                                                  |

### Blink Equivalent

- Blink handles `@page` rules through the style system. The closest equivalent is the page style cascade in [`third_party/blink/renderer/core/css/`](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/css/).

### Gecko Equivalent

- **`nsCSSPageRule`** — [`layout/style/nsCSSRules.h`](https://searchfox.org/mozilla-central/source/layout/style/nsCSSRules.h) — CSSOM representation of a parsed `@page` rule
- **`nsPageSequenceFrame`** — [`layout/generic/nsPageSequenceFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsPageSequenceFrame.h) — top-level frame that creates child `nsPageFrame` objects for each page; manages page count and pagination
- **`nsPageFrame`** — [`layout/generic/nsPageFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsPageFrame.h) — represents one page; applies page margins and size
- **`nsPageContentFrame`** — [`layout/generic/nsPageContentFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsPageContentFrame.h) — the content area within a page (the fragmentainer)

> **Key difference:** Gecko splits page coordination across a frame hierarchy (`nsPageSequenceFrame` → `nsPageFrame` → `nsPageContentFrame`). This engine combines rule matching, cascading, and size resolution into the single `PageResolver` class.

### WebKit Equivalent

- **`StyleRulePage`** — `Source/WebCore/css/StyleRulePage.h` — parsed `@page` rule in the style system
- **`RenderView`** — [`Source/WebCore/rendering/RenderView.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderView.h) — root of the render tree; stores `pageLogicalSize` and manages page numbering via `pageNumberForBlockProgressionOffset()`

> **Key difference:** WebKit's `@page` support has historically been limited (see [WebKit bug 15548](https://bugs.webkit.org/show_bug.cgi?id=15548)). Page size is stored on `RenderView` rather than resolved per-page.

### W3C Specification

- [CSS Paged Media Module Level 3 §4](https://drafts.csswg.org/css-page/#page-selectors) — Page selectors (`:first`, `:left`, `:right`, `:blank`, named pages)
- [CSS Paged Media Module Level 3 §5](https://drafts.csswg.org/css-page/#page-size-prop) — Page size property
- [CSS Paged Media Module Level 3 §6](https://drafts.csswg.org/css-page/#margin-boxes) — Page margin boxes
- [CSS Paged Media Module Level 3 §7](https://drafts.csswg.org/css-page/#page-cascade) — Page rule cascade and specificity
- [CSS Fragmentation Level 3 §5.1](https://drafts.csswg.org/css-break/#varying-size-fragmentainers) — Varying-size fragmentainers

---

## 9. Algorithm Data

**Source:** `src/constants.js` (type constants), stored in `BlockBreakToken.algorithmData`

Algorithm-specific state attached to break tokens for resuming container-specific layout across fragmentainers.

### Multicol Data (`ALGORITHM_MULTICOL`)

| Property      | Type             | Description           |
| ------------- | ---------------- | --------------------- |
| `type`        | `"MulticolData"` | Discriminator         |
| `columnCount` | `number`         | Resolved column count |
| `columnWidth` | `number`         | Resolved column width |
| `columnGap`   | `number`         | Column gap in px      |

**Source:** `src/algorithms/multicol-container.js`

### Flex Data (`ALGORITHM_FLEX`)

| Property        | Type         | Description                        |
| --------------- | ------------ | ---------------------------------- |
| `type`          | `"FlexData"` | Discriminator                      |
| `flexLineIndex` | `number`     | Which flex line was being laid out |

**Source:** `src/algorithms/flex-container.js`

### Grid Data (`ALGORITHM_GRID`)

| Property   | Type         | Description                       |
| ---------- | ------------ | --------------------------------- |
| `type`     | `"GridData"` | Discriminator                     |
| `rowIndex` | `number`     | Which grid row was being laid out |

**Source:** `src/algorithms/grid-container.js`

### Table Row Data (`ALGORITHM_TABLE_ROW`)

| Property | Type             | Description   |
| -------- | ---------------- | ------------- |
| `type`   | `"TableRowData"` | Discriminator |

Token's `childBreakTokens` carries per-cell tokens. All cells get tokens if any cell breaks (parallel flow rule).

**Source:** `src/algorithms/table-row.js`

### Blink Equivalent

- **`BreakTokenAlgorithmData`** — [`break_token_algorithm_data.h`](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/layout/) — tagged union with `kFlexData`, `kGridData`, `kMulticolData`, `kTableRowData`

### Gecko Equivalent

Gecko stores algorithm-specific state on the frame objects and their continuations:

- **`nsColumnSetFrame`** — [`layout/generic/nsColumnSetFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsColumnSetFrame.h) — manages column layout; column dimensions are recomputed per-reflow rather than stored on a token. After supporting `column-span`, `ColumnSetWrapperFrame` is the top-level multicol container and `nsColumnSetFrame` handles individual column sets between spanners.
- **`nsFlexContainerFrame`** — [`layout/generic/nsFlexContainerFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsFlexContainerFrame.h) — flex layout; flex line state is computed per-reflow
- **`nsGridContainerFrame`** — [`layout/generic/nsGridContainerFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsGridContainerFrame.h) — grid layout; uses `SharedGridData` shared between the first-in-flow and its continuations to track row positions and resolved track sizes

> **Key difference:** In Gecko, algorithm state is stored on the frame or in shared data structures between continuations, not on a separate token.

### WebKit Equivalent

- **`RenderMultiColumnFlow`** — [`Source/WebCore/rendering/RenderMultiColumnFlow.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderMultiColumnFlow.h) — the flow thread for multicol; manages column sets via `RenderMultiColumnSet`
- **`RenderMultiColumnSet`** — `Source/WebCore/rendering/RenderMultiColumnSet.h` — represents a column row (group of columns between spanners)
- **`RenderFlexibleBox`** — [`Source/WebCore/rendering/RenderFlexibleBox.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderFlexibleBox.cpp) — flex container layout
- **`RenderGrid`** — `Source/WebCore/rendering/RenderGrid.cpp` — grid container layout

> **Key difference:** WebKit uses a "flow thread" model for multicol (content laid out in one tall strip, then sliced into columns by `RenderMultiColumnSet`). This engine and Blink use a fragmentainer-per-column approach with explicit break tokens.

### W3C Specification

- [CSS Multi-column Layout Level 1 §3](https://www.w3.org/TR/css-multicol-1/#the-number-and-width-of-columns) — Column count and width algorithm
- [CSS Flexible Box Layout Level 1 §10](https://www.w3.org/TR/css-flexbox-1/#pagination) — Fragmenting flex layout
- [CSS Grid Layout Level 1 §12](https://www.w3.org/TR/css-grid-1/#pagination) — Fragmenting grid layout
- [CSS Fragmentation Level 3 §2.1](https://drafts.csswg.org/css-break/#parallel-flows) — Parallel flows (table cells, flex items, grid items in the same row must all carry break tokens)

---

## 10. FragmentedFlow / FragmentationContext

**Source:** `src/fragmentation/fragmented-flow.js`

High-level coordinator that encapsulates the full content-to-fragmentation pipeline.

### FragmentedFlow

| Method                          | Description                                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constructor(content, options)` | Accepts `DocumentFragment`, `Element`, or mock node. Options: `{ styles, resolver, constraintSpace, width, height, type, trackRefs }`                    |
| `next()`                        | Lay out the next fragmentainer, returns `PhysicalFragment`. Automatically inserts blank pages for side-specific breaks (`left`/`right`/`recto`/`verso`). |
| `flow()`                        | Runs fragmentation to completion, returns `FragmentationContext`                                                                                         |
| `setup(forceUpdate?)`           | Initialize layout tree and internal `<content-measure>` (called lazily by `next()`)                                                                      |
| `destroy()`                     | Remove the internal `<content-measure>` element                                                                                                          |
| `reflow(fromIndex?, options?)`  | Reset stepper to re-layout from a specific fragmentainer, returns new `FragmentationContext`                                                             |

Delegates measurement to a `Measurer` instance, which creates `<content-measure>` elements and handles sequential segmentation when forced breaks exist. Builds the layout tree, auto-creates a `PageResolver` from `@page` rules in styles when no resolver is provided, and runs the fragmentainer loop with two-pass `EarlyBreak` support. When a forced break has a side-specific value (`left`/`right`/`recto`/`verso`), `next()` inserts blank pages to land content on the correct page side.

### Measurer

**Source:** `src/dom/measure.js`

Owns the `<content-measure>` element lifecycle. On setup, resolves `break-before`, `break-after`, and `page` CSS properties from stylesheet rules for each top-level child element. When forced breaks split content into multiple segments, each segment gets its own `<content-measure>` — the browser only computes layout for one segment at a time. Previous segments' measurers are destroyed as the engine advances. For documents without forced breaks, a single `<content-measure>` is used (identical to previous behavior).

| Method                      | Returns                    | Description                                                             |
| --------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| `setup()`                   | `Promise<Element>`         | Create measurement container(s), returns content root for tree building |
| `advance(breakToken, tree)` | `Promise<void>`            | Swap to next segment if at a boundary (no-op for single-segment)        |
| `release()`                 | `{ content, refMap, ... }` | Destroy measurer, return all content as a DocumentFragment in order     |
| `applyConstraintSpace(cs)`  | `void`                     | Sync the measurement container's inline size                            |
| `getContentStyles()`        | `object`                   | Adopted stylesheets and nth-selector descriptors for rendering          |

### ContentParser

**Source:** `src/dom/content-parser.js`

Parses an HTML document string into a `DocumentFragment` + `CSSStyleSheet[]` with resolved URLs. Handles CSS preprocessing for properties not natively supported by browsers (e.g. rewrites `position: running(...)` to a custom property).

| Property / Method                            | Type                     | Description                                                             |
| -------------------------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| `ContentParser.fromString(content, baseURL)` | `Promise<ContentParser>` | Static factory — parses HTML, fetches linked stylesheets, resolves URLs |
| `fragment`                                   | `DocumentFragment`       | Body content with resolved URLs                                         |
| `styles`                                     | `CSSStyleSheet[]`        | Source sheets + URL override sheet                                      |

### FragmentationContext

`FragmentationContext` extends `Array` — iterate directly to access composed `<fragment-container>` elements.

| Property / Method              | Type                   | Description                                                                                                                   |
| ------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `fragments`                    | `PhysicalFragment[]`   | All fragmentainer fragments                                                                                                   |
| `fragmentainerCount`           | `number`               | Number of fragmentainers                                                                                                      |
| `createFragmentainer(index)`   | `Element`              | Composes one `<fragment-container>`. Blank pages get `data-blank-page` attribute. Sets `namedPage` property from constraints. |
| `reflow(fromIndex?, options?)` | `FragmentationContext` | Re-layout from a specific fragmentainer, returns a new `FragmentationContext`                                                 |

### Blink Equivalent

- The fragmentainer loop is embedded in Blink's [`BlockLayoutAlgorithm::Layout()`](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/layout/block_layout_algorithm.cc) and its callers. There is no single "FragmentedFlow" coordinator class — the fragmentation loop is woven into the LayoutNG pipeline.

### Gecko Equivalent

- **`nsPageSequenceFrame`** — [`layout/generic/nsPageSequenceFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsPageSequenceFrame.h) — the top-level coordinator for paginated layout. Creates `nsPageFrame` children, drives reflow across pages, and tracks page count.
- **`nsColumnSetFrame`** — [`layout/generic/nsColumnSetFrame.h`](https://searchfox.org/mozilla-central/source/layout/generic/nsColumnSetFrame.h) — coordinator for column fragmentation; creates column frames and drives content across them

> **Mapping:** `FragmentedFlow` ≈ `nsPageSequenceFrame` (page mode) or `nsColumnSetFrame` (column mode). `FragmentationContext` ≈ the resulting chain of `nsPageFrame` / column frames.

### WebKit Equivalent

- **`RenderFragmentationContext`** — `Source/WebCore/rendering/RenderFragmentationContext.h` — base class for fragmented flows; manages a list of `RenderFragmentContainer` objects that represent individual fragmentainers
- **`RenderMultiColumnFlow`** — [`Source/WebCore/rendering/RenderMultiColumnFlow.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderMultiColumnFlow.h) — multicol specialization; content is laid out in a single tall strip (the "flow thread"), then distributed into column sets
- **`RenderFragmentContainer`** — `Source/WebCore/rendering/RenderFragmentContainer.h` — represents one fragmentainer (one column, one page region)
- **`RenderView`** — [`Source/WebCore/rendering/RenderView.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderView.h) — for page mode, the root render view manages pagination state

> **Mapping:** `FragmentedFlow` ≈ `RenderFragmentationContext` (the coordinator). `FragmentationContext` ≈ the set of `RenderFragmentContainer` objects.

### W3C Specification

- [CSS Fragmentation Level 3 §2](https://drafts.csswg.org/css-break/#fragmentation-model) — "A fragmented flow consists of the content of all boxes that share the fragmentation context"
- [CSS Fragmentation Level 3 §2](https://drafts.csswg.org/css-break/#fragmentation-context) — Fragmentation context definition

---

## Architecture Diagram

```
                        ┌──────────────────────┐
                        │  FragmentedFlow  │
                        │  (coordinator)        │
                        └──────────┬───────────┘
                                   │ builds
                                   ▼
                        ┌──────────────────────┐
                        │    LayoutNode tree    │◄──── DOMLayoutNode wraps
                        │   (DOMLayoutNode,     │      DOM Elements via
                        │    AnonymousBlockNode)│      getComputedStyle()
                        └──────────┬───────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
              ▼                    ▼                     ▼
    ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
    │ ConstraintSpace │  │  PageResolver│  │ InlineItemsData │
    │ (per fragment-  │  │  (resolves @page │  │ (flat inline    │
    │  ainer dims)    │  │   rules per page)│  │  content repr)  │
    └────────┬────────┘  └─────────────────┘  └─────────────────┘
             │
             ▼
    ┌─────────────────────────────────────────────────┐
    │              Layout Algorithms                   │
    │  (generators yielding LayoutRequest objects)     │
    │                                                  │
    │  layoutBlockContainer ← default dispatch         │
    │  layoutInlineContent  ← inline formatting ctx    │
    │  layoutMulticolContainer ← column-count/width    │
    │  layoutFlexContainer  ← display: flex            │
    │  layoutGridContainer  ← display: grid            │
    │  layoutTableRow       ← display: table-row       │
    └────────┬──────────────────────┬──────────────────┘
             │                      │
             ▼                      ▼
    ┌─────────────────┐   ┌──────────────────┐
    │ PhysicalFragment │   │   BreakToken     │
    │ (layout output,  │   │   (continuation  │
    │  one box per     │   │    token tree)   │
    │  fragmentainer)  │   │                  │
    └────────┬─────────┘   │  BlockBreakToken │
             │             │  InlineBreakToken│
             │             │  + algorithmData │
             │             └──────────────────┘
             │
             ▼
    ┌──────────────────┐         ┌──────────────────┐
    │  FragmentationContext  │────────►│   Compositor      │
    │  (all fragments) │         │  (compositor.js   │
    └──────────────────┘         │   → DOM clones)   │
                                 └──────────────────┘

    Two-Pass Optimization:
    ┌─────────────┐    Pass 1: discover    ┌───────────┐
    │ BreakScore  │◄──────────────────────►│ EarlyBreak│
    │ PERFECT = 0 │    optimal breakpoint  │ (chain to │
    │ ORPHANS = 1 │                        │  best bp) │
    │ AVOID   = 2 │    Pass 2: re-layout   └───────────┘
    │ LAST    = 3 │    if break was worse
    └─────────────┘
```

### Cross-Engine Architecture Summary

| Concept             | This Engine              | Blink                      | Gecko                    | WebKit                                     |
| ------------------- | ------------------------ | -------------------------- | ------------------------ | ------------------------------------------ |
| Layout input object | `LayoutNode`             | `LayoutBox`                | `nsIFrame`               | `RenderObject`                             |
| Constraint delivery | `ConstraintSpace`        | `ConstraintSpace`          | `ReflowInput`            | `LayoutState` + methods                    |
| Layout dispatch     | Generator yield          | Virtual `Layout()`         | Virtual `Reflow()`       | Virtual `layout()`                         |
| Layout output       | `PhysicalFragment`       | `PhysicalBoxFragment`      | Mutated frame            | Mutated render object                      |
| Continuation        | `BreakToken` tree        | `BreakToken` tree          | Continuation frame chain | Continuation render object chain           |
| Break scoring       | `EarlyBreak` (two-pass)  | `EarlyBreak` (two-pass)    | Single-pass push         | Single-pass push                           |
| Inline items        | Flat `InlineItem[]`      | Flat `InlineItem` vector   | `nsTextFrame` per run    | `InlineItem` (LFC) / `LegacyInlineTextBox` |
| Multicol            | Fragmentainer-per-column | Fragmentainer-per-column   | `nsColumnSetFrame`       | Flow thread + `RenderMultiColumnSet`       |
| Page coordination   | `FragmentedFlow`         | Embedded in algorithm loop | `nsPageSequenceFrame`    | `RenderView` pagination                    |
| Output rendering    | DOM clones per fragment  | `BoxFragmentPainter` → display list | Static document clone (`CreateStaticClone`) | Display list from render tree |
