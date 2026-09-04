# API Reference

Complete API reference for `fragmentainers`.

## Package Exports

The top-level entry point exposes the main public API:

```js
import {
	Fragmenter,
	ConstraintSpace,
	PageResolver,
	RegionResolver,
	LayoutHandler,
} from "fragmentainers";
```

Additional package entry points expose the rest of the public API:

| Subpath | Exports |
| --- | --- |
| `fragmentainers/fragmentation.js` | `BreakToken`, `BlockBreakToken`, `InlineBreakToken`, `findChildBreakToken`, `Fragment`, `ConstraintSpace`, `FRAGMENTATION_*`, `EarlyBreak`, `BreakScore`, `Fragmenter`, `createFragments`, `FragmentFlow`, `FlowContext`, `CloneMap`, `FragmentationContext`, `CounterState`, `CounterSnapshot`, `parseCounterDirective`, `walkFragmentTree` |
| `fragmentainers/layout.js` | `LayoutRequest`, `createFragments`, `runLayoutGenerator`, `getLayoutAlgorithm`, `isMonolithic`, `getMonolithicBlockSize`, `buildCumulativeHeights`, `LayoutNode`, `DOMLayoutNode`, `AnonymousBlockNode`, `FlowThreadNode` |
| `fragmentainers/algorithms.js` | `BlockContainerAlgorithm`, `FlexAlgorithm`, `GridAlgorithm`, `InlineContentAlgorithm`, `MulticolAlgorithm`, `TableRowAlgorithm`, `resolveColumnDimensions` |
| `fragmentainers/resolvers.js` | `PageResolver`, `PageRule`, `RegionResolver`, `RegionConstraints` |
| `fragmentainers/components.js` | `ContentMeasureElement`, `FragmentContainerElement` |
| `fragmentainers/styles.js` | `computedStyleMap`, `parseNumeric`, `toPx` |
| `fragmentainers/handlers.js` | `LayoutHandler`, `HandlerRegistry`, `resolveHandlerClasses`, `defaultHandlers`, `RepeatedTableHeader`, `FixedPosition`, `StyleResolver`, `EmulatePrintPixelRatio`, `BodyRewriter`, `PseudoElements`, `PageFloat`, `MutationSync`, `markPersistent`, `markNativePseudo` |

---

## Table of Contents

