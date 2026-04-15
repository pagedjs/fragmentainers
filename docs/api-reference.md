# API Reference

Complete API reference for `fragmentainers`.

## Package Exports

The top-level entry point exposes the main public API:

```js
import {
	FragmentedFlow,
	Fragment,
	FragmentationContext,
	ConstraintSpace,
	PageResolver,
	handlers,
} from "fragmentainers";
```

Additional subpath barrels expose the rest of the public surface area:

| Subpath | Exports |
| --- | --- |
| `fragmentainers/fragmentation` | `BreakToken`, `BlockBreakToken`, `InlineBreakToken`, `findChildBreakToken`, `Fragment`, `ConstraintSpace`, `EarlyBreak`, `BreakScore`, `FragmentedFlow`, `FragmentationContext`, `CounterState`, `parseCounterDirective`, `walkFragmentTree` |
| `fragmentainers/layout` | `LayoutRequest`, `createFragments`, `LayoutDriver`, `runLayoutGenerator`, `getLayoutAlgorithm`, `isMonolithic`, `getMonolithicBlockSize`, `buildCumulativeHeights`, `LayoutNode`, `DOMLayoutNode`, `AnonymousBlockNode`, `FlowThreadNode` |
| `fragmentainers/algorithms` | `BlockContainerAlgorithm`, `FlexAlgorithm`, `GridAlgorithm`, `InlineContentAlgorithm`, `MulticolAlgorithm`, `TableRowAlgorithm`, `resolveColumnDimensions` |
| `fragmentainers/resolvers` | `PageResolver`, `RegionResolver`, `RegionConstraints` |
| `fragmentainers/components` | `ContentMeasureElement`, `FragmentContainerElement` |
| `fragmentainers/styles` | `computedStyleMap` |
| `fragmentainers/handlers` | `LayoutHandler`, `handlers`, `PageFloat`, `RepeatedTableHeader`, `FixedPosition`, `Footnote` |

