# Fragmentainers

Standalone fragmentation engine that splits content across bounded containers (fragmentainers). It implements the [CSS Fragmentation](https://www.w3.org/TR/css-break-3/) model and [CSS Paged Media](https://www.w3.org/TR/css-page-3/) breaks, inspired by browser layout engines internal block fragmentation architecture.

A part of [Pagedjs](https://pagedjs.org), but this library can be used independently to fragment content across columns, regions, pages, or any bounded container.

## NPM Module

```bash
npm install fragmentainers
```

### Paginate with @page styles

```javascript
import { FragmentedFlow } from "fragmentainers";

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  @page { size: A4; margin: 2cm; }
`);

const template = document.createElement("template");
template.innerHTML = "<h1>Hello</h1><p>Content to paginate...</p>";

const flow = new FragmentedFlow(template.content, { styles: [sheet] });

for (const fragmentainer of flow) {
	// Each element is a <fragment-container>
	document.body.appendChild(fragmentainer);
}
```

## Usage

### `FragmentedFlow`

```javascript
const flow = new FragmentedFlow(content, options);
for (const el of flow) {
	/* ... */
}
```

**Content**

- **`DocumentFragment`** — from `template.content` or `document.createDocumentFragment()`

- **`Element`** — cloned into a new DocumentFragment

**Options**

- **`styles`** — `CSSStyleSheet[]` applied via `adoptedStyleSheets`
- **`constraintSpace`** — `ConstraintSpace` for sizing
- **`resolver`** — A `PageResolver` or `RegionResolver` instance
- **`width` / `height`** — Resolves to a constraint space for fixed size fragmentation
- _(none)_ — Auto-creates `PageResolver` from `@page` rules in styles

**Static methods:**

| Method             | Description                                                    |
| ------------------ | -------------------------------------------------------------- |
| `register(module)` | Register a layout module globally (must extend `LayoutModule`) |
| `remove(module)`   | Unregister a previously registered module                      |

**Methods:**

| Method                       | Returns                | Description                                                                |
| ---------------------------- | ---------------------- | -------------------------------------------------------------------------- |
| `next()`                     | `{ value, done }`      | Iterator protocol — returns next `<fragment-container>` element.           |
| `flow(options?)`             | `FragmentationContext` | Run fragmentation to completion. Use `{ start, stop }` for partial ranges. |
| `layout()`                   | `void`                 | Initialize the layout tree (called lazily by `next()`).                    |
| `preload()`                  | `Promise<void>`        | Optional — preload fonts and images before layout.                         |
| `reflow(fromIndex, options)` | `FragmentationContext` | Re-layout from a specific fragmentainer.                                   |
| `destroy()`                  | `void`                 | Clean up the internal `<content-measure>` element.                         |

For content where top-level children have forced breaks (`break-before: page`, etc.), layout automatically uses **sequential measurement**: each segment of children between forced breaks gets its own `<content-measure>` element, so the browser only computes layout for one segment at a time. Previous segments' measurers are destroyed as the layout moves forward. For content without clear breaks, layout will be computed in a single measurement element.

### Preloading

Layout is synchronous. If fonts or images haven't loaded yet, measurements may be inaccurate. Use `preload()` to ensure resources are ready before iterating:

```javascript
const flow = new FragmentedFlow(template.content, { styles: [sheet] });
await flow.preload();
for (const el of flow) {
	document.body.appendChild(el);
}
```

`preload()` calls `preloadFonts()` and `preloadImages()`, which can also be called independently.

Images that are unable to be loaded will be removed from the flow as their size can not be calculated.

**Best practices for accurate layout:**

- **Images** — set `width` and `height` attributes on `<img>` elements when possible. Images with explicit dimensions are automatically set to `loading="lazy"` and don't need preloading.
- **Fonts** — use local fonts or ensure web fonts are loaded before layout. `preloadFonts()` triggers loading for all unloaded font faces in `document.fonts`. For best performance, use `<link rel="preload" as="font">` in your HTML.
- **Stylesheets** — pass stylesheets via the `styles` option. If omitted, `FragmentedFlow` automatically collects from `document.styleSheets`.

## Layout

### Block

Content splits across fragmentainers at block boundaries. Nested containers fragment correctly — `blockOffsetInFragmentainer` is propagated through the tree. Non-monolithic leaf nodes (e.g., empty divs with explicit height) can fragment across fragmentainers.

#### Margin collapsing

Block margin collapsing follows CSS2 §8.3.1, consolidated in `MarginState` (`src/core/margin-collapsing.js`). Uses Chromium's LayoutNG `MarginStrut` concept for correct handling of positive, negative, and mixed margins.

Margins collapse between adjacent siblings and through parent boundaries when the parent has no padding or border (`through-collapse`). Margins are truncated at fragmentation breaks per CSS Fragmentation L3 §5.2 — the first child on a continuation page loses its margin-block-start, and the last child before a break loses its margin-block-end.

Body margin (8px UA default on the slot element) collapses with the first child's margin on the first page: `max(8px, childMargin)`. On continuation pages, the body margin-block-start is zeroed via the UA stylesheet.

### Inline

Text content breaks at word boundaries across lines and fragmentainers. `InlineBreakToken` is content-addressed (stores item index + text offset), so it survives inline-size changes between fragmentainers.

### Monolithic

Replaced elements (`<img>`, `<video>`, `<canvas>`, `<iframe>`), scrollable containers, and `overflow: hidden` elements with explicit height are monolithic. They are only sliced as a last resort.

### Table row (parallel flows)

Table cells are laid out independently. When any cell overflows, all cells receive break tokens — completed cells get `isAtBlockEnd: true` so they can produce zero-height empty fragments on resumption.

### Multicol fragmentation

Multicol containers (`column-count`, `column-width`) are detected automatically. The `layoutMulticolContainer` generator resolves column dimensions per CSS Multicol §3, creates an anonymous flow thread, and runs a column loop. Each column is a fragmentainer with `fragmentationType: 'column'`. Break tokens carry `algorithmData.type: 'MulticolData'` with resolved column dimensions.

### Flex fragmentation

Flex containers are detected via `display: flex`. Row-direction flex lays out items within each flex line as parallel flows (same pattern as table rows). Column-direction flex delegates to a flow thread for sequential block fragmentation. Break tokens carry `algorithmData.type: 'FlexData'`.

### Grid fragmentation

Grid containers are detected via `display: grid`. Items sharing a grid row are laid out as parallel flows. Rows are stacked in the block direction with Class A breaks between them. Break tokens carry `algorithmData.type: 'GridData'`.

### Forced breaks

`break-before: page|column|always` and `break-after: page|column|always` produce immediate breaks, overriding available space and break scoring.

### Break scoring (two-pass layout)

When space runs out at a suboptimal breakpoint (e.g., between siblings where `break-after: avoid` or `break-before: avoid` applies), the engine identifies a better earlier breakpoint and re-runs layout (Pass 2) to break there. `break-inside: avoid` on a parent degrades all interior break scores. Widows/orphans violations are scored as `VIOLATING_ORPHANS_WIDOWS` as a part of the two-pass system.

## Layout Modules

The engine supports **modules** -- self-contained extensions that hook into the layout and rendering pipeline. Modules can claim child nodes, remove them from normal flow, reserve space in the fragmentainer, inject custom rendering, and claim persistent elements that should be included in every measurement segment (e.g., `position: fixed` headers/footers).

```css
.float-top {
	--float-reference: page;
	--float: top;
}
```

```javascript
import { LayoutModule, FragmentedFlow } from "fragmentainers";

// Custom modules extend the LayoutModule base class
class MyModule extends LayoutModule {
	claim(node) {
		/* ... */
	}
	layout(rootNode, constraintSpace, breakToken, layoutChild) {
		/* ... */
	}
}

// Built-in modules are registered automatically.
// To add your own:
FragmentedFlow.register(new MyModule());
```

See [Layout Modules](docs/modules.md) for the full module interface and how to write custom modules.

## Line-Height Normalization

Blink-based browsers round `line-height: normal` to the device pixel ratio — integer CSS pixels at DPR 1, half-pixels at DPR 2. This means the same content renders at different line heights screen vs print, causing fragmentation mismatches between layout and rendering.

The `NormalizeLayoutModule` solves this by generating a screen-only stylesheet with explicit `line-height` values derived from canvas font metrics (`fontBoundingBoxAscent + fontBoundingBoxDescent`) when `normal` is used. It is enabled automatically in Blink-based browsers and skipped in Firefox and Safari where it is not needed.

The normalization sheet is **not** used for measurement or printing, it only provides previews of the print output. The layout uses DPR 1 line-heights for block size computation in the inline layout, while the measurer continues to render at the screen's native DPR. The fragment-container rendering matches the layout's DPR 1 values via the adopted stylesheet.

## Documentation

- [Architecture](docs/architecture.md) — How the engine works internally
- [API Reference](docs/api-reference.md) — Complete reference for all public exports
- [Layout Algorithms](docs/layout-algorithms.md) — Guide to each layout algorithm generator
- [Layout Modules](docs/modules.md) — How to use and write layout modules
- [Browser Engine Reference](docs/browser-engine-reference.md) — Mappings to Blink, Gecko, and WebKit equivalents
- [Testing](docs/testing-guide.md) — How to write tests and specs

## Architecture

The engine uses a **generator-based layout model** inspired by browser layout engines and an API that maps to the W3C fragmentation specification. See [Browser Engine Reference](docs/browser-engine-reference.md) for the full mapping.

1. **Fragmented Flow** (`src/core/fragmented-flow.js`) — `FragmentedFlow` accepts a `DocumentFragment` or `Element`, delegates measurement to a `Measurer`, builds the layout tree, runs fragmentation, and returns a `FragmentationContext` that owns results and rendering.
2. **Measurement** (`src/dom/measure.js`) — `Measurer` owns the `<content-measure>` element lifecycle. On setup it resolves `break-before`, `break-after`, and `page` properties from the CSSStyleSheet rules for each top-level child. When forced breaks split content into segments, each segment gets its own `<content-measure>` — the browser only lays out one segment at a time. `DOMLayoutNode` lazily caches `getComputedStyle` and `getBoundingClientRect` results so repeated reads are free.
3. **Layout** (`src/layout/`, `src/core/layout-request.js`) — `function*` generators that `yield` `LayoutRequest` objects. `createFragments` is the top-level loop that creates a `ConstraintSpace` per fragmentainer, runs the root generator, and collects `PhysicalFragment` fragments until no break token remains. `getLayoutAlgorithm` dispatches to the correct generator: `layoutMulticolContainer` → `layoutFlexContainer` → `layoutGridContainer` → `layoutInlineContent` → `layoutTableRow` → `layoutBlockContainer`.
4. **Fragmentation** (`src/core/fragment.js`) — `Fragment.build()` and `Fragment.map()` convert the immutable fragment tree into visible DOM. Clones elements from the source tree, trims inline content using break token offsets, marks split elements with `data-split-from`/`data-split-to` attributes, and appends to `<fragment-container>` shadow DOM containers. An override stylesheet (`src/styles/overrides.js`) suppresses CSS that shouldn't re-apply on continuation fragments.

## Testing

```bash
npm test                # lint + run all tests
npx playwright test --config test/playwright.config.js   # unit/integration tests only
```

Tests use **Playwright** running in real Chromium (not jsdom). Each test imports a shared browser fixture and evaluates code inside the browser via `page.evaluate()` for accurate DOM measurement.

## Specs (visual comparison tests)

```bash
npm run specs
```

Spec tests are **reftests** based on the [Web Platform Tests](https://web-platform-tests.org/) approach. Each test has a test HTML file and a reference HTML file — the runner screenshots both and compares them pixel-by-pixel. Test cases that are from the WPT suite are in `css-page`.

## License

MIT