1. [Primary API](#1-primary-api)
2. [Lower-Level Layout API](#2-lower-level-layout-api)
3. [Break Tokens](#3-break-tokens)
4. [Break Scoring](#4-break-scoring)
5. [Fragmentation (Fragment)](#5-fragmentation-fragment)
6. [Custom Elements](#6-custom-elements)
7. [Helpers](#7-helpers)
8. [Constants](#8-constants)
9. [Layout Algorithms](#9-layout-algorithms)
10. [Layout Handlers](#10-layout-handlers)

---

## 1. Primary API

### Fragmenter

`import { Fragmenter } from "fragmentainers"`

High-level coordinator for the content-to-fragmentation pipeline. Accepts a
`DocumentFragment`, `Element`, or mock node. Internally creates a
`<content-measure>` element for DOM measurement, builds the layout tree,
runs fragmentation, and returns a `FragmentationContext`.

```js
// DocumentFragment input with stylesheets — iterate directly
const template = document.createElement("template");
template.innerHTML = htmlContent;
const flow = new Fragmenter(template.content, { styles: [sheet] });
for (const el of flow) {
	document.body.appendChild(el);
}

// Element input (cloned internally) — use flow() for partial ranges
const layout = new Fragmenter(document.getElementById("content"), {
	width: 600,
	height: 800,
});
const context = layout.flow({ start: 0, stop: 5 });

// Region mode — iterator fills regions
const resolver = new RegionResolver([...regionEls]);
const flow = new Fragmenter(content, { resolver });
let i = 0;
for (const el of flow) {
	if (i >= regionEls.length) break;
	regionEls[i++].appendChild(el);
}
flow.destroy();
```

#### Constructor

```js
new Fragmenter(content, options?)
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
| `options.devicePixelRatio`    | `number`                                    | Target DPR for line-height rounding (defaults to `window.devicePixelRatio`)                                                               |
| `options.emulatePrintPixelRatio` | `boolean`                                 | Normalize screen line-height to match DPR-1 print layout where supported (default: `true`)                                                |
| `options.styleSheet`          | `CSSStyleSheet`                             | Sheet to write the composite scoped rules into. The caller adopts it where needed (`document` or any `ShadowRoot`). When omitted, the flow creates its own sheet and adopts it on `document.adoptedStyleSheets`. |
| `options.continuation`        | `{ fragmentainerIndex, blockOffset }`       | Resume point handed over by a previous flow: the fragmentainer index to number from, and the block offset already consumed within it. Read the outgoing one back off the `continuation` getter. |

Options are checked in priority order: `constraintSpace` > `resolver` > `width`/`height` > auto-create `PageResolver` from `@page` rules in styles.

#### Methods

| Method                         | Returns                | Description                                                                                                                                                                                                 |
| ------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `next()`                       | `{ value, done }`      | Iterator protocol — lay out the next fragmentainer, return its `<fragment-container>` element. Returns `{ done: true }` when all content is placed. A flow over a `LayoutNode` tree composes nothing, so `value` is `undefined`; use `flow()` and read `.fragments`. |
| `flow({ start, stop }?)`       | `FragmentationContext` | Run all fragmentainers to completion. `start`/`stop` control which elements are created (layout always runs to completion).                                                                                 |
| `layout(forceUpdate?)`         | `void`                 | Initialize the layout tree and internal measurement container. Called lazily by `next()`. Pass `true` to force re-initialization.                                                                           |
| `preload(options?)`            | `Promise<void>`        | Optional — preload fonts and images before layout for accurate measurement. Accepts `{ signal, timeout }` (default timeout 10s; pass `0` to disable).                                                       |
| `preloadFonts(options?)`       | `Promise<string[]>`    | Register `@font-face` rules from the content styles and wait for unloaded faces used by those styles. Accepts the same preload options.                                                                    |
| `preloadImages(options?)`      | `Promise<void[]>`      | Load images without explicit dimensions, fill in their natural dimensions, and remove images that fail to load. Accepts the same preload options.                                                         |
| `reflow(fromIndex?, options?)` | `FragmentationContext` | Re-layout from a specific fragmentainer index. Returns a new `FragmentationContext` with the reflowed fragments. Pass `{ rebuild: true }` after structural DOM changes to force layout tree reconstruction. |
| `return(value?)`               | `{ value, done: true }` | Iterator cleanup used when iteration stops early. Releases measurement without marking the flow exhausted, so later iteration can resume.                                                                 |
| `releaseMeasurer()`            | `void`                 | Detach the measurement element and preserve the source DOM for later reflow. Called automatically on completion and early iterator exit.                                                                  |
| `destroy()`                    | `void`                 | Remove the internal `<content-measure>` element from the DOM and destroy this flow's handler instances. Call when the layout is no longer needed.                                                           |

#### Properties

| Property                       | Type                   | Description                                                                                                                                                                                                 |
| ------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Fragmenter.handlers`      | `Class[]` (static)     | The ordered catalog of handler classes every flow instantiates. Append to add; append a subclass of a listed class to override it. See [handlers](#fragmenterhandlers-catalog-and-flowhandlers-registry). |
| `handlers`                     | `HandlerRegistry`      | This flow's handler instances (`flow.handlers.get(Cls)`).                                                                                                                                                    |
| `continuation`                 | `{ fragmentainerIndex, blockOffset }` | The resume point for a flow picking up where this one stopped. Rolls to the next index when the last fragment filled its fragmentainer.                                                       |
| `contentRoot`                  | `Element \| DocumentFragment \| LayoutNode` | Live measurement root while attached; otherwise the preserved detached source content (or pre-built layout tree).                                                             |

---

### FragmentationContext

`import { FragmentationContext } from "fragmentainers/fragmentation.js"`

**Source:** `src/fragmentation/fragmentation-context.js`

Result of running fragmentation -- a "fragmented flow" in CSS spec terms.
Extends `Array`, so context instances are directly iterable: `context[0]` gives
the first element, `context.length` gives the composed count, and `for...of`
iterates the elements. Elements are created eagerly during `flow()`.

#### Constructor

```js
new FragmentationContext(fragments, contentStyles, { start, stop, previous });
```

| Parameter       | Type                                                                         | Description                                    |
| --------------- | ---------------------------------------------------------------------------- | ---------------------------------------------- |
| `fragments`     | `Fragment[]`                                                         | Array of root fragments, one per fragmentainer |
| `contentStyles` | `{ sheets: CSSStyleSheet[] } \| null`                                | Stylesheet snapshot from the measurer (used for composition) |
| `range.start`   | `number`                                                               | First fragment index to compose (default: `0`)                |
| `range.stop`    | `number`                                                               | Exclusive fragment index to compose (default: all)            |
| `range.previous` | `Fragment \| null`                                                   | Fragment immediately before this context; preserves split state and counters for a reflowed suffix |

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

`import { PageResolver } from "fragmentainers"`

Resolves page dimensions per-page by implementing `@page` rule matching and
cascade. Implements the CSS Paged Media `[f, g, h]` specificity tuple: page
type names contribute to `f`, `:first` / `:blank` / `:nth()` to `g`, and
`:left` / `:right` to `h`.

#### Constructor

```js
new PageResolver(rules, size);
```

| Parameter | Type                                        | Description                                                                    |
| --------- | ------------------------------------------- | ------------------------------------------------------------------------------ |
| `rules`   | `(PageRule \| object)[]`                    | `@page` rules in document order. Plain objects are passed to the `PageRule` constructor. |
| `size`    | `{ inlineSize: number, blockSize: number }` | Fallback page size                                                             |

Plain objects use the same shape as `PageRule`:

```js
{
  name: string | null,
  pseudo: string[],                                          // 'first', 'left', 'right', 'blank'
  nth: { a: number, b: number } | null,                     // :nth(An+B) coefficients
  size: string | null,                                       // CSS size value ("A4", "210mm 297mm", ...)
  margin: { top, right, bottom, left } | null,               // CSS lengths ("10mm", "1in", ...)
  pageOrientation: string | null,                            // 'rotate-left', 'rotate-right'
}
```

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

`import { PageRule } from "fragmentainers/resolvers.js"`

Parsed representation of a CSS `@page` rule.

#### Constructor

```js
new PageRule({ name, pseudo, nth, size, margin, padding, border, pageOrientation });
```

| Property          | Type                                   | Description                                                       |
| ----------------- | -------------------------------------- | ----------------------------------------------------------------- |
| `name`            | `string \| null`                       | Named page type (`"chapter"`, `"cover"`), or `null` for universal |
| `pseudo`          | `string[]`                             | Any combination of `"first"`, `"left"`, `"right"`, `"blank"`      |
| `nth`             | `{ a: number, b: number } \| null`     | Coefficients from `:nth(<An+B>)`, matched against the 1-based page index |
| `size`            | `string \| null`                       | Raw CSS size value such as `"A4"` or `"210mm 297mm"`             |
| `margin`          | `{ top, right, bottom, left } \| null` | Raw CSS length strings for each margin side                        |
| `padding`         | `{ top, right, bottom, left } \| null` | Raw CSS length strings for each padding side                       |
| `border`          | `{ top, right, bottom, left } \| null` | Per-side `width`, `style`, and `color` declarations                |
| `pageOrientation` | `string \| null`                       | `"rotate-left"`, `"rotate-right"`, or `null`                      |

---

### PageConstraints

**Source:** `src/resolvers/page-resolver.js`

Resolved page dimensions for one page -- the fragmentainer definition.

#### Constructor

```js
new PageConstraints({ pageIndex, namedPage, pageBoxSize, margins, padding, borderWidths, contentArea, isFirst, isVerso, isRecto, isBlank?, matchedRules? })
```

| Property      | Type                                        | Description                                                                        |
| ------------- | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `pageIndex`   | `number`                                    | Zero-based page number                                                             |
| `namedPage`   | `string \| null`                            | CSS `page` property value                                                          |
| `pageBoxSize` | `{ inlineSize: number, blockSize: number }` | Full page dimensions                                                               |
| `margins`     | `{ top, right, bottom, left }`              | Resolved margins in CSS px                                                         |
| `padding`     | `{ top, right, bottom, left }`              | Resolved page padding in CSS px                                                    |
| `borderWidths` | `{ top, right, bottom, left }`             | Used page border widths in CSS px                                                  |
| `contentArea` | `{ inlineSize: number, blockSize: number }` | The fragmentainer (page box minus margins, borders, and padding)                   |
| `isFirst`     | `boolean`                                   | Whether this is the first page                                                     |
| `isVerso`     | `boolean`                                   | Whether this is a verso (left) page                                                |
| `isRecto`     | `boolean`                                   | Whether this is a recto (right) page                                               |
| `isBlank`     | `boolean`                                   | Whether this is a blank page inserted for a side-specific break (default: `false`) |
| `matchedRules` | `PageRule[]`                               | Page rules that matched this page (default: `[]`)                                  |

#### Methods

| Method                | Returns           | Description                                                      |
| --------------------- | ----------------- | ---------------------------------------------------------------- |
| `toConstraintSpace()` | `ConstraintSpace` | Build a `ConstraintSpace` for layout from these page constraints |

---

### parsePageRulesFromCSS(cssTexts)

**Source:** `src/resolvers/page-resolver.js`

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

`import { RegionConstraints } from "fragmentainers/resolvers.js"`

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

`import { parseNumeric } from "fragmentainers/styles.js"`

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

**Source:** `src/styles/css-values.js`

Construct a CSS numeric value. Returns a native `CSSUnitValue` when available,
otherwise a `UnitValue` polyfill with the same `.value`, `.unit`, `.to()`,
`.add()`, `.sub()` shape.

### UnitValue

**Source:** `src/styles/css-values.js`

Polyfill for `CSSUnitValue` used when native CSS Typed OM is unavailable.
Provides a subset of the Typed OM arithmetic/conversion interface.

| Method / Property | Returns     | Description                                                |
| ----------------- | ----------- | ---------------------------------------------------------- |
| `value`           | `number`    | Numeric component                                          |
| `unit`            | `string`    | Unit name (e.g. `"px"`, `"mm"`, `"em"`, `"percent"`)       |
| `to(unit)`        | `UnitValue` | Convert to target unit (physical units; throws otherwise)  |
| `add(other)`      | `UnitValue` | Add another value; converts to px when units differ        |
| `sub(other)`      | `UnitValue` | Subtract another value; converts to px when units differ   |

### toPx(value, options?)

`import { toPx } from "fragmentainers/styles.js"`

Convert a CSS length to CSS pixels. Accepts a string, native Typed OM value,
or `UnitValue`; returns `null` for unsupported or unresolved values.

| Parameter                  | Type             | Description                                      |
| -------------------------- | ---------------- | ------------------------------------------------ |
| `value`                    | `string \| object` | CSS length to resolve                           |
| `options.rootFontSize`     | `number`         | Root font size used for `rem` (default: `16`)    |
| `options.percentBase`      | `number \| null` | Reference size used for percentages              |

**Returns:** `number | null`

### computedStyleMap(element)

`import { computedStyleMap } from "fragmentainers/styles.js"`

Polyfill for `element.computedStyleMap()` — returns a map whose `.get(property)`
yields a `UnitValue` (numeric) or `{ value: keyword }` (keyword). Uses native
Typed OM when available.

### walkRules, walkSheets, insertWrappedRule

**Source:** `src/styles/walk-rules.js`

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

`import { createFragments } from "fragmentainers/fragmentation.js"`

**Source:** `src/fragmentation/create-fragments.js`

Batch entry point for fragmenting an already-built layout tree. Wraps the tree
in a `Fragmenter`, runs it to completion, and returns the fragments. The
tree is already measured, so no measurement container is created; nothing is
composed, so no `<fragment-container>` elements are produced. Callers that want
elements build them with `fragment.build(prevBreakToken)`.

```js
// Simple: single constraint space, returns flat array
const fragments = createFragments(tree, constraintSpace);

// With resolver: per-fragmentainer resolution
const fragments = createFragments(tree, pageResolver);

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

`import { runLayoutGenerator } from "fragmentainers/layout.js"`

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

`import { getLayoutAlgorithm } from "fragmentainers/layout.js"`

**Source:** `src/layout/layout-driver.js`

Dispatch to the correct layout algorithm class based on node type. Checked in order:
`isMulticolContainer` → `isFlexContainer` → `isGridContainer` →
`isInlineNode` → `isTableRow` → `BlockContainerAlgorithm` (default).

Every element is a block container. A block whose children are inline-level
holds one anonymous inline node (CSS 2.1 §9.2.1.1) as its only child; the
inline node is what `InlineContentAlgorithm` lays out, line by line, while
the element's own box — block-size, decorations, breaks inside the box — is
`BlockContainerAlgorithm`'s.

| Parameter | Type         | Description            |
| --------- | ------------ | ---------------------- |
| `node`    | `LayoutNode` | Layout node to inspect |

**Returns:** An algorithm **class** constructor. Instantiate with
`new Algo(node, constraintSpace, breakToken, earlyBreakTarget?)` and pass the
instance to `runLayoutGenerator`. Container algorithms forward an early-break
target to descendants; `InlineContentAlgorithm` uses only the first three
arguments.

---

### DOMLayoutNode(element)

`import { DOMLayoutNode } from "fragmentainers/layout.js"`

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

`import { DOMLayoutNode } from "fragmentainers/layout.js"`

Lazy wrapper around real DOM elements implementing the `LayoutNode` interface.
Read-only -- no DOM mutation. Block sizes measured via `getBoundingClientRect`.
Computed styles cached on first access, children wrapped lazily.

`invalidateStructure()` clears structure-dependent child and measurement
caches without replacing the wrapper. Segmented measurement uses it after a
newly activated boundary element passes through handler DOM mutations, so
existing break tokens keep a stable node identity.

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
	reservedBlockStart,
	reservedBlockEnd,
	cssInlineSize,
	cssBlockSize,
	fragmentainerContentStart,
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
| `reservedBlockStart`         | `number`  | `0`      | Space reserved at the fragmentainer block start by handlers               |
| `reservedBlockEnd`           | `number`  | `0`      | Space reserved at the fragmentainer block end by handlers                 |
| `cssInlineSize`              | `string \| null` | `null` | Original CSS inline-size string used for browser-native unit conversion   |
| `cssBlockSize`               | `string \| null` | `null` | Original CSS block-size string used for browser-native unit conversion    |
| `fragmentainerContentStart`  | `number`  | `0`      | Earliest content position, used to avoid repeatedly pushing an unfit child |

---

### MarginState

**Source:** `src/layout/margin-collapsing.js`

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
| `applyAfterLayout(child, collapsedThrough, isResumingChild, childBroke?, context?)` | `number` | Update state after child layout, including through- and self-collapse compensation |
| `trailingMargin(hasBreak, hasChildren, isForcedBreak?)`      | `number` | Deferred last-child margin-end; forced breaks preserve adjoining margins |
| `shouldTruncateLastChildMarginEnd(hasBreak, isForcedBreak?)` | `boolean` | Whether an unforced break truncates the last child's end margin           |
| `shouldTruncateChildMarginStart(params)`                     | `boolean` | Whether an unforced continuation truncates its first child's start margin |

Uses `MarginStrut` internally: positive margins take `max`, negative margins take `min`, mixed margins sum `max(positives) + min(negatives)`.

---

### Fragment

`import { Fragment } from "fragmentainers/fragmentation.js"`

Layout output. Represents a laid-out box or line within a single
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
| `multicolData`   | `object \| null`          | `null`  | Multicol layout data (`{ columnWidth, columnGap, columnCount, columnHeight }`) |
| `isRepeated`     | `boolean`                 | `false` | Repeated content (e.g. table thead across pages)                             |
| `isBlank`        | `boolean`                 | `false` | Blank page inserted for side-specific break (`left`/`right`/`recto`/`verso`) |
| `counterState`   | `CounterSnapshot \| null` | `null`  | Counter snapshot for this fragmentainer                                      |
| `afterRender`    | `Function[] \| null`      | `null`  | Composition callbacks contributed by handlers and parallel flows              |
| `isFirst` / `isLast` | `boolean`              | `false` | Document-boundary markers copied to fragment-container attributes              |
| `blockOffset`    | `number`                   | `0`     | Block position within the parent fragment                                      |
| `needsBlockClip` | `boolean`                  | `false` | Render this fragment as a clipped slice                                         |
| `hasFixedBlockSize` | `boolean`               | `false` | Fragment belongs to a box with a specified/clamped block-size                   |

---

### LayoutRequest

`import { LayoutRequest } from "fragmentainers/layout.js"`

**Source:** `src/layout/layout-request.js`

Yielded from an algorithm's `*layout()` generator to the driver. Represents a
request to lay out a child node.

```js
// Inside an algorithm's *layout() method:
const result = yield new LayoutRequest(childNode, childConstraintSpace, childBreakToken);
```

#### Constructor

```js
new LayoutRequest(node, constraintSpace, breakToken?, earlyBreakTarget?)
```

| Property          | Type                 | Description                          |
| ----------------- | -------------------- | ------------------------------------ |
| `node`            | `LayoutNode`         | Child node to lay out                |
| `constraintSpace` | `ConstraintSpace`    | Layout input for the child           |
| `breakToken`      | `BreakToken \| null` | Continuation token (default: `null`) |
| `earlyBreakTarget` | `EarlyBreak \| null` | Pass-2 target forwarded to the child (default: `null`) |

---

## 3. Break Tokens

Break tokens are continuation tokens that form a sparse tree mirroring the CSS
box tree. When content overflows a fragmentainer, a break token captures enough
state to resume layout in the next fragmentainer.

See [browser-engine-reference.md](browser-engine-reference.md) for W3C
mappings and architectural details.

### BreakToken (base class)

`import { BreakToken } from "fragmentainers/fragmentation.js"`

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

---

### BlockBreakToken

`import { BlockBreakToken } from "fragmentainers/fragmentation.js"`

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
| `continuesInFlow`   | `boolean`        | getter  | The box's own in-flow extent still continues             |
| `continuesAsOverflow` | `boolean`      | getter  | The box reached its block end but descendants continue as parallel overflow |
| `isComplete`        | `boolean`        | getter  | The subtree finished earlier and only its parallel-flow track shell remains  |

#### Static Methods

| Method                                                                                      | Returns           | Description                                                                                                               |
| ------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `BlockBreakToken.createBreakBefore(node, isForcedBreak?, forcedBreakValue?)`                | `BlockBreakToken` | Create a break-before token. `forcedBreakValue` stores the CSS value (e.g. `"left"`, `"right"`) for side-specific breaks. |
| `BlockBreakToken.createRepeated(node, sequenceNumber)`                                      | `BlockBreakToken` | Create a repeated-fragment token                                                                                          |
| `BlockBreakToken.createForBreakInRepeatedFragment(node, sequenceNumber, consumedBlockSize)` | `BlockBreakToken` | Create a token for a break inside a repeated fragment                                                                     |

---

### InlineBreakToken

`import { InlineBreakToken } from "fragmentainers/fragmentation.js"`

Extends `BreakToken` with `type = BREAK_TOKEN_INLINE`. Content-addressed via
item index and text offset into `InlineItemsData` -- survives inline-size
changes between fragmentainers.

```js
new InlineBreakToken(node);
```

| Property                      | Type      | Default    | Description                                                                                     |
| ----------------------------- | --------- | ---------- | ----------------------------------------------------------------------------------------------- |
| `itemIndex`                   | `number`  | `0`        | Index into `InlineItemsData.items`                                                              |
| `textOffset`                  | `number`  | `0`        | Character offset into `InlineItemsData.textContent`                                             |
| `flags`                       | `number`  | `0`        | Bitfield for internal state                                                                     |
| `isHyphenated`                | `boolean` | `false`    | Break is mid-word; render layer appends `hyphenateCharacter` to page N's last text node         |
| `hyphenateCharacter`          | `string`  | `"\u2010"` | Glyph appended when `isHyphenated` is true (resolved from the containing item's `hyphenate-character`) |
| `hasTrailingCollapsibleSpace` | `boolean` | `false`    | Trim one trailing space from page N's last text node at render time (CSS Text §4.1.1)           |

---

## 4. Break Scoring

The engine uses a two-pass break scoring system. Pass 1 discovers the optimal
breakpoint (tracking `EarlyBreak` chains); if the actual break is worse, Pass 2
re-runs layout to break at that point.

### EarlyBreak

`import { EarlyBreak } from "fragmentainers/fragmentation.js"`

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

`import { BreakScore } from "fragmentainers/fragmentation.js"`

Score constants for break quality ranking. Lower values are better.

| Constant                              | Value | Meaning                              |
| ------------------------------------- | ----- | ------------------------------------ |
| `BreakScore.PERFECT`                  | `0`   | Ideal break (Class A, no violations) |
| `BreakScore.VIOLATING_ORPHANS_WIDOWS` | `1`   | Violates orphans/widows              |
| `BreakScore.VIOLATING_BREAK_AVOID`    | `2`   | Violates `break-inside: avoid`       |
| `BreakScore.LAST_RESORT`              | `3`   | No better option exists              |

---

## 5. Fragmentation (Fragment)

The `Fragment` class converts the fragment tree into visible DOM.
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

During `build()`, every clone is registered in the flow's `CloneMap`; handlers
such as `MutationSync` can therefore resolve composed elements back to their
sources without a separate mapping pass.

### Fragment.buildInlineContent(items, textContent, startOffset, endOffset, container, options?)

Static method. Reconstructs DOM from the flat `InlineItemsData` list within
break token offset ranges.

| Parameter                     | Type           | Description                                                                                                    |
| ----------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| `items`                       | `InlineItem[]` | Flat inline item array                                                                                         |
| `textContent`                 | `string`       | Full text content string                                                                                       |
| `startOffset`                 | `number`       | Start character offset                                                                                         |
| `endOffset`                   | `number`       | End character offset                                                                                           |
| `container`                   | `Element`      | Target container element                                                                                       |
| `options.collapseWS`                  | `boolean`      | Collapse whitespace runs inside each text slice (default `false`)                                              |
| `options.pseudoContext`               | `object\|null` | `{ isContinuation, willContinue }` — suppress `::before` on continuations and `::after` on non-last fragments  |
| `options.hasTrailingCollapsibleSpace` | `boolean`      | Trim one trailing space from the last rendered text node (default `false`); set by the inline layout algorithm |
| `options.isHyphenated`                | `boolean`      | Append `hyphenateCharacter` to the last rendered text node (default `false`); stripping a trailing U+00AD first |
| `options.hyphenateCharacter`          | `string`       | Glyph appended when `isHyphenated` is true (default `"\u2010"`)                                                |

### Fragment.hasBlockChildren

Getter. Returns `true` if this fragment has block-level child fragments (not
line fragments). Line fragments have `node === null`.

---

## 6. Custom Elements

The two custom elements live under `src/components/`. They are auto-registered on import via `customElements.define()`.

### ContentMeasureElement (`<content-measure>`)

`import { ContentMeasureElement } from "fragmentainers/components.js"`

**Source:** `src/components/content-measure.js`

Off-screen measurement container with Shadow DOM. Injects content and CSS into a
shadow root so the host page's styles do not affect layout measurements.

Managed internally by `Fragmenter`.

#### Methods

| Method                                  | Returns                       | Description                                                               |
| --------------------------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| `injectFragment(fragment, styles?)`     | `Element`                     | Inject a `DocumentFragment` with `CSSStyleSheet[]`; returns `contentRoot` |
| `setupEmpty(styles?)`                   | `Element`                     | Set up stylesheets and clear content; returns `contentRoot`               |
| `applyConstraintSpace(constraintSpace)` | `void`                        | Sync inline size; the next geometry read lays out at it                   |
| `getContentStyles()`                    | `{ sheets: CSSStyleSheet[] }` | Get adopted stylesheets for composition                                   |

#### Properties

| Property      | Type                       | Description                             |
| ------------- | -------------------------- | --------------------------------------- |
| `contentRoot` | `Element \| null` | The slot element inside the shadow root |

---

### FragmentContainerElement (`<fragment-container>`)

`import { FragmentContainerElement } from "fragmentainers/components.js"`

**Source:** `src/components/fragment-container.js`

Visible page container. Hosts composed fragment output as light-DOM
children, projected through a `<slot>` in a thin shadow scaffold. The host
uses `overflow: clip` and `contain: size style`. CSS isolation comes from
the engine's `@scope (fragment-container)`-wrapped composite sheet, not
from per-instance shadow adoption.

#### Methods

| Method                                                | Returns            | Description                                                                                                                |
| ----------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `startObserving()`                                    | `void`             | Attach `ResizeObserver` on the slot and `MutationObserver` on the host. Deferred via `requestAnimationFrame`.              |
| `stopObserving()`                                     | `void`             | Disconnect all observers.                                                                                                  |
| `takeMutationRecords()`                               | `MutationRecord[]` | Return and drain all buffered mutation records.                                                                            |

#### Properties

| Property            | Type              | Description                                                                                   |
| ------------------- | ----------------- | --------------------------------------------------------------------------------------------- |
| `fragmentIndex`     | `number`          | Zero-based index of this fragmentainer. Setter mirrors to `data-fragment` attribute.          |
| `namedPage`         | `string \| null`  | CSS named page type for this fragment (from `PageConstraints.namedPage`). Setter mirrors to `data-page-name` attribute. |
| `constraints`       | `PageConstraints \| RegionConstraints \| { contentArea } \| null` | Resolver output / fragmentainer geometry for this fragment.   |
| `expectedBlockSize` | `number` (setter) | Set the expected block size from layout. Used by the overflow detector.                       |
| `overflowThreshold` | `number` (setter) | Minimum delta in px before `overflow` fires. `FragmentationContext` sets the last inline line-height or `DEFAULT_OVERFLOW_THRESHOLD`; a standalone element starts at `0`. |

#### Events

| Event             | Detail                                                      | Description                                                                                                   |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `fragment-change` | `{ index: number }`                                         | Fired when content inside the fragment changes (coalesced via `queueMicrotask`)                               |
| `overflow`        | `{ index, expectedBlockSize, renderedBlockSize, overflow }` | Fired when rendered content height exceeds the layout-computed expected size by more than `overflowThreshold` |

---

## 7. Helpers

### findChildBreakToken(parentBreakToken, childNode, taken?)

`import { findChildBreakToken } from "fragmentainers/fragmentation.js"`

Find a child's break token within a parent's break token by matching the
`node` reference.

| Parameter          | Type                      | Description        |
| ------------------ | ------------------------- | ------------------ |
| `parentBreakToken` | `BlockBreakToken \| null` | Parent break token |
| `childNode`        | `LayoutNode`              | Child node to find |
| `taken`            | `Set<BreakToken> \| null` | Matches already consumed when anonymous siblings share a node |

**Returns:** `BreakToken | null`

### isMonolithic(node)

`import { isMonolithic } from "fragmentainers/layout.js"`

Check if a node is monolithic (cannot be fragmented). True for replaced
elements, scrollable elements, and elements with `overflow: hidden` plus an
explicit block size.

**Returns:** `boolean`

### getMonolithicBlockSize(node, constraintSpace)

`import { getMonolithicBlockSize } from "fragmentainers/layout.js"`

Get the block size of a monolithic element without full layout.

| Parameter         | Type              | Description              |
| ----------------- | ----------------- | ------------------------ |
| `node`            | `LayoutNode`      | Monolithic node          |
| `constraintSpace` | `ConstraintSpace` | Current constraint space |

**Returns:** `number`

### isForcedBreakValue(value)

**Source:** `src/fragmentation/tokens.js`

Check if a CSS `break-before`/`break-after` value is a forced break. Returns
`true` for `"page"`, `"column"`, `"always"`, `"left"`, `"right"`, `"recto"`, `"verso"`.

**Returns:** `boolean`

### isSideSpecificBreak(value)

**Source:** `src/resolvers/page-resolver.js`

Check if a CSS break value requires a specific page side. Returns `true` for
`"left"`, `"right"`, `"recto"`, `"verso"`.

**Returns:** `boolean`

### requiredPageSide(value)

**Source:** `src/resolvers/page-resolver.js`

Return the required page side for a side-specific break value. Normalizes
`recto` to `"right"` and `verso` to `"left"`.

**Returns:** `"left" | "right" | null`

### resolveForcedBreakValue(breakToken)

**Source:** `src/resolvers/page-resolver.js`

Walk the break token tree to find the `forcedBreakValue` that triggered the
break.

**Returns:** `string | null`

### resolveNextPageBreakBefore(rootNode, breakToken)

**Source:** `src/resolvers/page-resolver.js`

Resolve the `break-before` CSS value of the first child that will appear on
the next page. Used to detect side-specific breaks when `blockOffset === 0`
prevented the forced break from firing in `BlockContainerAlgorithm`.

**Returns:** `string | null`

### resolveColumnDimensions(U, specifiedWidth, specifiedCount, gap)

`import { resolveColumnDimensions } from "fragmentainers/algorithms.js"`

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

`import { MutationSync } from "fragmentainers/handlers.js"`

Applies mutations observed on rendered clones back to the source DOM. The
handler receives the flow's clone-to-source `CloneMap` through `init()`.

#### Constructor

```js
Fragmenter.handlers.push(MutationSync);
const flow = new Fragmenter(content, options);
const sync = flow.handlers.get(MutationSync);
```

#### Methods

| Method                      | Returns                                     | Description                                                                                       |
| --------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `applyMutations(mutations)` | `{ changed: boolean, structural: boolean }` | Apply mutation records to the source DOM. `structural` is true if elements were added or removed. |

---

### CounterState

`import { CounterState } from "fragmentainers/fragmentation.js"`

Scoped counter accumulator. Each counter name owns an outer-to-inner stack of
instances, keyed by the element whose child scope created them, so sibling
resets replace one another while descendant resets nest.

#### Methods

| Method                           | Returns           | Description                                            |
| -------------------------------- | ----------------- | ------------------------------------------------------ |
| `applyReset(entries, scope)`     | `void`            | Apply `counter-reset` directives                       |
| `applySet(entries, scope)`       | `void`            | Apply `counter-set` directives                         |
| `applyIncrement(entries, scope)` | `void`            | Apply `counter-increment` directives                   |
| `value(name)`                    | `number`          | Innermost value, or zero                               |
| `values(name)`                   | `number[]`        | Frozen outer-to-inner value stack                      |
| `closeScope(scope)`              | `void`            | Drop instances created by a completed scope            |
| `prepareForElement(el)`          | `void`            | Drop instances whose DOM scope does not contain `el`   |
| `snapshot()`                     | `CounterSnapshot` | Capture the scoped stacks for a fragmentainer boundary |
| `restore(snapshot)`              | `void`            | Replace all state from a `CounterSnapshot`, or `null`  |
| `isEmpty()`                      | `boolean`         | True if no counters have been tracked                  |

### CounterSnapshot

`import { CounterSnapshot } from "fragmentainers/fragmentation.js"`

Immutable scoped counter values captured at a fragmentainer boundary, produced
by `CounterState.snapshot()` and stored on `Fragment.counterState`.

| Property / Method | Type                                           | Description                                            |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------ |
| `values`          | `Readonly<Record<string, number>>`             | Innermost value per counter name (seeds `counter-set`) |
| `frames`          | `Map<string, ReadonlyArray<{ value, scope }>>` | Outer-to-inner stacks, with their scope identities     |
| `value(name)`     | `number`                                       | Innermost value, or zero                               |
| `stack(name)`     | `number[]`                                     | Outer-to-inner values                                  |

Scopes are object references, so a structural copy (spread, `structuredClone`,
serialization) cannot carry them: `CounterState.restore` throws a `TypeError` on
anything but a `CounterSnapshot` instance.

### parseCounterDirective(value)

`import { parseCounterDirective } from "fragmentainers/fragmentation.js"`

Parse a CSS counter directive string into an array of `{ name, value }` entries.

| Parameter | Type             | Description                                         |
| --------- | ---------------- | --------------------------------------------------- |
| `value`   | `string \| null` | CSS computed value (e.g. `"paragraph 0 section 0"`) |

**Returns:** `{ name: string, value: number }[]`

### walkFragmentTree(fragment, inputBreakToken, counterState)

`import { walkFragmentTree } from "fragmentainers/fragmentation.js"`

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

### Fragmentation Types

`import { FRAGMENTATION_NONE, FRAGMENTATION_PAGE, FRAGMENTATION_COLUMN, FRAGMENTATION_REGION } from "fragmentainers/fragmentation.js"`

Used in `ConstraintSpace.fragmentationType`.

| Constant               | Value      | Description              |
| ---------------------- | ---------- | ------------------------ |
| `FRAGMENTATION_NONE`   | `"none"`   | No fragmentation context |
| `FRAGMENTATION_PAGE`   | `"page"`   | Page fragmentation       |
| `FRAGMENTATION_COLUMN` | `"column"` | Column fragmentation     |
| `FRAGMENTATION_REGION` | `"region"` | Region fragmentation     |

### Inline Item Types

**Source:** `src/measurement/collect-inlines.js`

Used in `InlineItemsData.items[].type`.

| Constant           | Value            | Description                               |
| ------------------ | ---------------- | ----------------------------------------- |
| `INLINE_TEXT`      | `"Text"`         | Text run                                  |
| `INLINE_CONTROL`   | `"Control"`      | Line break (`<br>`) or similar control    |
| `INLINE_OPEN_TAG`  | `"OpenTag"`      | Start of an inline element                |
| `INLINE_CLOSE_TAG` | `"CloseTag"`     | End of an inline element                  |
| `INLINE_ATOMIC`    | `"AtomicInline"` | Atomic inline (image, inline-block, etc.) |

### Break Token Types

**Source:** `src/fragmentation/tokens.js`

Used in `BreakToken.type`.

| Constant             | Value      | Description              |
| -------------------- | ---------- | ------------------------ |
| `BREAK_TOKEN_BLOCK`  | `"block"`  | Block-level break token  |
| `BREAK_TOKEN_INLINE` | `"inline"` | Inline-level break token |

### Box Decoration Break

**Source:** `src/layout/layout-node.js`

Used in `node.boxDecorationBreak`.

| Constant               | Value     | Description                               |
| ---------------------- | --------- | ----------------------------------------- |
| `BOX_DECORATION_SLICE` | `"slice"` | Default: decorations are sliced at breaks |
| `BOX_DECORATION_CLONE` | `"clone"` | Decorations are cloned on each fragment   |

### Early Break Types

**Source:** `src/fragmentation/break-scoring.js`

Used in `EarlyBreak.type`.

| Constant             | Value      | Description                  |
| -------------------- | ---------- | ---------------------------- |
| `EARLY_BREAK_BEFORE` | `"before"` | Break before the target node |
| `EARLY_BREAK_INSIDE` | `"inside"` | Break inside the target node |

### Algorithm Data Types

Each algorithm data type is defined in the file that uses it:

| Constant              | Value            | Defined in                             |
| --------------------- | ---------------- | -------------------------------------- |
| `ALGORITHM_FLEX`      | `"FlexData"`     | `src/algorithms/flex-container.js`         |
| `ALGORITHM_FLEX_LINE` | `"FlexLineData"` | `src/algorithms/flex-container.js`         |
| `ALGORITHM_GRID`      | `"GridData"`     | `src/algorithms/grid-container.js`         |
| `ALGORITHM_TABLE_ROW` | `"TableRowData"` | `src/algorithms/table-row.js`              |
| `ALGORITHM_MULTICOL`  | `"MulticolData"` | `src/algorithms/multicol-container.js`     |

Used in `breakToken.algorithmData.type`.

### Overflow Threshold

**Source:** `src/fragmentation/fragmentation-context.js`

| Constant                     | Value               | Description                                                                                                    |
| ---------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_OVERFLOW_THRESHOLD` | `19.2` (`16 * 1.2`) | Default overflow threshold matching the browser default line height for `font-size: 16px; line-height: normal` |

### Named Page Sizes

**Source:** `src/resolvers/page-resolver.js`

All dimensions are in CSS pixels at 96 DPI.

| Key       | inlineSize | blockSize |
| --------- | ---------- | --------- |
| `A5`      | 559        | 794       |
| `A4`      | 794        | 1123      |
| `A3`      | 1123       | 1587      |
| `B5`      | 665        | 945       |
| `B4`      | 945        | 1334      |
| `JIS-B5`  | 688        | 972       |
| `JIS-B4`  | 972        | 1376      |
| `LETTER`  | 816        | 1056      |
| `LEGAL`   | 816        | 1344      |
| `LEDGER`  | 1056       | 1632      |

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
} from "fragmentainers/algorithms.js";
```

| Algorithm                 | Constructor                                                    | Source                             |
| ------------------------- | -------------------------------------------------------------- | ---------------------------------- |
| `BlockContainerAlgorithm` | `(node, constraintSpace, breakToken, earlyBreakTarget?)`       | `src/algorithms/block-container.js`    |
| `InlineContentAlgorithm`  | `(node, constraintSpace, breakToken)`                          | `src/algorithms/inline-content.js`     |
| `TableRowAlgorithm`       | `(node, constraintSpace, breakToken, earlyBreakTarget?)`       | `src/algorithms/table-row.js`          |
| `MulticolAlgorithm`       | `(node, constraintSpace, breakToken, earlyBreakTarget?)`       | `src/algorithms/multicol-container.js` |
| `FlexAlgorithm`           | `(node, constraintSpace, breakToken, earlyBreakTarget?)`       | `src/algorithms/flex-container.js`     |
| `GridAlgorithm`           | `(node, constraintSpace, breakToken, earlyBreakTarget?)`       | `src/algorithms/grid-container.js`     |

Each class's `*layout()` generator returns `{ fragment: Fragment, breakToken: BreakToken | null, earlyBreak?: EarlyBreak }` via its final `return` value. `BlockContainerAlgorithm` owns Class A break scoring; flex, grid, multicol, and table-row algorithms accept and forward an `earlyBreakTarget` so nested block containers can honor it.

### Dispatch Order

`getLayoutAlgorithm(node)` selects the algorithm by checking node properties in
this order:

1. `isMulticolContainer` -- `MulticolAlgorithm`
2. `isFlexContainer` -- `FlexAlgorithm`
3. `isGridContainer` -- `GridAlgorithm`
4. `isInlineNode` -- `InlineContentAlgorithm` (the anonymous inline node holding a block container's inline-level content)
5. `isTableRow` -- `TableRowAlgorithm`
6. (default) -- `BlockContainerAlgorithm`

---

## 10. Layout Handlers

Layout handlers extend the engine with custom behaviors. See
[handlers.md](handlers.md) for the full guide on writing custom handlers.

### LayoutHandler (base class)

`import { LayoutHandler } from "fragmentainers"`

Base class for all layout handlers. Subclass and override methods as needed.

#### Methods

| Method                                                           | Returns                                                 | Description                                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `init(options, context)`                                         | `void`                                                  | Initialize a fresh per-flow instance with constructor options and its `FlowContext`.                 |
| `claim(node)`                                                    | `boolean`                                               | Return `true` if this handler claims a child node (removes it from flow). Default: `false`.          |
| `resetRules()`                                                   | `void`                                                  | Reset state from a previous `matchRule` pass. Called before each CSS rule walk.                      |
| `matchRule(rule, context)`                                       | `void`                                                  | Inspect a CSS rule during the centralized rule walk. `context.wrappers` has grouping rule preambles. |
| `appendRules(rules)`                                             | `void`                                                  | Push CSS rule text strings into `rules[]` to inject into a shared stylesheet.                        |
| `prepareContent(content)`                                        | `void`                                                  | Called after rule processing with the full source content, before measurement. Mutate or mark it.    |
| `applyConstraintSpace(constraintSpace)`                          | `void`                                                  | The measurement container was sized to this space (setup and every fragmentainer). Size auxiliary measurers here. |
| `beforeMeasurement(contentRoot)`                                 | `void`                                                  | Mutate the live measurement DOM before the forced reflow.                                            |
| `afterMeasurementSetup(contentRoot)`                             | `void`                                                  | Called after measurement DOM is set up. Handlers can probe live elements via `getComputedStyle`.     |
| `getAdoptedSheets()`                                             | `CSSStyleSheet[]`                                       | Return per-flow stylesheets to fold into the composite scoped sheet (`document.adoptedStyleSheets`). |
| `layout(rootNode, constraintSpace, breakToken, layoutChild)`     | `{ reservedBlockStart, reservedBlockEnd, afterRender }` | Pre-layout hook. Called once per fragmentainer.                                                      |
| `beforeChildren(node, constraintSpace, breakToken)`              | `{ node, constraintSpace, isRepeated } \| null`         | Called before the child loop. Return a layout descriptor to prepend, or `null`.                      |
| `afterContentLayout(fragment, constraintSpace, inputBreakToken)` | `{ reservedBlockEnd, afterRender } \| null`             | Called after content layout. Return updated reservations to trigger re-layout.                       |
| `getFlow()`                                                      | `FragmentFlow \| null`                                  | Return a handler-owned parallel flow, if any.                                                        |
| `extractFlowChildren(fragment, inputBreakToken, cap)`            | `{ children, pushForward }`                             | Enqueue parallel-flow children and identify containing blocks that must move forward.                |
| `getFlowCap(constraintSpace)`                                    | `number`                                                | Maximum block-size contribution for the parallel flow (default: `Infinity`).                         |
| `composeFlowFragment(wrapper, fragment, inputBreakToken)`        | `void`                                                  | Compose a settled parallel-flow fragment into the fragmentainer.                                    |
| `destroy()`                                                      | `void`                                                  | Release resources held by this handler instance.                                                     |

---

### Fragmenter.handlers (catalog) and flow.handlers (registry)

`Fragmenter.handlers` is the ordered array of handler classes every flow
instantiates. Append to it once at package load; append a subclass of a listed
class to override it in place. Pushes affect flows constructed afterwards.

```js
Fragmenter.handlers.push(MyHandler);
const flow = new Fragmenter(content, options);
flow.handlers.get(MyHandler); // this flow's instance
```

Each flow owns a `HandlerRegistry` (`flow.handlers`), created from the catalog
at construction. The registry is iterable over the instances.

#### HandlerRegistry

`import { HandlerRegistry, resolveHandlerClasses } from "fragmentainers/handlers.js"`

| Method                                                           | Returns                  | Description                                                                                |
| ---------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| `new HandlerRegistry(classes, context?)`                         | —                        | Resolve `classes` (validate, dedupe, subclass-overrides-base) for one flow                 |
| `classes`                                                        | `Class[]`                | The resolved class list, in instantiation order                                            |
| `init(options)`                                                  | `void`                   | Destroy existing instances, create fresh ones, call `handler.init(options, context)`      |
| `destroy()`                                                      | `void`                   | Destroy this registry's instances only                                                     |
| `get(HandlerClass)`                                              | `LayoutHandler \| null`  | This flow's instance of the class (or of the subclass overriding it)                       |
| `processRules(styles)`                                           | `void`                   | Walk CSS rules, dispatch to `matchRule()`, collect `appendRules()` output                  |
| `getInjectedSheet()`                                             | `CSSStyleSheet \| null`  | The sheet appended by the most recent `processRules()` call (handler-`appendRules` output) |
| `claim(node)`                                                    | `boolean`                | Check if any handler claims this node                                                      |
| `prepareContent(content)`                                        | `void`                   | Let every handler prepare the source content                                               |
| `applyConstraintSpace(constraintSpace)`                          | `void`                   | Hand handlers the constraint space the measurement container was sized to                  |
| `beforeMeasurement(contentRoot)`                                 | `void`                   | Let handlers mutate the measurement DOM before measurement                                 |
| `afterMeasurementSetup(contentRoot)`                             | `void`                   | Let handlers probe the live measurement DOM                                                |
| `getAdoptedSheets()`                                             | `CSSStyleSheet[]`        | Collect per-flow stylesheets from handlers (folded into the composite scoped sheet)        |
| `layout(rootNode, constraintSpace, breakToken, layoutChild)`     | `object`                 | Aggregate `layout()` results from all handlers                                             |
| `beforeChildren(node, constraintSpace, breakToken)`              | `object \| null`         | First non-null `beforeChildren()` result                                                   |
| `afterContentLayout(fragment, constraintSpace, inputBreakToken)` | `object \| null`         | Aggregate `afterContentLayout()` results                                                   |
| `getFlows()`                                                     | `Array<{ handler, flow }>` | Handlers that run a parallel `FragmentFlow`                                              |

#### FlowContext

`import { FlowContext } from "fragmentainers/fragmentation.js"`

Per-flow state handed to every handler's `init(options, context)` and carried by
every `LayoutNode` as `node.context`: `{ handlers: HandlerRegistry, cloneMap: CloneMap, flow: Fragmenter | null }`.
Handlers that create layout nodes or a `FragmentFlow` must pass the context on.

---

### Built-in Handlers

The default catalog, in order: `RepeatedTableHeader`, `FixedPosition`,
`StyleResolver`, `EmulatePrintPixelRatio`, `BodyRewriter`, `PseudoElements`.
`PageFloat` and `MutationSync` ship with the package but are not in the catalog;
push them if you need them. Paged-media handlers (footnotes, running elements)
live in pagedjs, which appends them to the catalog.

| Handler                  | Import                                                                                   | Description                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `RepeatedTableHeader`    | `import { RepeatedTableHeader } from "fragmentainers/handlers.js"`                          | Repeat `<thead>` on continuation pages                                                          |
| `FixedPosition`          | `import { FixedPosition } from "fragmentainers/handlers.js"`                                | Repeat `position: fixed` elements on every page                                                 |
| `StyleResolver`          | `import { StyleResolver } from "fragmentainers/handlers.js"`                                | Per-element overrides for structural-pseudo rules (replaces the cloned-position match)          |
| `EmulatePrintPixelRatio` | `import { EmulatePrintPixelRatio } from "fragmentainers/handlers.js"`                       | Line-height normalization for print-style flows (auto-enabled in Blink browsers; page-based only) |
| `BodyRewriter`           | `import { BodyRewriter } from "fragmentainers/handlers.js"`                                 | Rewrites `body`/`html` rules to `:scope` (fragment-container) and `:host(content-measure) > slot` (measurer); page-based only |
| `PseudoElements`         | `import { PseudoElements } from "fragmentainers/handlers.js"`                               | Materializes `::before`/`::after` as `<frag-pseudo>` layout objects                             |
| `PageFloat`              | `import { PageFloat } from "fragmentainers/handlers.js"`                                    | Not in catalog. Page-relative floats via `--float-reference: page` and `--float: top\|bottom`  |
| `MutationSync`           | `import { MutationSync } from "fragmentainers/handlers.js"`                                 | Not in catalog. Syncs mutations from fragment-container clones back to source elements          |

`Fragmenter` computes an `isPageBased` flag (`true` when a `PageResolver` is used or when neither `resolver` nor `constraintSpace` is supplied) and passes it to all handlers via `init(options, context)`. Handlers that only apply to print-style fragmentation (`EmulatePrintPixelRatio`, `BodyRewriter`) gate their behavior on this flag and no-op for column/region flows.

---

### FontMetrics

**Source:** `src/measurement/font-metrics.js`

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