Constants and internal helpers (e.g. `NAMED_SIZES`, `FRAGMENTATION_*`, `BOX_DECORATION_*`, `walkRules`, `parseNumeric`) are imported from the specific file that owns them — see each section below for the exact path.

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
10. [Layout Handlers](#10-layout-handlers)

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
| `options.styles`              | `CSSStyleSheet[]`                           | Stylesheets applied via `adoptedStyleSheets`. Omit to auto-fallback: uses `document.adoptedStyleSheets` when non-empty, else `document.styleSheets`. |
| `options.constraintSpace`     | `ConstraintSpace`                           | Direct constraint space (bypasses `@page` rules)                                                                                          |
| `options.resolver`            | `PageResolver \| RegionResolver`            | Pre-configured resolver                                                                                                                   |
| `options.width`               | `number`                                    | Container width in CSS px (column fragmentation)                                                                                          |
| `options.height`              | `number`                                    | Container height in CSS px (column fragmentation)                                                                                         |
| `options.type`                | `string`                                    | Fragmentation type when using `width`/`height` (default: `FRAGMENTATION_COLUMN`)                                                          |

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

**Source:** `src/fragmentation/fragmentation-context.js`

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
| `fragments`     | `Fragment[]`                                                         | Array of root fragments, one per fragmentainer |
| `contentStyles` | `{ sheets: CSSStyleSheet[], nthFormulas: Map, sourceRefs: WeakMap } \| null` | Content styles and ref maps for composition    |

#### Properties

| Property             | Type                 | Description              |
| -------------------- | -------------------- | ------------------------ |
| `fragments`          | `Fragment[]` | The fragment array       |
| `fragmentainerCount` | `number`             | Number of fragmentainers |

#### Methods

| Method                       | Returns   | Description                                                                                                                                                 |
| ---------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createFragmentainer(index)` | `Element` | Create a single fragmentainer as a `<fragment-container>` element. Blank pages get `data-blank-page` attribute. Sets `namedPage` property from constraints. |

---

### PageResolver

`import { PageResolver } from "fragmentainers/src/resolvers/page-resolver.js"`

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
| `isVerso(pageIndex)`                                 | `boolean`                      | True when the page is verso (left). LTR page progression: page 0 is recto (right), page 1 is verso (left)                |
| `isRecto(pageIndex)`                                 | `boolean`                      | Inverse of `isVerso`                                                                                                      |

---

### PageRule

`import { PageRule } from "fragmentainers/src/resolvers/page-resolver.js"`

Parsed representation of a CSS `@page` rule.

#### Constructor

```js
new PageRule({ name, pseudoClasses, size, margin, pageOrientation });
```

| Property          | Type                                   | Description                                                       |
| ----------------- | -------------------------------------- | ----------------------------------------------------------------- |
| `name`            | `string \| null`                       | Named page type (`"chapter"`, `"cover"`), or `null` for universal |
| `pseudoClasses`   | `string[]`                             | Any combination of `"first"`, `"left"`, `"right"`, `"blank"`      |
| `size`            | `string \| number[] \| null`           | `"a4"`, `"letter landscape"`, `[width, height]`, or `null`        |
| `margin`          | `{ top, right, bottom, left } \| null` | Margins in CSS px                                                 |
| `pageOrientation` | `string \| null`                       | `"rotate-left"`, `"rotate-right"`, or `null`                      |

---

### PageConstraints

`import { PageConstraints } from "fragmentainers/src/resolvers/page-resolver.js"`

Resolved page dimensions for one page -- the fragmentainer definition.

#### Constructor

```js
new PageConstraints({ pageIndex, namedPage, pageBoxSize, margins, contentArea, isFirst, isVerso, isRecto, isBlank? })
```

| Property      | Type                                        | Description                                                                        |
| ------------- | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `pageIndex`   | `number`                                    | Zero-based page number                                                             |
| `namedPage`   | `string \| null`                            | CSS `page` property value                                                          |
| `pageBoxSize` | `{ inlineSize: number, blockSize: number }` | Full page dimensions                                                               |
| `margins`     | `{ top, right, bottom, left }`              | Resolved margins in CSS px                                                         |
| `contentArea` | `{ inlineSize: number, blockSize: number }` | The fragmentainer (page box minus margins)                                         |
| `isFirst`     | `boolean`                                   | Whether this is the first page                                                     |
| `isVerso`     | `boolean`                                   | Whether this is a verso (left) page                                                |
| `isRecto`     | `boolean`                                   | Whether this is a recto (right) page                                               |
| `isBlank`     | `boolean`                                   | Whether this is a blank page inserted for a side-specific break (default: `false`) |

#### Methods

| Method                | Returns           | Description                                                      |
| --------------------- | ----------------- | ---------------------------------------------------------------- |
| `toConstraintSpace()` | `ConstraintSpace` | Build a `ConstraintSpace` for layout from these page constraints |

---

### parsePageRulesFromCSS(cssTexts)

`import { parsePageRulesFromCSS } from "fragmentainers/src/resolvers/page-resolver.js"`

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

### parseNumeric(str)

`import { parseNumeric } from "fragmentainers/src/styles/css-values.js"`

Parse a CSS numeric/length string into a typed value with `.value`, `.unit`,
`.to()`, `.add()`, and `.sub()`. Uses native `CSSNumericValue.parse()` when
available (Chromium) so `calc()` expressions and any supported unit work.
Falls back to a regex polyfill (physical units only) in other browsers. Bare
numbers are treated as `px`.

| Parameter | Type     | Description                                                       |
| --------- | -------- | ----------------------------------------------------------------- |
| `str`     | `string` | CSS numeric value (e.g. `"2cm"`, `"100px"`, `"calc(1in - 2mm)"`) |

**Returns:** `CSSNumericValue | UnitValue | null`

Convert to px with `.to("px").value`:

```js
parseNumeric("2cm").to("px").value; // 75.59...
parseNumeric("calc(1in + 2mm)").to("px").value; // 103.55...
```

### cssValue(value, unit)

`import { cssValue } from "fragmentainers/src/styles/css-values.js"`

Construct a CSS numeric value. Returns a native `CSSUnitValue` when available,
otherwise a `UnitValue` polyfill with the same `.value`, `.unit`, `.to()`,
`.add()`, `.sub()` shape.

### UnitValue

`import { UnitValue } from "fragmentainers/src/styles/css-values.js"`

Polyfill for `CSSUnitValue` used when native CSS Typed OM is unavailable.
Provides a subset of the Typed OM arithmetic/conversion interface.

| Method / Property | Returns     | Description                                                |
| ----------------- | ----------- | ---------------------------------------------------------- |
| `value`           | `number`    | Numeric component                                          |
| `unit`            | `string`    | Unit name (e.g. `"px"`, `"mm"`, `"em"`, `"percent"`)       |
| `to(unit)`        | `UnitValue` | Convert to target unit (physical units; throws otherwise)  |
| `add(other)`      | `UnitValue` | Add another value; converts to px when units differ        |
| `sub(other)`      | `UnitValue` | Subtract another value; converts to px when units differ   |

### computedStyleMap(element)

`import { computedStyleMap } from "fragmentainers/src/styles/computed-style-map.js"`

Polyfill for `element.computedStyleMap()` — returns a map whose `.get(property)`
yields a `UnitValue` (numeric) or `{ value: keyword }` (keyword). Uses native
Typed OM when available.

### walkRules, walkSheets, insertWrappedRule

`import { walkRules, walkSheets, insertWrappedRule } from "fragmentainers/src/styles/walk-rules.js"`

Shared helpers for walking CSS rule trees used by handlers and `@page`
processing.

- `walkRules(ruleList, visitor, wrappers?)` — recursive descent that calls
  `visitor(rule, wrappers)` for each leaf rule. Handles grouping rules
  (`@media`, `@supports`, `@layer`); rules with `selectorText` (including
  `@page`) are treated as leaves.
- `walkSheets(sheets, visitor)` — walks multiple stylesheets, silently
  skipping cross-origin sheets.
- `insertWrappedRule(target, ruleText, wrappers)` — inserts a rule into
  `target`, wrapping inside-out in the given grouping rule preambles.

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
| `rootNode`                  | `LayoutNode`                                                  | Root layout node (e.g. a `DOMLayoutNode`)    |
| `constraintSpaceOrResolver` | `ConstraintSpace \| PageResolver`                             | Reused constraint space or per-page resolver |
| `continuation`              | `{ fragmentainerIndex: number, blockOffset: number } \| null` | Resume state for multi-element flows         |

**Returns:** `Fragment[]` (no continuation) or `{ fragments: Fragment[], continuation }` (with continuation).

---

### runLayoutGenerator(algorithm)

`import { runLayoutGenerator } from "fragmentainers/layout"`

**Source:** `src/layout/layout-driver.js`

Recursive driver that runs an algorithm instance to completion, fulfilling each
`LayoutRequest` yielded from `*layout()` by instantiating the correct child
algorithm class (via `getLayoutAlgorithm`) and recursing into it.

| Parameter   | Type     | Description                                                                                                 |
| ----------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `algorithm` | `Object` | Algorithm instance with a `*layout()` generator method (e.g. `new BlockContainerAlgorithm(node, cs, bt))` |

**Returns:** `{ fragment: Fragment, breakToken: BreakToken | null, earlyBreak?: EarlyBreak }`

---

### getLayoutAlgorithm(node)

`import { getLayoutAlgorithm } from "fragmentainers/layout"`

**Source:** `src/layout/layout-driver.js`

Dispatch to the correct layout algorithm class based on node type. Checked in order:
`isMulticolContainer` → `isFlexContainer` → `isGridContainer` →
`isInlineFormattingContext` → `isTableRow` → `BlockContainerAlgorithm` (default).

| Parameter | Type         | Description            |
| --------- | ------------ | ---------------------- |
| `node`    | `LayoutNode` | Layout node to inspect |

**Returns:** An algorithm **class** constructor. Instantiate with `new Algo(node, constraintSpace, breakToken)` (plus optional `earlyBreakTarget` for `BlockContainerAlgorithm`) and pass the instance to `runLayoutGenerator`.

---

### DOMLayoutNode(element)

`import { DOMLayoutNode } from "fragmentainers"`

Wrap a DOM element as a layout tree root. Properties are resolved lazily from
`getComputedStyle()` during layout traversal.

```js
const tree = new DOMLayoutNode(document.querySelector(".content"));
```

| Parameter | Type      | Description         |
| --------- | --------- | ------------------- |
| `element` | `Element` | DOM element to wrap |

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

`import { MarginState } from "fragmentainers/src/layout/margin-collapsing.js"`

Stateful tracker for CSS2 §8.3.1 block margin collapsing. Used by
`BlockContainerAlgorithm` to resolve collapsed margins between siblings, through
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

### Fragment

`import { Fragment } from "fragmentainers"`

Immutable layout output. Represents a laid-out box or line within a single
fragmentainer. Forms a tree via `childFragments`.

#### Constructor

```js
new Fragment(node, blockSize, childFragments?)
```

| Property         | Type                      | Default | Description                                                                  |
| ---------------- | ------------------------- | ------- | ---------------------------------------------------------------------------- |
| `node`           | `LayoutNode \| null`      | --      | Source layout node (`null` for line fragments)                               |
| `blockSize`      | `number`                  | --      | Block-axis size consumed in this fragmentainer                               |
| `inlineSize`     | `number`                  | `0`     | Inline-axis size                                                             |
| `childFragments` | `Fragment[]`      | `[]`    | Child fragments within this fragment                                         |
| `breakToken`     | `BreakToken \| null`      | `null`  | Continuation token if content overflowed                                     |
| `constraints`    | `PageConstraints \| null` | `null`  | Page constraints (set by driver on root fragments)                           |
| `multicolData`   | `object \| null`          | `null`  | Multicol layout data (`{ columnWidth, columnGap, columnCount }`)             |
| `lineCount`      | `number`                  | `0`     | Number of lines (for inline formatting contexts)                             |
| `isRepeated`     | `boolean`                 | `false` | Repeated content (e.g. table thead across pages)                             |
| `isBlank`        | `boolean`                 | `false` | Blank page inserted for side-specific break (`left`/`right`/`recto`/`verso`) |
| `counterState`   | `object \| null`          | `null`  | Counter snapshot for this fragmentainer                                      |

---

### LayoutRequest

`import { LayoutRequest } from "fragmentainers/layout"`

**Source:** `src/layout/layout-request.js`

Yielded from an algorithm's `*layout()` generator to the driver. Represents a
request to lay out a child node.

```js
// Inside an algorithm's *layout() method:
const result = yield new LayoutRequest(childNode, childConstraintSpace, childBreakToken);
```

#### Constructor

```js
new LayoutRequest(node, constraintSpace, breakToken?)
```

| Property          | Type                 | Description                          |
| ----------------- | -------------------- | ------------------------------------ |
| `node`            | `LayoutNode`         | Child node to lay out                |
| `constraintSpace` | `ConstraintSpace`    | Layout input for the child           |
| `breakToken`      | `BreakToken \| null` | Continuation token (default: `null`) |

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

**Source:** `src/fragmentation/fragment.js`

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
clone→source pair in the handler registry's shared map. Used by handlers
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

The two custom elements live under `src/components/`. They are auto-registered on import via `customElements.define()`.

### ContentMeasureElement (`<content-measure>`)

`import { ContentMeasureElement } from "fragmentainers"`

**Source:** `src/components/content-measure.js`

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

**Source:** `src/components/fragment-container.js`

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
| `constraints`       | `PageConstraints \| RegionConstraints \| ConstraintSpace \| null` | Resolver output / fragmentainer geometry for this fragment   |
| `nthFormulas`       | `Map \| null`     | Nth-selector formula descriptors from stylesheet rewriting                                    |
| `expectedBlockSize` | `number` (setter) | Set the expected block size from layout. Used by the overflow detector.                       |
| `overflowThreshold` | `number` (setter) | Minimum delta in px before `overflow` event fires (defaults to `DEFAULT_OVERFLOW_THRESHOLD`). |

#### Events

| Event             | Detail                                                      | Description                                                                                                   |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `fragment-change` | `{ index: number }`                                         | Fired when content inside the fragment changes (coalesced via `queueMicrotask`)                               |
| `overflow`        | `{ index, expectedBlockSize, renderedBlockSize, overflow }` | Fired when rendered content height exceeds the layout-computed expected size by more than `overflowThreshold` |

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

`import { isForcedBreakValue } from "fragmentainers/src/fragmentation/tokens.js"`

Check if a CSS `break-before`/`break-after` value is a forced break. Returns
`true` for `"page"`, `"column"`, `"always"`, `"left"`, `"right"`, `"recto"`, `"verso"`.

**Returns:** `boolean`

### isSideSpecificBreak(value)

`import { isSideSpecificBreak } from "fragmentainers/src/resolvers/page-resolver.js"`

Check if a CSS break value requires a specific page side. Returns `true` for
`"left"`, `"right"`, `"recto"`, `"verso"`.

**Returns:** `boolean`

### requiredPageSide(value)

`import { requiredPageSide } from "fragmentainers/src/resolvers/page-resolver.js"`

Return the required page side for a side-specific break value. Normalizes
`recto` to `"right"` and `verso` to `"left"`.

**Returns:** `"left" | "right" | null`

### resolveForcedBreakValue(breakToken)

`import { resolveForcedBreakValue } from "fragmentainers/src/resolvers/page-resolver.js"`

Walk the break token tree to find the `forcedBreakValue` that triggered the
break.

**Returns:** `string | null`

### resolveNextPageBreakBefore(rootNode, breakToken)

`import { resolveNextPageBreakBefore } from "fragmentainers/src/resolvers/page-resolver.js"`

Resolve the `break-before` CSS value of the first child that will appear on
the next page. Used to detect side-specific breaks when `blockOffset === 0`
prevented the forced break from firing in `BlockContainerAlgorithm`.

**Returns:** `string | null`

### resolveColumnDimensions(U, specifiedWidth, specifiedCount, gap)

`import { resolveColumnDimensions } from "fragmentainers/src/algorithms/multicol-container.js"`

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
| `fragment`        | `Fragment`   | Root fragment to walk                   |
| `inputBreakToken` | `BreakToken \| null` | Break token from previous fragmentainer |
| `counterState`    | `CounterState`       | Accumulator                             |

---

## 8. Constants

Each constant is exported from the file that manages it — import directly from the source file.

### Fragmentation Types

`import { FRAGMENTATION_NONE, FRAGMENTATION_PAGE, FRAGMENTATION_COLUMN, FRAGMENTATION_REGION } from "fragmentainers/src/fragmentation/constraint-space.js"`

Used in `ConstraintSpace.fragmentationType`.

| Constant               | Value      | Description              |
| ---------------------- | ---------- | ------------------------ |
| `FRAGMENTATION_NONE`   | `"none"`   | No fragmentation context |
| `FRAGMENTATION_PAGE`   | `"page"`   | Page fragmentation       |
| `FRAGMENTATION_COLUMN` | `"column"` | Column fragmentation     |
| `FRAGMENTATION_REGION` | `"region"` | Region fragmentation     |

### Inline Item Types

`import { INLINE_TEXT, INLINE_CONTROL, INLINE_OPEN_TAG, INLINE_CLOSE_TAG, INLINE_ATOMIC } from "fragmentainers/src/measurement/collect-inlines.js"`

Used in `InlineItemsData.items[].type`.

| Constant           | Value            | Description                               |
| ------------------ | ---------------- | ----------------------------------------- |
| `INLINE_TEXT`      | `"Text"`         | Text run                                  |
| `INLINE_CONTROL`   | `"Control"`      | Line break (`<br>`) or similar control    |
| `INLINE_OPEN_TAG`  | `"OpenTag"`      | Start of an inline element                |
| `INLINE_CLOSE_TAG` | `"CloseTag"`     | End of an inline element                  |
| `INLINE_ATOMIC`    | `"AtomicInline"` | Atomic inline (image, inline-block, etc.) |

### Break Token Types

`import { BREAK_TOKEN_BLOCK, BREAK_TOKEN_INLINE } from "fragmentainers/src/fragmentation/tokens.js"`

Used in `BreakToken.type`.

| Constant             | Value      | Description              |
| -------------------- | ---------- | ------------------------ |
| `BREAK_TOKEN_BLOCK`  | `"block"`  | Block-level break token  |
| `BREAK_TOKEN_INLINE` | `"inline"` | Inline-level break token |

### Box Decoration Break

`import { BOX_DECORATION_SLICE, BOX_DECORATION_CLONE } from "fragmentainers/src/layout/layout-node.js"`

Used in `node.boxDecorationBreak`.

| Constant               | Value     | Description                               |
| ---------------------- | --------- | ----------------------------------------- |
| `BOX_DECORATION_SLICE` | `"slice"` | Default: decorations are sliced at breaks |
| `BOX_DECORATION_CLONE` | `"clone"` | Decorations are cloned on each fragment   |

### Early Break Types

`import { EARLY_BREAK_BEFORE, EARLY_BREAK_INSIDE } from "fragmentainers/src/fragmentation/break-scoring.js"`

Used in `EarlyBreak.type`.

| Constant             | Value      | Description                  |
| -------------------- | ---------- | ---------------------------- |
| `EARLY_BREAK_BEFORE` | `"before"` | Break before the target node |
| `EARLY_BREAK_INSIDE` | `"inside"` | Break inside the target node |

### Algorithm Data Types

Each algorithm data type is defined in the file that uses it:

| Constant              | Value            | Import from                            |
| --------------------- | ---------------- | -------------------------------------- |
| `ALGORITHM_FLEX`      | `"FlexData"`     | `src/algorithms/flex-container.js`         |
| `ALGORITHM_FLEX_LINE` | `"FlexLineData"` | `src/algorithms/flex-container.js`         |
| `ALGORITHM_GRID`      | `"GridData"`     | `src/algorithms/grid-container.js`         |
| `ALGORITHM_TABLE_ROW` | `"TableRowData"` | `src/algorithms/table-row.js`              |
| `ALGORITHM_MULTICOL`  | `"MulticolData"` | `src/algorithms/multicol-container.js`     |

Used in `breakToken.algorithmData.type`.

### Overflow Threshold

`import { DEFAULT_OVERFLOW_THRESHOLD } from "fragmentainers/src/fragmentation/fragmentation-context.js"`

| Constant                     | Value               | Description                                                                                                    |
| ---------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_OVERFLOW_THRESHOLD` | `19.2` (`16 * 1.2`) | Default overflow threshold matching the browser default line height for `font-size: 16px; line-height: normal` |

