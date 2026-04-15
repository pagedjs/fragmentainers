# The `<fragment-container>` Element

`<fragment-container>` is the visible output of the fragmentation engine. Each
fragmentainer produced by `FragmentedFlow` — one page, one column, or one
region — becomes a `<fragment-container>` custom element. It owns a shadow
root that hosts the composed DOM, isolates the rendered content from host
page styles, and exposes the page-level values and constraints that fed the
layout.

**Source:** `src/components/fragment-container.js`

This document focuses on how the element integrates with the rest of the
engine and on the two properties that surface per-page layout context:
`namedPage` and `constraints`. For the full custom-element method/event
table see [api-reference.md § FragmentContainerElement](api-reference.md#fragmentcontainerelement-fragment-container).

---

## Table of Contents

1. [Role in the Pipeline](#1-role-in-the-pipeline)
2. [Shadow DOM Structure](#2-shadow-dom-structure)
3. [Creation via FragmentationContext](#3-creation-via-fragmentationcontext)
4. [Page Values: `namedPage` and `constraints`](#4-page-values-namedpage-and-constraints)
5. [`setupForRendering()` and the Stylesheet Pipeline](#5-setupforrendering-and-the-stylesheet-pipeline)
6. [Counter State Continuity](#6-counter-state-continuity)
7. [Observer Lifecycle and Events](#7-observer-lifecycle-and-events)
8. [Overflow Detection](#8-overflow-detection)
9. [Data Attributes](#9-data-attributes)
10. [Regions and Columns](#10-regions-and-columns)

---

## 1. Role in the Pipeline

`<fragment-container>` is produced during the **fragmentation phase** — the
step after layout has computed a `Fragment` tree. The layout phase never
touches the element. All measurement happens inside `<content-measure>`
off-screen; the fragment-container only receives the composed output.

```
FragmentedFlow.next()
  │
  ├── run layout for one fragmentainer   ← Fragment + BreakToken + CounterState
  │
  └── FragmentationContext.createFragmentainer(index)
        │
        ├── document.createElement("fragment-container")
        ├── assign fragmentIndex, constraints, namedPage
        ├── setupForRendering(contentStyles, counterSnapshot)
        │     └── adopt stylesheets into shadow root
        ├── wrapper.appendChild(fragment.build(prevBreakToken))
        ├── fragment.map(prevBreakToken, wrapper)
        ├── run each fragment.afterRender(wrapper, contentStyles)
        ├── adopt per-fragment nth-selector sheets
        └── set expectedBlockSize + overflowThreshold
```

The consumer gets a fully-composed element and appends it to the page.

---

## 2. Shadow DOM Structure

Each element has a shadow root with a single `<slot>` as the content anchor:

```
<fragment-container>
  #shadow-root
    <style>
      :host { display: block; overflow: hidden; }
      slot   { display: block; height: 100%; }
    </style>
    <slot>
      ... composed fragment DOM ...
    </slot>
  (light DOM is empty — content is appended into the slot inside the shadow)
```

The slot is used as the content anchor, not for light-DOM projection. Host
page light-DOM children are not forwarded; rendered content is appended
directly to the slot, keeping it inside the shadow tree where only the
adopted stylesheets apply.

### CSS isolation

Isolation comes from three sources layered together:

1. **Shadow boundary.** Host page stylesheets do not cross into the shadow
   root. The only styles that apply are the sheets adopted into the root.
2. **Adopted stylesheets.** The shadow root's `adoptedStyleSheets` is set to
   the content sheets (from the measurer), then any handler-contributed
   sheets, then `OVERRIDES` last so it always wins the cascade.
3. **`body`/`html` rewriting.** The built-in `BodyRewriter` handler rewrites
   rules targeting `body` and `html` in content sheets so they target
   `:host`/`slot` inside the shadow DOM, preserving the author's intent
   without leaking from the host page.

---

## 3. Creation via FragmentationContext

All fragment-containers are created by
`FragmentationContext.createFragmentainer(index)` in
`src/fragmentation/fragmentation-context.js`. The constructor creates one per
fragment when composition runs; consumers can also instantiate elements
lazily by calling `createFragmentainer()` directly (e.g. during `reflow()`).

Key points:

- **Host box sizing is mode-dependent.** When `pageBoxSize` is present
  (page mode), the host box is left unsized — a later renderer (print CSS
  or a page-renderer component) uses `constraints.pageBoxSize` to
  produce the full page box including margins. When `pageBoxSize` is
  absent (region/column mode), the host box is sized to `contentArea`
  directly.
- **Counter snapshot comes from the previous fragment.** See §6.
- **Handler-contributed per-fragment sheets** (`#adoptedSheets`) and the
  per-fragment `afterRender` callbacks are applied after
  `setupForRendering` but before `expectedBlockSize` is set.

---

## 4. Page Values: `namedPage` and `constraints`

These two properties are the element's primary integration surface for code
that consumes fragments — e.g. a renderer that draws page margins, a header
that shows the current chapter's page name, or a print-CSS emulator that
needs the original CSS units.

### 4.1 `namedPage`

|        |                                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Type   | `string \| null`                                                                                                                                 |
| Setter | `set namedPage(value)` — stores the value and mirrors it to the `data-page-name` attribute. Falsy values become `null` and remove the attribute. |
| Source | `fragment.constraints.namedPage` at creation time                                                                                                |

`namedPage` is the CSS `page` property value that applies to the first
element on this fragmentainer. `@page NAME { ... }` rules in the content's
stylesheets match pages whose `namedPage` equals `NAME`.

The setter mirrors the value to a `data-page-name` attribute, so CSS
authors and downstream tools can select pages by name without reading the
property. A page with `namedPage === "chapter"` appears as
`<fragment-container data-page-name="chapter">`.

`PageResolver.resolve()` walks the break token tree
via `resolveNamedPageForBreakToken(rootNode, breakToken)` to find the first
node that will be placed on this page and reads its computed `page` property.
The resolved string is stored on the `PageConstraints` and copied onto the
element. In non-page fragmentation modes (regions, columns), the constraints
object has no `namedPage` field and the element's property is `null`.

`BlockContainerAlgorithm`
treats a change in `page` between adjacent siblings as a Class A forced
break (`#namedPageChanged` in `src/algorithms/block-container.js`). The
engine inserts a page break before the child whose `page` differs, so the
new fragmentainer resolves a new `namedPage` and picks up a new set of
`@page` rules.

### 4.2 `constraints`

|        |                                                                              |
| ------ | ---------------------------------------------------------------------------- |
| Type   | `PageConstraints \| RegionConstraints \| null`                               |
| Setter | `set constraints(value)` — falsy values become `null`                    |
| Source | `fragment.constraints` (the return value of the resolver's `resolve()` call) |

`constraints` holds the full resolver output for this fragmentainer.
The shape depends on the resolver used to produce the fragment.

#### PageConstraints (page mode)

Defined in `src/resolvers/page-resolver.js`.

| Field          | Type                           | Description                                                                           |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| `pageIndex`    | `number`                       | Zero-based page number. Matches `fragmentIndex` in page mode.                         |
| `namedPage`    | `string \| null`               | CSS page name, same value as the element's `namedPage` property.                      |
| `pageBoxSize`  | `{ inlineSize, blockSize }`    | Full page box (paper size after orientation).                                         |
| `margins`      | `{ top, right, bottom, left }` | Resolved `@page` margins in CSS pixels.                                               |
| `contentArea`  | `{ inlineSize, blockSize }`    | `pageBoxSize` minus margins. This is the fragmentainer.                               |
| `isFirst`      | `boolean`                      | `pageIndex === 0`.                                                                    |
| `isVerso`      | `boolean`                      | True on verso (left) pages per the document's writing mode and `@page :left` cascade. |
| `isRecto`      | `boolean`                      | True on recto (right) pages. Inverse of `isVerso`.                                    |
| `isBlank`      | `boolean`                      | A blank page inserted to satisfy `break-before: left`/`right`/`recto`/`verso`.        |
| `matchedRules` | `PageRule[]`                   | The `@page` rules that matched (in cascade order).                                    |
| `cssText`      | `object \| null`               | Original CSS unit strings for rendering.                                              |

`PageConstraints` also exposes `toConstraintSpace()`, which the layout
driver uses to convert the resolver output into a layout `ConstraintSpace`
— the same object the resolver hands to layout. The composition copy
reaches the fragment-container unchanged, so consumers can inspect the
exact geometry that drove layout.

#### RegionConstraints (region mode)

Defined in `src/resolvers/region-resolver.js`.

| Field         | Type                        | Description                                           |
| ------------- | --------------------------- | ----------------------------------------------------- |
| `regionIndex` | `number`                    | Zero-based region index.                              |
| `element`     | `Element`                   | The source DOM region element the resolver was given. |
| `contentArea` | `{ inlineSize, blockSize }` | Read from `getBoundingClientRect()` at resolve time.  |

Region constraints have no `pageBoxSize`, no `margins`, no `namedPage`, and
no `matchedRules`. Code that inspects `constraints` must branch on
which resolver was used — typically by checking for the presence of
`pageBoxSize` or `pageIndex`.

#### Fixed constraint space (column / manual mode)

When `FragmentedFlow` is constructed with `width`/`height` or a fixed
`ConstraintSpace` (no resolver), the per-fragment `constraints` is the
`ConstraintSpace` itself. It has `availableInlineSize`,
`availableBlockSize`, `fragmentainerBlockSize`, etc. — but no page box,
named page, or margins.

### 4.3 Consuming the properties

```js
const flow = new FragmentedFlow(content, { resolver: PageResolver.fromDocument() });
for (const el of flow) {
	if (el.constraints?.pageBoxSize) {
		// Page mode: apply full-page sizing with margins outside the content area.
		el.style.width = el.constraints.pageBoxSize.inlineSize + "px";
		el.style.height = el.constraints.pageBoxSize.blockSize + "px";
		el.style.padding =
			`${el.constraints.margins.top}px ` +
			`${el.constraints.margins.right}px ` +
			`${el.constraints.margins.bottom}px ` +
			`${el.constraints.margins.left}px`;
	}
	// el.dataset.pageName is already set by the namedPage setter — style with:
	//   fragment-container[data-page-name="chapter"] { ... }
	document.body.appendChild(el);
}
```

---

## 5. `setupForRendering()` and the Stylesheet Pipeline

`setupForRendering(contentStyles, counterSnapshot?)` prepares the shadow
root for a new render and returns the slot element to append content into.
It is idempotent — calling it again clears the slot and re-applies sheets.

```
setupForRendering(contentStyles, counterSnapshot)
  │
  ├── ensure shadow root + slot exist
  ├── clear slot.innerHTML
  ├── set data-fragment = fragmentIndex
  ├── adoptedStyleSheets =
  │     [ ...contentStyles.sheets,
  │       (optional) counterSet sheet,
  │       OVERRIDES ]
  └── return slot
```

### `contentStyles`

The first argument is the measurer's content-style snapshot from
`ContentMeasureElement.getContentStyles()`:

```js
// src/components/content-measure.js
getContentStyles() {
  return { sheets: [...this.#shadow.adoptedStyleSheets] };
}
```

The returned `sheets` array is a shallow copy — any author CSS, handler
contributions, and the measurer's UA sheet are all captured. Every
fragment-container shares the same `contentStyles` object by reference, so
author stylesheets are re-adopted rather than cloned. When the flow is
re-laid-out (`FragmentedFlow.reflow()`), a fresh snapshot is taken.

### OVERRIDES (last)

`OVERRIDES` (`src/styles/overrides.js`) is a shared `CSSStyleSheet` adopted
_last_ into every fragment-container's shadow DOM. It suppresses the
properties that should only appear on the first or last fragment of a
split element (`text-indent`, `::first-letter`, `::before`, counter reset,
etc.). Because it is last, it always wins the cascade.

### Handler-contributed sheets

After `setupForRendering` returns, `FragmentationContext` calls
`adoptHandlerSheet(sheet)` for each sheet returned by
`handlers.getAdoptedSheets()`. The method inserts the new sheet
immediately before `OVERRIDES` so `OVERRIDES` retains highest priority.

`StyleResolver` (`src/handlers/style-resolver.js`) uses this path to
adopt a single shared sheet wrapped in `@layer nth`. Author stylesheets
are first piped through `prepareAuthorSheetsForFragment`
(`src/styles/strip-structural-pseudos.js`) which removes structural-pseudo
rules (whose selectors would misfire against clones) and wraps the
survivors in an anonymous `@layer`. The named `@layer nth` is declared
later so it wins by layer order — the stamped `[data-ref="N"]` overrides
beat any author rule that matched the element in the source cascade.

---

## 6. Counter State Continuity

CSS counters must flow across fragments: a `counter-increment` on page 1
needs to be visible on page 2. `FragmentationContext` snapshots each
fragment's counter state during composition and hands the previous
fragment's snapshot to the next one via `setupForRendering`'s
`counterSnapshot` argument.

```js
// fragmentation-context.js
const counterSnapshot = index > 0 ? this.#fragments[index - 1].counterState : null;
el.setupForRendering(this.#contentStyles, counterSnapshot);
```

When the snapshot is non-empty, `setupForRendering` inserts a generated
stylesheet immediately before `OVERRIDES`:

```css
slot {
	counter-set: counter-a 12 counter-b 3;
}
```

This seeds the root scope so that any `counter()`/`counters()` function in
the continuation fragment sees the correct starting value before the
fragment's own increments take effect. Because the sheet is inserted before
`OVERRIDES`, and `OVERRIDES` also suppresses `counter-set` on
`[data-split-from]` elements, the seed applies at the slot scope without
being clobbered on elements that span the break.

See `src/fragmentation/counter-state.js` for the snapshot format and the
accumulator that produces it.

---

## 7. Observer Lifecycle and Events

`<fragment-container>` can optionally observe its own content for changes
after composition. This is used to reflow when the user edits the
fragmented output or when late-loading resources (e.g. fonts, images)
change measurement.

| Method                  | Purpose                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `startObserving()`      | Attach `ResizeObserver` and `MutationObserver` on the slot.                                                |
| `stopObserving()`       | Disconnect both observers. Called from `disconnectedCallback`.                                             |
| `takeMutationRecords()` | Drain the internal mutation buffer plus any pending records from the observer. Returns `MutationRecord[]`. |

Both observers funnel through `#scheduleNotify()`, which uses
`queueMicrotask` to coalesce bursts of mutations and a single resize into
one event:

| Event             | `detail`                                                    | Fires when                                                                            |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `fragment-change` | `{ index }`                                                 | The slot's DOM or size changed.                                                       |
| `overflow`        | `{ index, expectedBlockSize, renderedBlockSize, overflow }` | Rendered content height exceeds `expectedBlockSize` by more than `overflowThreshold`. |

`ResizeObserver` attachment is deferred one frame via
`requestAnimationFrame` so the observer's initial spurious callback is
skipped. This means `startObserving()` returns before the observer is
actually active; code that needs to know when observation has started
should wait a frame.

### Integration: MutationSync (WIP)

The `MutationSync` handler (`src/handlers/mutation-sync.js`) listens for
`fragment-change`, calls `takeMutationRecords()`, and applies the
mutations back to the source content. This is how edits made inside a
rendered fragment propagate back to the original DocumentFragment so a
subsequent `reflow()` sees them.

---

## 8. Overflow Detection

Overflow detection compares the layout-predicted size against what the
browser actually rendered:

- `expectedBlockSize` (setter) — set by `FragmentationContext` to
  `fragment.constraints.contentArea.blockSize`. This is what layout
  reserved for the fragmentainer.

When the `ResizeObserver` entry's `contentBoxSize.blockSize` exceeds
`expectedBlockSize + overflowThreshold`, an `overflow` event fires with
the delta. Consumers can respond by calling
`FragmentedFlow.reflow(index, { rebuild: true })` or by flagging the page
for manual intervention — the engine itself does not auto-reflow on
overflow.

---

## 9. Data Attributes

`FragmentationContext` and `setupForRendering` set these attributes during
composition. They are stable integration points for CSS authors and for
downstream tools (e.g. print renderers).

| Attribute         | Value     | Set by                 | Meaning                                                                    |
| ----------------- | --------- | ---------------------- | -------------------------------------------------------------------------- |
| `data-fragment`   | `{index}` | `setupForRendering`    | Zero-based fragmentainer index.                                            |
| `data-page-name`  | `{name}`  | `namedPage` setter     | CSS `page` name for this fragmentainer. Absent when `namedPage` is `null`. |
| `data-first`      | present   | `FragmentationContext` | This is the first fragmentainer (`fragment.isFirst`).                      |
| `data-last`       | present   | `FragmentationContext` | This is the last fragmentainer (`fragment.isLast`).                        |
| `data-blank-page` | present   | `FragmentationContext` | A blank page inserted for `:left`/`:right`/`recto`/`verso`. No content.    |

The element also has `role="none"` set in `connectedCallback()` — the
fragment-container is a presentational wrapper, not a semantic landmark.

---

## 10. Regions and Columns

Regions and columns reuse the same element with different integration
contract:

- **Page mode.** `constraints` is a `PageConstraints`; `namedPage` may
  be set; `data-first`/`data-last` mark the document boundaries. The host
  box is left unsized so a renderer can apply page margins outside the
  content area.
- **Region mode.** `constraints` is a `RegionConstraints` with the
  source region element on `constraints.element`. `namedPage` is `null`.
  The host box is sized to the `contentArea` directly. Consumers typically
  compose the fragment-container _into_ the region element rather than
  rendering it as a page.
- **Column mode** (multicol). Each column is a fragmentainer inside the
  containing block's multicol layout; the multicol algorithm produces
  column fragment-containers via `MulticolAlgorithm`. Their
  `hese were discernible (though faintly) e` is a fixed `ConstraintSpace` and `namedPage` is
  `null`.

Because all three modes produce the same element type, consumers can write
code that works across modes by branching on the shape of
`constraints`.

---

## See Also

- [api-reference.md § FragmentContainerElement](api-reference.md#fragmentcontainerelement-fragment-container) — complete method/property/event tables
- [architecture.md § Fragmentation](architecture.md#10-composition) — how composition turns layout output into fragment-containers
- [handlers.md](handlers.md) — handler hooks that contribute sheets, per-fragment overrides, and `afterRender` behavior
