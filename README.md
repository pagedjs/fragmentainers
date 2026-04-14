# Fragmentainers

Javascript fragmentation engine to split content across bounded containers (fragmentainers). It implements the [CSS Fragmentation](https://www.w3.org/TR/css-break-3/) model and [CSS Paged Media](https://www.w3.org/TR/css-page-3/) breaks, inspired by browser layout engines internal block fragmentation architecture.

A part of [Pagedjs](https://pagedjs.org), but this library can be used independently to fragment content across columns, regions, pages, or any bounded container.

## NPM Module

```bash
npm install fragmentainers
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
- **`emulatePrintPixelRatio`** - Screen only matching of print line-height

### Pagination with @page styles

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

### Preloading

Layout is synchronous. If fonts or images haven't loaded yet, measurements may be inaccurate. Use `preload()` to ensure resources are ready before iterating:

```javascript
const flow = new FragmentedFlow(template.content, { styles: [sheet] });
await flow.preload();
for (const el of flow) {
	document.body.appendChild(el);
}
```

- **Images** — set `width` and `height` attributes on `<img>` elements when possible. Images with explicit dimensions are automatically set to `loading="lazy"` and don't need preloading. Images that are unable to be loaded will be removed from the flow as their size can not be calculated.
- **Fonts** — Ensure web fonts are loaded before layout. `preloadFonts()` triggers loading for all unloaded font faces in `document.fonts`. For best performance, use `<link rel="preload" as="font">` in your HTML.
- **Measurement** — Each segment of children between forced breaks is measured one segment at a time, so it can handle long content. For content without clear breaks, layout will be computed in a single measurement element which may cause slowdowns.

## Layout Handlers

Like pagedjs the engine supports **handlers** - self-contained extensions that hook into the layout and rendering pipeline. Much of the functionality outside of the core layout is implemented using these handlers.

```css
.float-top {
	--float-reference: page;
	--float: top;
}
```

```javascript
import { LayoutHandler, FragmentedFlow } from "fragmentainers";

// Custom handlers extend the LayoutHandler base class
class MyHandler extends LayoutHandler {
	claim(node) {
		/* ... */
	}
	layout(rootNode, constraintSpace, breakToken, layoutChild) {
		/* ... */
	}
}

FragmentedFlow.register(MyHandler);
```

See [Layout Handlers](docs/handlers.md) for the full handler interface and how to register custom handlers.

## Emulate Print Pixel Ratio

Blink-based browsers round `line-height: normal` to the device pixel ratio — integer CSS pixels at DPR 1, half-pixels at DPR 2. This means the same content renders at different line heights screen vs print, causing fragmentation mismatches between layout and rendering.

The `emulatePrintPixelRatio` option attempts to normalize the two ratios to provide a more accurate preview of the print output. DPR 1 line-height values are emulated with a screen only the adopted stylesheet and will not be used in printing.

## Documentation

- [Architecture](docs/architecture.md) — How the engine works internally
- [API Reference](docs/api-reference.md) — Reference for all public exports
- [Layout Algorithms](docs/layout-algorithms.md) — Reference for layout algorithms
- [Layout Handlers](docs/handlers.md) — How to use and write layout handlers
- [Browser Engine Reference](docs/browser-engine-reference.md) — Mappings to Blink, Gecko, and WebKit equivalents
- [Testing](docs/testing-guide.md) — Guide for writing tests and specs

## Testing

```bash
npm test                # unit/integration tests
npm run lint            # eslint (separate from tests)
```

Tests use **Playwright** running in a browser. Each test imports a shared browser fixture and evaluates code inside the browser via `page.evaluate()`.

## Specs (visual comparison tests)

```bash
npm run specs
```

Spec tests are **reftests** based on the [Web Platform Tests](https://web-platform-tests.org/) approach. Each test has a test HTML file and a reference HTML file — the runner screenshots both and compares them pixel-by-pixel.

## Viewer

The `fragment` bin opens a spec in a headed browser with the engine live-injected, so you can refresh to re-run after edits:

```bash
fragment specs/at-page/awesome.html                  # interactive (Chromium)
fragment specs/at-page/awesome.html --inspect        # per-page report to stdout
fragment specs/at-page/awesome.html --html out.html  # dump fragmented HTML
fragment specs/at-page/awesome.html --pdf book.pdf   # render to PDF
fragment --help                                      # full flag list
```

`--inspect` is the fastest way to see which page a break token landed on, which elements got split, and any zero-progress warnings — no screenshotting needed.

## License

MIT