### Named Page Sizes

`import { NAMED_SIZES, NAMED_SIZES_CSS } from "fragmentainers/src/resolvers/page-resolver.js"`

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

`NAMED_SIZES_CSS` provides the same set as `[value, unit]` pairs (e.g. `[210, "mm"]`) preserving original CSS units for subpixel-accurate rendering.

---

## 9. Layout Algorithms

All layout algorithms are classes with a `*layout()` generator method. The generator `yield`s `LayoutRequest` objects and receives child layout results. For detailed algorithm descriptions, see [layout-algorithms.md](layout-algorithms.md).

```js
import {
	BlockContainerAlgorithm,
	InlineContentAlgorithm,
	TableRowAlgorithm,
	MulticolAlgorithm,
	FlexAlgorithm,
	GridAlgorithm,
} from "fragmentainers/algorithms";
```

| Algorithm                 | Constructor                                                    | Source                             |
| ------------------------- | -------------------------------------------------------------- | ---------------------------------- |
| `BlockContainerAlgorithm` | `(node, constraintSpace, breakToken, earlyBreakTarget?)`       | `src/algorithms/block-container.js`    |
| `InlineContentAlgorithm`  | `(node, constraintSpace, breakToken)`                          | `src/algorithms/inline-content.js`     |
| `TableRowAlgorithm`       | `(node, constraintSpace, breakToken)`                          | `src/algorithms/table-row.js`          |
| `MulticolAlgorithm`       | `(node, constraintSpace, breakToken)`                          | `src/algorithms/multicol-container.js` |
| `FlexAlgorithm`           | `(node, constraintSpace, breakToken)`                          | `src/algorithms/flex-container.js`     |
| `GridAlgorithm`           | `(node, constraintSpace, breakToken)`                          | `src/algorithms/grid-container.js`     |

