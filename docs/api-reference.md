# API Reference

Complete API reference for `fragmentainers`.

---

## Table of Contents

1. [Primary API](#1-primary-api)
2. [Lower-Level Layout API](#2-lower-level-layout-api)
3. [Break Tokens](#3-break-tokens)
4. [Break Scoring](#4-break-scoring)
5. [Fragmentation (Fragment)](#5-composition-fragment)
6. [Custom Elements](#6-custom-elements)
7. [Helpers](#7-helpers)
8. [Constants](#8-constants)
9. [Layout Algorithms](#9-layout-algorithms)
10. [Layout Modules](#10-layout-modules)

---

## 1. Primary API

### FragmentedFlow

`import { FragmentedFlow } from "fragmentainers"`

High-level coordinator for the content-to-fragmentation pipeline. Accepts a
`DocumentFragment`, `Element`, or mock node. Internally creates a
`<content-measure>` element for DOM measurement, builds the layout tree,
runs fragmentation, and returns a `FragmentationContext`.

```js
// DocumentFragment input with stylesheets — iterate directly
const template = document.createElement("template");
template.innerHTML = htmlContent;
const flow = new FragmentedFlow(template.content, { styles: [sheet] });
for (const el of flow) {
	document.body.appendChild(el);
}

// Element input (cloned internally) — use flow() for partial ranges
const layout = new FragmentedFlow(document.getElementById("content"), {
	width: 600,
	height: 800,
});
const context = layout.flow({ start: 0, stop: 5 });

// Region mode — iterator fills regions
const resolver = new RegionResolver([...regionEls]);
const flow = new FragmentedFlow(content, { resolver });
let i = 0;
for (const el of flow) {
	if (i >= regionEls.length) break;
	regionEls[i++].appendChild(el);
}
flow.destroy();
```

#### Constructor

```js
new FragmentedFlow(content, options?)
```

| Parameter                     | Type                                        | Description                                                                                                                               |
| ----------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `content`                     | `DocumentFragment \| Element \| LayoutNode` | Content to fragment. Elements are cloned into a DocumentFragment internally. Mock nodes (plain objects) are used directly for unit tests. |
| `options.styles`              | `CSSStyleSheet[]`                           | Stylesheets applied via `adoptedStyleSheets`.                                                                                             |
| `options.constraintSpace`     | `ConstraintSpace`                           | Direct constraint space (bypasses `@page` rules)                                                                                          |
| `options.resolver`            | `PageResolver \| RegionResolver`            | Pre-configured resolver                                                                                                                   |
| `options.width`               | `number`                                    | Container width in CSS px (column fragmentation)                                                                                          |
| `options.height`              | `number`                                    | Container height in CSS px (column fragmentation)                                                                                         |
| `options.type`                | `string`                                    | Fragmentation type when using `width`/`height` (default: `FRAGMENTATION_COLUMN`)                                                          |
| `options.normalizeLineHeight` | `boolean`                                   | Set explicit `line-height` on elements with `line-height: normal` for consistent rendering across DPRs (default: `false`)                 |

Options are checked in priority order: `constraintSpace` > `resolver` > `width`/`height` > auto-create `PageResolver` from `@page` rules in styles.

#### Methods

| Method                         | Returns                | Description                                                                                                                                                                                                 |
| ------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `next()`                       | `{ value, done }`      | Iterator protocol — lay out the next fragmentainer, return its `<fragment-container>` element. Returns `{ done: true }` when all content is placed.                                                         |
| `flow({ start, stop }?)`       | `FragmentationContext` | Run all fragmentainers to completion. `start`/`stop` control which elements are created (layout always runs to completion).                                                                                 |
| `layout(forceUpdate?)`         | `void`                 | Initialize the layout tree and internal measurement container. Called lazily by `next()`. Pass `true` to force re-initialization.                                                                           |
| `preload()`                    | `Promise<void>`        | Optional — preload fonts and images before layout for accurate measurement.                                                                                                                                 |
| `reflow(fromIndex?, options?)` | `FragmentationContext` | Re-layout from a specific fragmentainer index. Returns a new `FragmentationContext` with the reflowed fragments. Pass `{ rebuild: true }` after structural DOM changes to force layout tree reconstruction. |
| `destroy()`                    | `void`                 | Remove the internal `<content-measure>` element from the DOM. Call when the layout is no longer needed.                                                                                                     |

---

### FragmentationContext

`import { FragmentationContext } from "fragmentainers"`

**Source:** `src/core/fragmentation-context.js`

Result of running fragmentation -- a "fragmented flow" in CSS spec terms.
Extends `Array`, so flow instances are directly iterable: `flow[0]` gives the
first element, `flow.length` gives the count, and `for...of` iterates all
elements. Elements are created eagerly during `flow()`.

#### Constructor

```js
new FragmentationContext(fragments, contentStyles);
```

| Parameter       | Type                                                                         | Description                                    |
| --------------- | ---------------------------------------------------------------------------- | ---------------------------------------------- |
| `fragments`     | `PhysicalFragment[]`                                                         | Array of root fragments, one per fragmentainer |
| `contentStyles` | `{ sheets: CSSStyleSheet[], nthFormulas: Map, sourceRefs: WeakMap } \| null` | Content styles and ref maps for composition    |

#### Properties

| Property             | Type                 | Description              |
| -------------------- | -------------------- | ------------------------ |
| `fragments`          | `PhysicalFragment[]` | The fragment array       |
| `fragmentainerCount` | `number`             | Number of fragmentainers |

#### Methods

| Method                       | Returns   | Description                                                                                                                                                 |
| ---------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createFragmentainer(index)` | `Element` | Create a single fragmentainer as a `<fragment-container>` element. Blank pages get `data-blank-page` attribute. Sets `namedPage` property from constraints. |

---

### PageResolver

`import { PageResolver } from "fragmentainers/src/atpage/page-resolver.js"`

Resolves page dimensions per-page by implementing `@page` rule matching and
cascade. Implements CSS specificity ordering: universal (0) < pseudo-class (1)
< named (2) < named+pseudo (3).

#### Constructor

```js
new PageResolver(pageRules, size);
```

| Parameter   | Type                                        | Description                            |
| ----------- | ------------------------------------------- | -------------------------------------- |
| `pageRules` | `PageRule[]`                                | Parsed `@page` rules in document order |
| `size`      | `{ inlineSize: number, blockSize: number }` | Fallback page size                     |

#### Static Methods

| Method                                        | Returns        | Description                                      |
| --------------------------------------------- | -------------- | ------------------------------------------------ |
| `PageResolver.fromDocument(size?)`            | `PageResolver` | Create a resolver from `document.styleSheets`    |
| `PageResolver.fromStyleSheets(sheets, size?)` | `PageResolver` | Create a resolver from a `CSSStyleSheet[]` array |

#### Methods

| Method                                               | Returns                        | Description                                                                                                              |
| ---------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `resolve(pageIndex, rootNode, breakToken, isBlank?)` | `PageConstraints`              | Resolve constraints for a specific page. Pass `isBlank = true` for blank pages to enable `:blank` pseudo-class matching. |
| `matchRules(pageIndex, namedPage, isBlank?)`         | `PageRule[]`                   | Return rules applicable to this page context. `:blank` rules match only when `isBlank` is true.                          |
| `cascadeRules(matchingRules)`                        | `object`                       | Cascade matched rules by specificity                                                                                     |
| `resolveSize(sizeValue)`                             | `{ inlineSize, blockSize }`    | Resolve CSS size property to physical dimensions                                                                         |
| `applyOrientation(size, orientation)`                | `{ inlineSize, blockSize }`    | Swap dimensions for `rotate-left` / `rotate-right`                                                                       |
| `resolveMargins(marginDecl, pageSize)`               | `{ top, right, bottom, left }` | Resolve margin declarations to pixel values                                                                              |
| `isLeftPage(pageIndex)`                              | `boolean`                      | LTR page progression: page 0 is right (recto), page 1 is left (verso)                                                    |

---

### PageRule

`import { PageRule } from "fragmentainers/src/atpage/page-resolver.js"`

Parsed representation of a CSS `@page` rule.

#### Constructor

```js
new PageRule({ name, pseudoClass, size, margin, pageOrientation });
```

| Property          | Type                                   | Description                                                       |
| ----------------- | -------------------------------------- | ----------------------------------------------------------------- |
| `name`            | `string \| null`                       | Named page type (`"chapter"`, `"cover"`), or `null` for universal |
| `pseudoClass`     | `string \| null`                       | `"first"`, `"left"`, `"right"`, `"blank"`, or `null`              |
| `size`            | `string \| number[] \| null`           | `"a4"`, `"letter landscape"`, `[width, height]`, or `null`        |
| `margin`          | `{ top, right, bottom, left } \| null` | Margins in CSS px                                                 |
| `pageOrientation` | `string \| null`                       | `"rotate-left"`, `"rotate-right"`, or `null`                      |

---

### PageConstraints

`import { PageConstraints } from "fragmentainers/src/atpage/page-resolver.js"`

Resolved page dimensions for one page -- the fragmentainer definition.

#### Constructor

```js
new PageConstraints({ pageIndex, namedPage, pageBoxSize, margins, contentArea, isFirstPage, isLeftPage, isBlank? })
```

| Property      | Type                                        | Description                                                                        |
| ------------- | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `pageIndex`   | `number`                                    | Zero-based page number                                                             |
| `namedPage`   | `string \| null`                            | CSS `page` property value                                                          |
| `pageBoxSize` | `{ inlineSize: number, blockSize: number }` | Full page dimensions                                                               |
| `margins`     | `{ top, right, bottom, left }`              | Resolved margins in CSS px                                                         |
| `contentArea` | `{ inlineSize: number, blockSize: number }` | The fragmentainer (page box minus margins)                                         |
| `isFirstPage` | `boolean`                                   | Whether this is the first page                                                     |
| `isLeftPage`  | `boolean`                                   | Whether this is a left (verso) page                                                |
| `isBlank`     | `boolean`                                   | Whether this is a blank page inserted for a side-specific break (default: `false`) |

#### Methods

| Method                | Returns           | Description                                                      |
| --------------------- | ----------------- | ---------------------------------------------------------------- |
| `toConstraintSpace()` | `ConstraintSpace` | Build a `ConstraintSpace` for layout from these page constraints |

---

### parsePageRulesFromCSS(cssTexts)

`import { parsePageRulesFromCSS } from "fragmentainers/src/atpage/page-resolver.js"`

Parse `@page` rules from CSS text strings using the browser's CSSOM.
Recursively descends into grouping rules (`@layer`, `@supports`, `@media`).

```js
const rules = parsePageRulesFromCSS(["@page { size: A4; margin: 2cm; }"]);
```

| Parameter  | Type               | Description                 |
| ---------- | ------------------ | --------------------------- |
| `cssTexts` | `Iterable<string>` | CSS source strings to parse |

**Returns:** `PageRule[]`

---

### RegionResolver

`import { RegionResolver } from "fragmentainers"`

Resolver that reads fragmentainer dimensions from a chain of DOM region
elements. Each region becomes a fragmentainer sized to the element's client rect.

#### Constructor

```js
new RegionResolver(regionElements);
```

| Parameter        | Type        | Description                          |
| ---------------- | ----------- | ------------------------------------ |
| `regionElements` | `Element[]` | Ordered array of region DOM elements |

#### Methods

| Method                 | Returns             | Description                              |
| ---------------------- | ------------------- | ---------------------------------------- |
| `resolve(regionIndex)` | `RegionConstraints` | Resolve dimensions for a specific region |

---

### RegionConstraints

`import { RegionConstraints } from "fragmentainers"`

Resolved dimensions for one region element.

| Property      | Type                                        | Description                                    |
| ------------- | ------------------------------------------- | ---------------------------------------------- |
| `regionIndex` | `number`                                    | Zero-based region index                        |
| `element`     | `Element`                                   | The target region DOM element                  |
| `contentArea` | `{ inlineSize: number, blockSize: number }` | Region dimensions from `getBoundingClientRect` |

#### Methods

| Method                | Returns           | Description                                           |
| --------------------- | ----------------- | ----------------------------------------------------- |
| `toConstraintSpace()` | `ConstraintSpace` | Build a `ConstraintSpace` with `FRAGMENTATION_REGION` |

---

### parseCSSLength(str)

`import { parseCSSLength } from "fragmentainers/src/atpage/page-resolver.js"`

Parse a CSS length string to CSS pixels (96 DPI). Supports `px`, `in`, `cm`,
`mm`, `pt`.

| Parameter | Type     | Description                                          |
| --------- | -------- | ---------------------------------------------------- |
| `str`     | `string` | CSS length value (e.g. `"2cm"`, `"72pt"`, `"100px"`) |

**Returns:** `number | null`

---

## 2. Lower-Level Layout API

### createFragments(rootNode, constraintSpaceOrResolver, continuation?)

`import { createFragments } from "fragmentainers"`

Top-level fragmentainer driver loop. Creates fragmentainers, runs layout
generators, and collects fragments until no break token remains. Supports
two-pass layout with early-break re-runs.

```js
// Simple: single constraint space, returns flat array
const fragments = createFragments(tree, constraintSpace);

// With resolver: per-fragmentainer resolution
const fragments = createFragments(tree, pageSizeResolver);

// With continuation: returns { fragments, continuation }
const result = createFragments(tree, resolver, {
	fragmentainerIndex: 0,
	blockOffset: 0,
});
```

| Parameter                   | Type                                                          | Description                                  |
| --------------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| `rootNode`                  | `LayoutNode`                                                  | Root layout node (from `buildLayoutTree`)    |
| `constraintSpaceOrResolver` | `ConstraintSpace \| PageResolver`                             | Reused constraint space or per-page resolver |
| `continuation`              | `{ fragmentainerIndex: number, blockOffset: number } \| null` | Resume state for multi-element flows         |

**Returns:** `PhysicalFragment[]` (no continuation) or `{ fragments: PhysicalFragment[], continuation }` (with continuation).

---

### runLayoutGenerator(generatorFn, node, constraintSpace, breakToken, earlyBreakTarget?)

`import { runLayoutGenerator } from "fragmentainers"`

Recursive driver that runs a layout generator to completion, fulfilling each
yielded `LayoutRequest` by dispatching to the correct child algorithm via
`getLayoutAlgorithm`.

| Parameter          | Type                 | Description                                    |
| ------------------ | -------------------- | ---------------------------------------------- |
| `generatorFn`      | `GeneratorFunction`  | Layout algorithm generator                     |
| `node`             | `LayoutNode`         | Layout node                                    |
| `constraintSpace`  | `ConstraintSpace`    | Layout input                                   |
| `breakToken`       | `BreakToken \| null` | Continuation token from previous fragmentainer |
| `earlyBreakTarget` | `EarlyBreak \| null` | Pass 2 target (default: `null`)                |

**Returns:** `{ fragment: PhysicalFragment, breakToken: BreakToken | null, earlyBreak?: EarlyBreak }`

---

### getLayoutAlgorithm(node)

`import { getLayoutAlgorithm } from "fragmentainers"`

Dispatch to the correct layout algorithm based on node type. Checked in order:
`isMulticolContainer` -> `isFlexContainer` -> `isGridContainer` ->
`isInlineFormattingContext` -> `isTableRow` -> `layoutBlockContainer` (default).

| Parameter | Type         | Description            |
| --------- | ------------ | ---------------------- |
| `node`    | `LayoutNode` | Layout node to inspect |

**Returns:** Generator function suitable for `runLayoutGenerator`.

---

### buildLayoutTree(rootElement)

`import { buildLayoutTree } from "fragmentainers"`

Build a layout tree from a DOM element. Returns a `DOMLayoutNode` wrapping the
root. Properties are resolved lazily during layout traversal.

```js
const tree = buildLayoutTree(document.querySelector(".content"));
```

| Parameter     | Type      | Description         |
| ------------- | --------- | ------------------- |
| `rootElement` | `Element` | DOM element to wrap |

**Returns:** `DOMLayoutNode`

---

### DOMLayoutNode

`import { DOMLayoutNode } from "fragmentainers"`

Lazy wrapper around real DOM elements implementing the `LayoutNode` interface.
Read-only -- no DOM mutation. Block sizes measured via `getBoundingClientRect`.
Computed styles cached on first access, children wrapped lazily.

See [browser-engine-reference.md](browser-engine-reference.md) for the full
`LayoutNode` interface definition.

---

### ConstraintSpace

`import { ConstraintSpace } from "fragmentainers"`

Layout input per fragmentainer. Defines the available space and fragmentation
context for a single layout pass.

#### Constructor

```js
new ConstraintSpace({
	availableInlineSize,
	availableBlockSize,
	fragmentainerBlockSize,
	blockOffsetInFragmentainer,
	fragmentationType,
	isNewFormattingContext,
});
```

| Property                     | Type      | Default  | Description                                                               |
| ---------------------------- | --------- | -------- | ------------------------------------------------------------------------- |
| `availableInlineSize`        | `number`  | `0`      | Available width for content                                               |
| `availableBlockSize`         | `number`  | `0`      | Available height in this fragmentainer                                    |
| `fragmentainerBlockSize`     | `number`  | `0`      | Full fragmentainer height (before offset)                                 |
| `blockOffsetInFragmentainer` | `number`  | `0`      | Current block offset within fragmentainer                                 |
| `fragmentationType`          | `string`  | `"none"` | Use `FRAGMENTATION_NONE`, `FRAGMENTATION_PAGE`, or `FRAGMENTATION_COLUMN` |
| `isNewFormattingContext`     | `boolean` | `false`  | Whether this establishes a new formatting context                         |
| `bodyMarginBlockStart`       | `number`  | `0`      | Body/slot margin for first-page margin collapsing with the first child    |

---

### MarginState

`import { MarginState } from "fragmentainers/src/core/margin-collapsing.js"`

Stateful tracker for CSS2 §8.3.1 block margin collapsing. Used by
`layoutBlockContainer` to resolve collapsed margins between siblings, through
parent boundaries, and at fragmentation breaks.

```js
const margins = new MarginState(bodyMarginBlockStart);
```

| Method                                                       | Returns                             | Description                                                              |
| ------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------ |
| `computeMarginBefore(child, params)`                         | `{ marginDelta, collapsedThrough }` | Resolve collapsed margin before a child                                  |
| `collapseAdjustment(collapsedThrough, isResumingChild)`      | `number`                            | Through-collapse adjustment for constraint space                         |
| `applyAfterLayout(child, collapsedThrough, isResumingChild)` | `number`                            | Update state after child layout, return subtraction for through-collapse |
| `trailingMargin(hasBreak, hasChildren)`                      | `number`                            | Deferred last-child margin-end after the loop                            |

Uses `MarginStrut` internally: positive margins take `max`, negative margins take `min`, mixed margins sum `max(positives) + min(negatives)`.

---

### PhysicalFragment

`import { PhysicalFragment } from "fragmentainers"`

Immutable layout output. Represents a laid-out box or line within a single
fragmentainer. Forms a tree via `childFragments`.

#### Constructor

```js
new PhysicalFragment(node, blockSize, childFragments?)
```

| Property         | Type                      | Default | Description                                                                  |
| ---------------- | ------------------------- | ------- | ---------------------------------------------------------------------------- |
| `node`           | `LayoutNode \| null`      | --      | Source layout node (`null` for line fragments)                               |
| `blockSize`      | `number`                  | --      | Block-axis size consumed in this fragmentainer                               |
| `inlineSize`     | `number`                  | `0`     | Inline-axis size                                                             |
| `childFragments` | `PhysicalFragment[]`      | `[]`    | Child fragments within this fragment                                         |
| `breakToken`     | `BreakToken \| null`      | `null`  | Continuation token if content overflowed                                     |
| `constraints`    | `PageConstraints \| null` | `null`  | Page constraints (set by driver on root fragments)                           |
| `multicolData`   | `object \| null`          | `null`  | Multicol layout data (`{ columnWidth, columnGap, columnCount }`)             |
| `lineCount`      | `number`                  | `0`     | Number of lines (for inline formatting contexts)                             |
| `isRepeated`     | `boolean`                 | `false` | Repeated content (e.g. table thead across pages)                             |
| `isBlank`        | `boolean`                 | `false` | Blank page inserted for side-specific break (`left`/`right`/`recto`/`verso`) |
| `counterState`   | `object \| null`          | `null`  | Counter snapshot for this fragmentainer                                      |

---

### LayoutRequest / layoutChild

`import { LayoutRequest, layoutChild } from "fragmentainers"`

Yielded from layout generators to the driver. Represents a request to lay out a
child node.

```js
// Inside a layout generator:
const result = yield layoutChild(childNode, childConstraintSpace, childBreakToken);
```

#### LayoutRequest Constructor

```js
new LayoutRequest(node, constraintSpace, breakToken?)
```

| Property          | Type                 | Description                          |
| ----------------- | -------------------- | ------------------------------------ |
| `node`            | `LayoutNode`         | Child node to lay out                |
| `constraintSpace` | `ConstraintSpace`    | Layout input for the child           |
| `breakToken`      | `BreakToken \| null` | Continuation token (default: `null`) |

#### layoutChild(node, constraintSpace, breakToken?)

Convenience factory that returns a `LayoutRequest`. Identical to calling
`new LayoutRequest(...)`.

---

## 3. Break Tokens

Break tokens are continuation tokens that form a sparse tree mirroring the CSS
box tree. When content overflows a fragmentainer, a break token captures enough
state to resume layout in the next fragmentainer.

See [browser-engine-reference.md](browser-engine-reference.md) for W3C
mappings and architectural details.

### BreakToken (base class)

`import { BreakToken } from "fragmentainers"`

```js
new BreakToken(type, node);
```

| Property                    | Type             | Default | Description                                                                              |
| --------------------------- | ---------------- | ------- | ---------------------------------------------------------------------------------------- |
| `type`                      | `string`         | --      | `BREAK_TOKEN_BLOCK` or `BREAK_TOKEN_INLINE`                                              |
| `node`                      | `LayoutNode`     | --      | The node this token belongs to                                                           |
| `isBreakBefore`             | `boolean`        | `false` | Break occurs before this node (not inside)                                               |
| `isForcedBreak`             | `boolean`        | `false` | Caused by `break-before: page`/`left`/`right`/`recto`/`verso` etc.                       |
| `forcedBreakValue`          | `string \| null` | `null`  | The CSS break value that triggered the forced break (e.g. `"left"`, `"right"`, `"page"`) |
| `isRepeated`                | `boolean`        | `false` | This is a repeated fragment (e.g. table header)                                          |
| `isAtBlockEnd`              | `boolean`        | `false` | Sibling has completed layout (parallel flows)                                            |
| `hasSeenAllChildren`        | `boolean`        | `false` | All children visited at least once                                                       |
| `isCausedByColumnSpanner`   | `boolean`        | `false` | Break caused by a column spanner                                                         |
| `hasUnpositionedListMarker` | `boolean`        | `false` | List marker not yet placed                                                               |

---

### BlockBreakToken

`import { BlockBreakToken } from "fragmentainers"`

Extends `BreakToken` with `type = BREAK_TOKEN_BLOCK`. Used for block-level
containers, flex items, grid items, table rows, and multicol containers.

```js
new BlockBreakToken(node);
```

| Property            | Type             | Default | Description                                            |
| ------------------- | ---------------- | ------- | ------------------------------------------------------ |
| `consumedBlockSize` | `number`         | `0`     | Cumulative block size across all previous fragments    |
| `sequenceNumber`    | `number`         | `0`     | Fragment sequence index                                |
| `childBreakTokens`  | `BreakToken[]`   | `[]`    | Child tokens forming the break token tree              |
| `algorithmData`     | `object \| null` | `null`  | Algorithm-specific state (flex, grid, table, multicol) |

#### Static Methods

| Method                                                                                      | Returns           | Description                                                                                                               |
| ------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `BlockBreakToken.createBreakBefore(node, isForcedBreak?, forcedBreakValue?)`                | `BlockBreakToken` | Create a break-before token. `forcedBreakValue` stores the CSS value (e.g. `"left"`, `"right"`) for side-specific breaks. |
| `BlockBreakToken.createRepeated(node, sequenceNumber)`                                      | `BlockBreakToken` | Create a repeated-fragment token                                                                                          |
| `BlockBreakToken.createForBreakInRepeatedFragment(node, sequenceNumber, consumedBlockSize)` | `BlockBreakToken` | Create a token for a break inside a repeated fragment                                                                     |

---

### InlineBreakToken

`import { InlineBreakToken } from "fragmentainers"`

Extends `BreakToken` with `type = BREAK_TOKEN_INLINE`. Content-addressed via
item index and text offset into `InlineItemsData` -- survives inline-size
changes between fragmentainers.

```js
new InlineBreakToken(node);
```

| Property       | Type      | Default | Description                                         |
| -------------- | --------- | ------- | --------------------------------------------------- |
| `itemIndex`    | `number`  | `0`     | Index into `InlineItemsData.items`                  |
| `textOffset`   | `number`  | `0`     | Character offset into `InlineItemsData.textContent` |
| `flags`        | `number`  | `0`     | Bitfield for internal state                         |
| `isHyphenated` | `boolean` | `false` | Line was broken with a hyphen                       |

---

## 4. Break Scoring

The engine uses a two-pass break scoring system. Pass 1 discovers the optimal
breakpoint (tracking `EarlyBreak` chains); if the actual break is worse, Pass 2
re-runs layout to break at that point.

### EarlyBreak

`import { EarlyBreak } from "fragmentainers"`

Represents a better breakpoint found during Pass 1.

```js
new EarlyBreak(node, score, type);
```

| Property          | Type                 | Description                                              |
| ----------------- | -------------------- | -------------------------------------------------------- |
| `node`            | `LayoutNode`         | Node where the better break occurs                       |
| `score`           | `number`             | Break quality score (lower is better, from `BreakScore`) |
| `type`            | `string`             | `EARLY_BREAK_BEFORE` or `EARLY_BREAK_INSIDE`             |
| `childEarlyBreak` | `EarlyBreak \| null` | Nested early break for child nodes (default: `null`)     |

---

### BreakScore

`import { BreakScore } from "fragmentainers"`

Score constants for break quality ranking. Lower values are better.

| Constant                              | Value | Meaning                              |
| ------------------------------------- | ----- | ------------------------------------ |
| `BreakScore.PERFECT`                  | `0`   | Ideal break (Class A, no violations) |
| `BreakScore.VIOLATING_ORPHANS_WIDOWS` | `1`   | Violates orphans/widows              |
| `BreakScore.VIOLATING_BREAK_AVOID`    | `2`   | Violates `break-inside: avoid`       |
| `BreakScore.LAST_RESORT`              | `3`   | No better option exists              |

---

## 5. Fragmentation (Fragment)

The `Fragment` class converts the immutable fragment tree into visible DOM.
Analogous to the browser paint stage, but instead of producing display lists it
clones DOM elements and lets the browser paint.

**Source:** `src/core/fragment.js`

### Fragment.build(inputBreakToken)

Walk the fragment's child fragments and compose each into a `DocumentFragment`.
Dispatches based on node type: multicol, inline, block (shallow clone + recurse),
or leaf (deep clone). Handles split attributes, pseudo-element suppression,
list continuation, and monolithic content clipping.

| Parameter         | Type                 | Description                                 |
| ----------------- | -------------------- | ------------------------------------------- |
| `inputBreakToken` | `BreakToken \| null` | Break token from the previous fragmentainer |

**Returns:** `DocumentFragment`

### Fragment.map(inputBreakToken, composedParent)

Walk the fragment tree and composed DOM in parallel, registering each
clone→source pair in the module registry's shared map. Used by modules
(NthSelectors, MutationSync) to resolve composed elements back to their source.

| Parameter         | Type                 | Description                                 |
| ----------------- | -------------------- | ------------------------------------------- |
| `inputBreakToken` | `BreakToken \| null` | Break token from the previous fragmentainer |
| `composedParent`  | `Element`            | The composed DOM parent to walk in parallel |

### Fragment.buildInlineContent(items, textContent, startOffset, endOffset, container)

Static method. Reconstructs DOM from the flat `InlineItemsData` list within
break token offset ranges.

| Parameter     | Type           | Description              |
| ------------- | -------------- | ------------------------ |
| `items`       | `InlineItem[]` | Flat inline item array   |
| `textContent` | `string`       | Full text content string |
| `startOffset` | `number`       | Start character offset   |
| `endOffset`   | `number`       | End character offset     |
| `container`   | `Element`      | Target container element |

### Fragment.hasBlockChildren

Getter. Returns `true` if this fragment has block-level child fragments (not
line fragments). Line fragments have `node === null`.

---

## 6. Custom Elements

### ContentMeasureElement (`<content-measure>`)

`import { ContentMeasureElement } from "fragmentainers"`

Off-screen measurement container with Shadow DOM. Injects content and CSS into a
shadow root so the host page's styles do not affect layout measurements.

Managed internally by `FragmentedFlow`.

#### Methods

| Method                                  | Returns                       | Description                                                               |
| --------------------------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| `injectFragment(fragment, styles?)`     | `Element`                     | Inject a `DocumentFragment` with `CSSStyleSheet[]`; returns `contentRoot` |
| `setupEmpty(styles?)`                   | `Element`                     | Set up stylesheets and clear content; returns `contentRoot`               |
| `applyConstraintSpace(constraintSpace)` | `void`                        | Sync inline size and force reflow                                         |
| `getContentStyles()`                    | `{ sheets: CSSStyleSheet[] }` | Get adopted stylesheets for composition                                   |

#### Properties

| Property      | Type                       | Description                             |
| ------------- | -------------------------- | --------------------------------------- |
| `contentRoot` | `Element \| null`          | The slot element inside the shadow root |
| `sourceRefs`  | `WeakMap<Element, string>` | Source element to ref string mapping    |

---

### FragmentContainerElement (`<fragment-container>`)

`import { FragmentContainerElement } from "fragmentainers"`

Visible page container with Shadow DOM. Wraps composed fragment output to
prevent CSS leakage from the host page. Uses `all: initial` on `:host` and
`contain: strict`.

#### Methods

| Method                                                | Returns            | Description                                                                                                  |
| ----------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `setupForRendering(contentStyles?, counterSnapshot?)` | `Element`          | Set up shadow root with styles; returns wrapper element                                                      |
| `startObserving()`                                    | `void`             | Attach `ResizeObserver` and `MutationObserver` on the content wrapper. Deferred via `requestAnimationFrame`. |
| `stopObserving()`                                     | `void`             | Disconnect all observers                                                                                     |
| `takeMutationRecords()`                               | `MutationRecord[]` | Return and drain all buffered mutation records                                                               |

#### Properties

| Property            | Type              | Description                                                                                   |
| ------------------- | ----------------- | --------------------------------------------------------------------------------------------- |
| `contentRoot`       | `Element \| null` | The slot element inside the shadow root                                                       |
| `fragmentIndex`     | `number`          | Zero-based index of this fragmentainer                                                        |
| `namedPage`         | `string \| null`  | CSS named page type for this fragment (from `PageConstraints.namedPage`)                      |
| `nthFormulas`       | `Map \| null`     | Nth-selector formula descriptors from stylesheet rewriting                                    |
| `expectedBlockSize` | `number` (setter) | Set the expected block size from layout. Used by the overflow detector.                       |
| `overflowThreshold` | `number` (setter) | Minimum delta in px before `overflow` event fires (defaults to `DEFAULT_OVERFLOW_THRESHOLD`). |

#### Events

| Event             | Detail                                                      | Description                                                                                                   |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `fragment-change` | `{ index: number }`                                         | Fired when content inside the fragment changes (coalesced via `queueMicrotask`)                               |
| `overflow`        | `{ index, expectedBlockSize, renderedBlockSize, overflow }` | Fired when rendered content height exceeds the layout-computed expected size by more than `overflowThreshold` |

### ContentParser

`import { ContentParser } from "fragmentainers"`

**Source:** `src/dom/content-parser.js`

Parses an HTML document string into a `DocumentFragment` + `CSSStyleSheet[]`
with all relative URLs resolved against the content's origin. Handles CSS
preprocessing for properties not natively supported by browsers (e.g. rewrites
`position: running(...)` to a custom property).

#### Static Methods

| Method                                  | Returns                  | Description                                                   |
| --------------------------------------- | ------------------------ | ------------------------------------------------------------- |
| `ContentParser.parse(content, baseURL)` | `Promise<ContentParser>` | Parse HTML string, fetch linked stylesheets, resolve all URLs |

#### Properties

| Property   | Type               | Description                        |
| ---------- | ------------------ | ---------------------------------- |
| `fragment` | `DocumentFragment` | Body content with resolved URLs    |
| `styles`   | `CSSStyleSheet[]`  | Source sheets + URL override sheet |

#### Example

```js
const parsed = await ContentParser.parse(htmlString, "https://example.com/book/");
const layout = new FragmentedFlow(parsed.fragment, {
	styles: parsed.styles,
});
const flow = layout.flow();
for (const el of flow) document.body.append(el);
```

---

## 7. Helpers

### findChildBreakToken(parentBreakToken, childNode)

`import { findChildBreakToken } from "fragmentainers"`

Find a child's break token within a parent's break token by matching the
`node` reference.

| Parameter          | Type                      | Description        |
| ------------------ | ------------------------- | ------------------ |
| `parentBreakToken` | `BlockBreakToken \| null` | Parent break token |
| `childNode`        | `LayoutNode`              | Child node to find |

**Returns:** `BreakToken | null`

### isMonolithic(node)

`import { isMonolithic } from "fragmentainers"`

Check if a node is monolithic (cannot be fragmented). True for replaced
elements, scrollable elements, and elements with `overflow: hidden` plus an
explicit block size.

**Returns:** `boolean`

### getMonolithicBlockSize(node, constraintSpace)

`import { getMonolithicBlockSize } from "fragmentainers"`

Get the block size of a monolithic element without full layout.

| Parameter         | Type              | Description              |
| ----------------- | ----------------- | ------------------------ |
| `node`            | `LayoutNode`      | Monolithic node          |
| `constraintSpace` | `ConstraintSpace` | Current constraint space |

**Returns:** `number`

### debugPrintTokenTree(breakToken, indent?)

`import { debugPrintTokenTree } from "fragmentainers"`

Print a human-readable tree of the break token hierarchy. Useful for debugging.

| Parameter    | Type         | Default | Description       |
| ------------ | ------------ | ------- | ----------------- |
| `breakToken` | `BreakToken` | --      | Root break token  |
| `indent`     | `number`     | `0`     | Indentation level |

**Returns:** `string`

### isForcedBreakValue(value)

`import { isForcedBreakValue } from "fragmentainers/src/core/helpers.js"`

Check if a CSS `break-before`/`break-after` value is a forced break. Returns
`true` for `"page"`, `"column"`, `"always"`, `"left"`, `"right"`, `"recto"`, `"verso"`.

**Returns:** `boolean`

### isSideSpecificBreak(value)

`import { isSideSpecificBreak } from "fragmentainers/src/core/helpers.js"`

Check if a CSS break value requires a specific page side. Returns `true` for
`"left"`, `"right"`, `"recto"`, `"verso"`.

**Returns:** `boolean`

### requiredPageSide(value)

`import { requiredPageSide } from "fragmentainers/src/core/helpers.js"`

Return the required page side for a side-specific break value. Normalizes
`recto` to `"right"` and `verso` to `"left"`.

**Returns:** `"left" | "right" | null`

### resolveForcedBreakValue(breakToken)

`import { resolveForcedBreakValue } from "fragmentainers/src/core/helpers.js"`

Walk the break token tree to find the `forcedBreakValue` that triggered the
break.

**Returns:** `string | null`

### resolveNextPageBreakBefore(rootNode, breakToken)

`import { resolveNextPageBreakBefore } from "fragmentainers/src/core/helpers.js"`

Resolve the `break-before` CSS value of the first child that will appear on
the next page. Used to detect side-specific breaks when `blockOffset === 0`
prevented the forced break from firing in `layoutBlockContainer`.

**Returns:** `string | null`

### resolveColumnDimensions(U, specifiedWidth, specifiedCount, gap)

`import { resolveColumnDimensions } from "fragmentainers/src/layout/multicol-container.js"`

CSS Multicol section 3 pseudo-algorithm. Resolves used column count and width from CSS
properties and container width.

| Parameter        | Type             | Description                          |
| ---------------- | ---------------- | ------------------------------------ |
| `U`              | `number`         | Container's content box inline-size  |
| `specifiedWidth` | `number \| null` | `column-width` value (`null` = auto) |
| `specifiedCount` | `number \| null` | `column-count` value (`null` = auto) |
| `gap`            | `number`         | `column-gap` value in px             |

**Returns:** `{ count: number, width: number }`

### MutationSync

`import { MutationSync } from "fragmentainers"`

Applies mutations observed on rendered clones back to the source DOM. Uses
`data-ref` attributes to map clone elements to their source counterparts.

#### Constructor

```js
new MutationSync(refMap, sourceRoot, assignRef, removeRef);
```

| Parameter    | Type                      | Description                                                                |
| ------------ | ------------------------- | -------------------------------------------------------------------------- |
| `refMap`     | `Map<string, Element>`    | Ref string to source element mapping (from `ContentMeasureElement.refMap`) |
| `sourceRoot` | `Element`                 | Source content root element                                                |
| `assignRef`  | `(el: Element) => string` | Callback to assign a ref to a new element                                  |
| `removeRef`  | `(ref: string) => void`   | Callback to remove a ref                                                   |

#### Methods

| Method                      | Returns                                     | Description                                                                                       |
| --------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `applyMutations(mutations)` | `{ changed: boolean, structural: boolean }` | Apply mutation records to the source DOM. `structural` is true if elements were added or removed. |

---

### CounterState

`import { CounterState } from "fragmentainers"`

Flat counter state accumulator. Tracks counter values as a `Map<string, number>`
across fragmentainers.

#### Methods

| Method                    | Returns                  | Description                                        |
| ------------------------- | ------------------------ | -------------------------------------------------- |
| `applyReset(entries)`     | `void`                   | Apply `counter-reset` directives                   |
| `applyIncrement(entries)` | `void`                   | Apply `counter-increment` directives               |
| `snapshot()`              | `Object<string, number>` | Return a frozen snapshot of current counter values |
| `isEmpty()`               | `boolean`                | True if no counters have been tracked              |

### parseCounterDirective(value)

`import { parseCounterDirective } from "fragmentainers"`

Parse a CSS counter directive string into an array of `{ name, value }` entries.

| Parameter | Type             | Description                                         |
| --------- | ---------------- | --------------------------------------------------- |
| `value`   | `string \| null` | CSS computed value (e.g. `"paragraph 0 section 0"`) |

**Returns:** `{ name: string, value: number }[]`

### walkFragmentTree(fragment, inputBreakToken, counterState)

`import { walkFragmentTree } from "fragmentainers"`

Walk a fragment tree in document order, applying counter operations to the
given `CounterState`. Skips continuation elements (where `inputBreakToken` is
non-null) since those were already counted in a previous fragmentainer.

| Parameter         | Type                 | Description                             |
| ----------------- | -------------------- | --------------------------------------- |
| `fragment`        | `PhysicalFragment`   | Root fragment to walk                   |
| `inputBreakToken` | `BreakToken \| null` | Break token from previous fragmentainer |
| `counterState`    | `CounterState`       | Accumulator                             |

---

## 8. Constants

`import { constants } from "fragmentainers"`

### Fragmentation Types

Used in `ConstraintSpace.fragmentationType`.

| Constant               | Value      | Description              |
| ---------------------- | ---------- | ------------------------ |
| `FRAGMENTATION_NONE`   | `"none"`   | No fragmentation context |
| `FRAGMENTATION_PAGE`   | `"page"`   | Page fragmentation       |
| `FRAGMENTATION_COLUMN` | `"column"` | Column fragmentation     |
| `FRAGMENTATION_REGION` | `"region"` | Region fragmentation     |

### Inline Item Types

Used in `InlineItemsData.items[].type`.

| Constant           | Value            | Description                               |
| ------------------ | ---------------- | ----------------------------------------- |
| `INLINE_TEXT`      | `"Text"`         | Text run                                  |
| `INLINE_CONTROL`   | `"Control"`      | Line break (`<br>`) or similar control    |
| `INLINE_OPEN_TAG`  | `"OpenTag"`      | Start of an inline element                |
| `INLINE_CLOSE_TAG` | `"CloseTag"`     | End of an inline element                  |
| `INLINE_ATOMIC`    | `"AtomicInline"` | Atomic inline (image, inline-block, etc.) |

### Break Token Types

Used in `BreakToken.type`.

| Constant             | Value      | Description              |
| -------------------- | ---------- | ------------------------ |
| `BREAK_TOKEN_BLOCK`  | `"block"`  | Block-level break token  |
| `BREAK_TOKEN_INLINE` | `"inline"` | Inline-level break token |

### Box Decoration Break

Used in `node.boxDecorationBreak`.

| Constant               | Value     | Description                               |
| ---------------------- | --------- | ----------------------------------------- |
| `BOX_DECORATION_SLICE` | `"slice"` | Default: decorations are sliced at breaks |
| `BOX_DECORATION_CLONE` | `"clone"` | Decorations are cloned on each fragment   |

### Early Break Types

Used in `EarlyBreak.type`.

| Constant             | Value      | Description                  |
| -------------------- | ---------- | ---------------------------- |
| `EARLY_BREAK_BEFORE` | `"before"` | Break before the target node |
| `EARLY_BREAK_INSIDE` | `"inside"` | Break inside the target node |

### Algorithm Data Types

Used in `breakToken.algorithmData.type`.

| Constant              | Value            | Description                        |
| --------------------- | ---------------- | ---------------------------------- |
| `ALGORITHM_FLEX`      | `"FlexData"`     | Flex container algorithm state     |
| `ALGORITHM_FLEX_LINE` | `"FlexLineData"` | Flex line algorithm state          |
| `ALGORITHM_GRID`      | `"GridData"`     | Grid container algorithm state     |
| `ALGORITHM_TABLE_ROW` | `"TableRowData"` | Table row algorithm state          |
| `ALGORITHM_MULTICOL`  | `"MulticolData"` | Multicol container algorithm state |

### Overflow Threshold

| Constant                     | Value               | Description                                                                                                    |
| ---------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_OVERFLOW_THRESHOLD` | `19.2` (`16 * 1.2`) | Default overflow threshold matching the browser default line height for `font-size: 16px; line-height: normal` |

### Named Page Sizes

All dimensions are in CSS pixels at 96 DPI.

| Key      | inlineSize | blockSize |
| -------- | ---------- | --------- |
| `A6`     | 397        | 559       |
| `A5`     | 559        | 794       |
| `A4`     | 794        | 1123      |
| `A3`     | 1123       | 1587      |
| `B5`     | 499        | 709       |
| `B4`     | 709        | 1001      |
| `LETTER` | 816        | 1056      |
| `LEGAL`  | 816        | 1344      |
| `LEDGER` | 1056       | 1632      |

---

## 9. Layout Algorithms

All layout algorithms are generator functions with the same core signature.
They `yield` `LayoutRequest` objects and receive child layout results. For
detailed algorithm descriptions, see [layout-algorithms.md](layout-algorithms.md).

`import { layoutBlockContainer, layoutInlineContent, layoutTableRow } from "fragmentainers"`

| Algorithm                 | Signature                                                         | Source                             |
| ------------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| `layoutBlockContainer`    | `function*(node, constraintSpace, breakToken, earlyBreakTarget?)` | `src/layout/block-container.js`    |
| `layoutInlineContent`     | `function*(node, constraintSpace, breakToken)`                    | `src/layout/inline-content.js`     |
| `layoutTableRow`          | `function*(node, constraintSpace, breakToken)`                    | `src/layout/table-row.js`          |
| `layoutMulticolContainer` | `function*(node, constraintSpace, breakToken)`                    | `src/layout/multicol-container.js` |
| `layoutFlexContainer`     | `function*(node, constraintSpace, breakToken)`                    | `src/layout/flex-container.js`     |
| `layoutGridContainer`     | `function*(node, constraintSpace, breakToken)`                    | `src/layout/grid-container.js`     |

All generators return `{ fragment: PhysicalFragment, breakToken: BreakToken | null, earlyBreak?: EarlyBreak }` via their final `return` value. Only `layoutBlockContainer` accepts the `earlyBreakTarget` parameter for two-pass break optimization.

### Dispatch Order

`getLayoutAlgorithm(node)` selects the algorithm by checking node properties in
this order:

1. `isMulticolContainer` -- `layoutMulticolContainer`
2. `isFlexContainer` -- `layoutFlexContainer`
3. `isGridContainer` -- `layoutGridContainer`
4. `isInlineFormattingContext` -- `layoutInlineContent`
5. `isTableRow` -- `layoutTableRow`
6. (default) -- `layoutBlockContainer`

---

## 10. Layout Modules

Layout modules extend the engine with custom behaviors. See
[modules.md](modules.md) for the full guide on writing custom modules.

### LayoutModule (base class)

`import { LayoutModule } from "fragmentainers"`

Base class for all layout modules. Subclass and override methods as needed.

#### Properties

| Property  | Type     | Description                                                           |
| --------- | -------- | --------------------------------------------------------------------- |
| `options` | `Object` | Options passed from `FragmentedFlow` via the registry. Default: `{}`. |

#### Methods

| Method                                                           | Returns                                                 | Description                                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `claim(node)`                                                    | `boolean`                                               | Return `true` if this module claims a child node (removes it from flow). Default: `false`.           |
| `resetRules()`                                                   | `void`                                                  | Reset state from a previous `matchRule` pass. Called before each CSS rule walk.                      |
| `matchRule(rule, context)`                                       | `void`                                                  | Inspect a CSS rule during the centralized rule walk. `context.wrappers` has grouping rule preambles. |
| `appendRules(rules)`                                             | `void`                                                  | Push CSS rule text strings into `rules[]` to inject into a shared stylesheet.                        |
| `claimPersistent(content)`                                       | `Element[]`                                             | Called before measurement. Return elements to include in every measurement segment.                  |
| `claimPseudo(element, pseudo, contentValue)`                     | `boolean`                                               | Claim a pseudo-element during materialization. Return `true` to prevent default handling.            |
| `claimPseudoRule(rule, pseudo)`                                  | `boolean`                                               | Claim a CSS pseudo-element rule. Return `true` to skip rewriting.                                    |
| `afterMeasurementSetup(contentRoot)`                             | `void`                                                  | Called after measurement DOM is set up. Modules can probe live elements via `getComputedStyle`.      |
| `getAdoptedSheets()`                                             | `CSSStyleSheet[]`                                       | Return stylesheets to adopt on each fragment-container's shadow DOM.                                 |
| `layout(rootNode, constraintSpace, breakToken, layoutChild)`     | `{ reservedBlockStart, reservedBlockEnd, afterRender }` | Pre-layout hook. Called once per fragmentainer.                                                      |
| `beforeChildren(node, constraintSpace, breakToken)`              | `{ node, constraintSpace, isRepeated } \| null`         | Called before the child loop. Return a layout descriptor to prepend, or `null`.                      |
| `afterContentLayout(fragment, constraintSpace, inputBreakToken)` | `{ reservedBlockEnd, afterRender } \| null`             | Called after content layout. Return updated reservations to trigger re-layout.                       |

---

### modules (registry)

`import { modules } from "fragmentainers"`

Global `ModuleRegistry` instance. Built-in modules are registered automatically
at import time.

#### Methods

| Method                                                           | Returns           | Description                                                               |
| ---------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------- |
| `register(module)`                                               | `void`            | Register a module instance                                                |
| `remove(module)`                                                 | `void`            | Unregister a module                                                       |
| `setOptions(options)`                                            | `void`            | Pass options from `FragmentedFlow` to all modules                         |
| `processRules(styles)`                                           | `void`            | Walk CSS rules, dispatch to `matchRule()`, collect `appendRules()` output |
| `claim(node)`                                                    | `boolean`         | Check if any registered module claims this node                           |
| `claimPersistent(content)`                                       | `Element[]`       | Aggregate persistent elements from all modules                            |
| `afterMeasurementSetup(contentRoot)`                             | `void`            | Let modules probe the live measurement DOM                                |
| `getAdoptedSheets()`                                             | `CSSStyleSheet[]` | Collect stylesheets from modules for fragment-containers                  |
| `layout(rootNode, constraintSpace, breakToken, layoutChild)`     | `object`          | Aggregate `layout()` results from all modules                             |
| `beforeChildren(node, constraintSpace, breakToken)`              | `object \| null`  | First non-null `beforeChildren()` result                                  |
| `afterContentLayout(fragment, constraintSpace, inputBreakToken)` | `object \| null`  | Aggregate `afterContentLayout()` results                                  |

---

### Built-in Modules

All built-in modules are registered automatically. They can also be imported directly.

| Module                | Import                                                                         | Description                                                                   |
| --------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `PageFloat`           | `import { PageFloat } from "fragmentainers"`                                   | Page-relative floats via `--float-reference: page` and `--float: top\|bottom` |
| `PageFit`             | `import { PageFit } from "fragmentainers"`                                     | Full-page elements via `--page-fit: contain\|cover\|fill`                     |
| `RepeatedTableHeader` | `import { RepeatedTableHeader } from "fragmentainers"`                         | Repeat `<thead>` on continuation pages                                        |
| `FixedPosition`       | `import { FixedPosition } from "fragmentainers/src/modules/fixed-position.js"` | Repeat `position: fixed` elements on every page                               |
| `Footnote`            | `import { Footnote } from "fragmentainers/src/modules/footnote.js"`            | CSS footnotes (`float: footnote`) with iterative layout                       |
| `Normalize`           | `import { Normalize } from "fragmentainers/src/modules/normalize.js"`          | Line-height normalization via `normalizeLineHeight` option                    |

---

### FontMetrics

`import { getSharedFontMetrics } from "fragmentainers/src/dom/font-metrics.js"`

Canvas-based font metric extraction. Measures the `fontBoundingBoxAscent + fontBoundingBoxDescent` ratio at a reference size and caches per font-family/weight/style combination. Results are rounded to the device pixel grid (floored at DPR 1, rounded at higher DPRs).

#### `getSharedFontMetrics()`

Returns the lazily-initialized shared `FontMetrics` singleton.

#### FontMetrics instance

| Property / Method                                          | Returns  | Description                                                           |
| ---------------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| `dpr`                                                      | `number` | Current device pixel ratio for rounding (get/set)                     |
| `measure(family, weight?, style?)`                         | `number` | Raw line-height ratio for a font (cached, DPR-independent)            |
| `getNormalLineHeight(element)`                             | `number` | DPR-rounded `line-height: normal` for a live DOM element              |
| `computeNormalLineHeight(family, weight, style, fontSize)` | `number` | DPR-rounded `line-height: normal` from raw CSS values (no DOM needed) |