Each class's `*layout()` generator returns `{ fragment: Fragment, breakToken: BreakToken | null, earlyBreak?: EarlyBreak }` via its final `return` value. Only `BlockContainerAlgorithm` accepts the `earlyBreakTarget` parameter for two-pass break optimization.

### Dispatch Order

`getLayoutAlgorithm(node)` selects the algorithm by checking node properties in
this order:

1. `isMulticolContainer` -- `MulticolAlgorithm`
2. `isFlexContainer` -- `FlexAlgorithm`
3. `isGridContainer` -- `GridAlgorithm`
4. `isInlineFormattingContext` -- `InlineContentAlgorithm`
5. `isTableRow` -- `TableRowAlgorithm`
6. (default) -- `BlockContainerAlgorithm`

---

## 10. Layout Handlers

Layout handlers extend the engine with custom behaviors. See
[handlers.md](handlers.md) for the full guide on writing custom handlers.

### LayoutHandler (base class)

`import { LayoutHandler } from "fragmentainers"`

Base class for all layout handlers. Subclass and override methods as needed.

#### Properties

| Property  | Type     | Description                                                           |
| --------- | -------- | --------------------------------------------------------------------- |
| `options` | `Object` | Options passed from `FragmentedFlow` via the registry. Default: `{}`. |

#### Methods

| Method                                                           | Returns                                                 | Description                                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `claim(node)`                                                    | `boolean`                                               | Return `true` if this handler claims a child node (removes it from flow). Default: `false`.          |
| `resetRules()`                                                   | `void`                                                  | Reset state from a previous `matchRule` pass. Called before each CSS rule walk.                      |
| `matchRule(rule, context)`                                       | `void`                                                  | Inspect a CSS rule during the centralized rule walk. `context.wrappers` has grouping rule preambles. |
| `appendRules(rules)`                                             | `void`                                                  | Push CSS rule text strings into `rules[]` to inject into a shared stylesheet.                        |
| `claimPersistent(content)`                                       | `Element[]`                                             | Called before measurement. Return elements to include in every measurement segment.                  |
| `claimPseudo(element, pseudo, contentValue)`                     | `boolean`                                               | Claim a pseudo-element during materialization. Return `true` to prevent default handling.            |
| `claimPseudoRule(rule, pseudo)`                                  | `boolean`                                               | Claim a CSS pseudo-element rule. Return `true` to skip rewriting.                                    |
| `afterMeasurementSetup(contentRoot)`                             | `void`                                                  | Called after measurement DOM is set up. Handlers can probe live elements via `getComputedStyle`.     |
| `getAdoptedSheets()`                                             | `CSSStyleSheet[]`                                       | Return stylesheets to adopt on each fragment-container's shadow DOM.                                 |
| `layout(rootNode, constraintSpace, breakToken, layoutChild)`     | `{ reservedBlockStart, reservedBlockEnd, afterRender }` | Pre-layout hook. Called once per fragmentainer.                                                      |
| `beforeChildren(node, constraintSpace, breakToken)`              | `{ node, constraintSpace, isRepeated } \| null`         | Called before the child loop. Return a layout descriptor to prepend, or `null`.                      |
| `afterContentLayout(fragment, constraintSpace, inputBreakToken)` | `{ reservedBlockEnd, afterRender } \| null`             | Called after content layout. Return updated reservations to trigger re-layout.                       |

---

### handlers (registry)

`import { handlers } from "fragmentainers"`

Global `HandlerRegistry` instance. Built-in handlers are registered automatically
at import time.

#### Methods

| Method                                                           | Returns           | Description                                                               |
| ---------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------- |
| `register(handler)`                                              | `void`            | Register a handler instance                                               |
| `remove(handler)`                                                | `void`            | Unregister a handler                                                      |
| `setOptions(options)`                                            | `void`            | Pass options from `FragmentedFlow` to all handlers                        |
| `processRules(styles)`                                           | `void`            | Walk CSS rules, dispatch to `matchRule()`, collect `appendRules()` output |
| `claim(node)`                                                    | `boolean`         | Check if any registered handler claims this node                          |
| `claimPersistent(content)`                                       | `Element[]`       | Aggregate persistent elements from all handlers                           |
| `afterMeasurementSetup(contentRoot)`                             | `void`            | Let handlers probe the live measurement DOM                               |
| `getAdoptedSheets()`                                             | `CSSStyleSheet[]` | Collect stylesheets from handlers for fragment-containers                 |
| `layout(rootNode, constraintSpace, breakToken, layoutChild)`     | `object`          | Aggregate `layout()` results from all handlers                            |
| `beforeChildren(node, constraintSpace, breakToken)`              | `object \| null`  | First non-null `beforeChildren()` result                                  |
| `afterContentLayout(fragment, constraintSpace, inputBreakToken)` | `object \| null`  | Aggregate `afterContentLayout()` results                                  |

---

### Built-in Handlers

All built-in handlers are registered automatically. They can also be imported directly.

| Handler                  | Import                                                                                   | Description                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `PageFloat`              | `import { PageFloat } from "fragmentainers"`                                             | Page-relative floats via `--float-reference: page` and `--float: top\|bottom`                   |
| `PageFit`                | `import { PageFit } from "fragmentainers"`                                               | Full-page elements via `--page-fit: contain\|cover\|fill`                                       |
| `RepeatedTableHeader`    | `import { RepeatedTableHeader } from "fragmentainers"`                                   | Repeat `<thead>` on continuation pages                                                          |
| `FixedPosition`          | `import { FixedPosition } from "fragmentainers/src/handlers/fixed-position.js"`          | Repeat `position: fixed` elements on every page                                                 |
| `Footnote`               | `import { Footnote } from "fragmentainers/src/handlers/footnote.js"`                     | CSS footnotes (`float: footnote`) with iterative layout                                         |
| `NthSelectors`           | `import { NthSelectors } from "fragmentainers/src/handlers/nth-selectors.js"`            | Per-fragment nth-child/nth-of-type selector overrides                                           |
| `EmulatePrintPixelRatio` | `import { EmulatePrintPixelRatio } from "fragmentainers/src/handlers/normalize.js"`      | Line-height normalization for print-style flows (auto-enabled in Blink browsers; page-based only) |
| `BodyRewriter`           | `import { BodyRewriter } from "fragmentainers/src/handlers/body-rewriter.js"`            | Rewrites `body`/`html` selectors to `slot`/`:host` for shadow DOM (page-based only)             |
| `MutationSync`           | `import { MutationSync } from "fragmentainers"`                                          | Optional. Syncs mutations from fragment-container clones back to source elements                |

`FragmentedFlow` computes an `isPageBased` flag (`true` when a `PageResolver` is used or when neither `resolver` nor `constraintSpace` is supplied) and passes it to all handlers via `init()`. Handlers that only apply to print-style fragmentation (`EmulatePrintPixelRatio`, `BodyRewriter`) gate their behavior on this flag and no-op for column/region flows.

---

### FontMetrics

`import { getSharedFontMetrics } from "fragmentainers/src/measurement/font-metrics.js"`

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
