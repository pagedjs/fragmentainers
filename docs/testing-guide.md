# Testing Guide

The engine has two tiers of tests. Both run in real Chromium via Playwright — there is no jsdom or Node-only path.

| Tier                    | Location | Config                       | What it checks                                            |
| ----------------------- | -------- | ---------------------------- | --------------------------------------------------------- |
| Unit / integration      | `test/`  | `test/playwright.config.js`  | Layout algorithms, tokens, composition, DOM measurement   |
| Specs (Visual ref test) | `specs/` | `specs/playwright.config.js` | Pixel-compare fragmented output against hand-written refs |

```bash
npm test         # unit/integration
npm run specs    # specs
npm run lint     # eslint (separate from tests)
```

---

## Specs

Specs are the primary way to verify fragmentation output against the CSS specs, modelled after and using [Web Platform Tests](https://web-platform-tests.org/) reftests. Each spec is a pair of HTML files:

- **`name.html`** — a page using CSS features like `@page`, `break-*`, multicol, etc. The runner injects the fragmentation engine and replaces body content with the paginated output.
- **`name-ref.html`** — a static hand-laid reference showing the expected visual output. It does not run the engine — instead it uses `<page-container>` elements sized with CSS custom properties to mimic each fragmentainer.

The runner screenshots each `<page-container>` from the processed test page and from the reference page, then compares them pixel-by-pixel. Many test cases are imported from Chromium's WPT suite and adapted; others are hand-authored against known-good output.

Spec refs are hand-crafted and belong to the test surface. Never regenerate or delete an existing ref like a snapshot — if the engine output genuinely improved, the ref should be updated deliberately.

### Suites

Three suites live under `specs/`:

- **`css-page/`** — WPT-imported `@page` pagination tests
- **`at-page/`** — @page spec from pagedjs
- **`fragmentation/`** — CSS Fragmentation module tests

### `specs/tests.yml` format

```yaml
css-page:
  - name: basic-pagination-001-print
    type: print
  - name: basic-pagination-002-print
    type: print

at-page:
  - name: awesome
    type: print
  - name: rebuild-all-tds
    type: print
    skip: true # skip: true or "reason string" to skip a test
```

Each entry has:

- `name` — the base filename (resolves to `name.html` + `name-ref.html` in the suite directory)
- `type` — `print` (run `paginate()`) or `multicol` (run `multicol()` on detected multicol containers). See `specs/helpers/process.js`.
- `skip` — optional; `true` or a reason string

### Adding a spec

1. Drop the test file into the suite directory, e.g. `specs/fragmentation/my-test.html`. Use real `@page` / `break-*` / multicol CSS. The engine runs against the live DOM.
2. Author a reference file, `specs/fragmentation/my-test-ref.html`, that renders the expected output using `<page-container>` elements with `--page-width`, `--page-height`, and `--page-margin-*` custom properties. See `specs/fragmentation/border-padding-overflow-ref.html` for a complete example.
3. Add the entry to `specs/tests.yml` under the right suite.
4. Run a single spec:
   ```bash
   npm run specs -- --project fragmentation -g my-test
   ```

### Running a single suite or test

```bash
# Entire suite
npx playwright test --config specs/playwright.config.js --project at-page

# Single test by name
npx playwright test --config specs/playwright.config.js --project at-page -g awesome

# With trace/HTML report
npx playwright test --config specs/playwright.config.js --reporter=html
```

The HTML report (auto-opened on failure) attaches screenshots for each page plus a per-pixel diff, which is usually the fastest way to see what drifted.

---

## Debugging a spec with `fragment`

The `fragment` bin (installed from `debug/viewer.js`) opens a spec in a headed browser with the fragmentation engine live-injected. Refresh the page to re-run the engine after editing source or CSS.

```bash
# Open a spec in a headed Chromium window
fragment specs/at-page/awesome.html

# Multicol spec
fragment specs/at-page/column-overflow.html --type multicol

# Try cross-browser
fragment specs/at-page/awesome.html --browser firefox
fragment specs/at-page/awesome.html --browser webkit

# View the reference page as-is (no engine injection)
fragment specs/at-page/awesome-ref.html --ref

# Visualize fragment boundaries
fragment specs/at-page/awesome.html --debug
```

Non-interactive modes dump output instead of opening a window:

```bash
# Dump the fragmented HTML (stdout or file)
fragment specs/at-page/awesome.html --html
fragment specs/at-page/awesome.html --html out.html

# Print a per-page inspect report: block sizes, break tokens, element spans, issues
fragment specs/at-page/awesome.html --inspect
fragment specs/at-page/awesome.html --inspect report.txt

# Render to PDF
fragment specs/at-page/awesome.html --pdf book.pdf
```

`fragment --help` lists every flag. Use `--inspect` as the first stop when a spec fails — it surfaces which page a break token ended up on, which elements got split, and any zero-progress warnings — without needing to compare pixel screenshots.

---

### Patterns

**DOM-based test** — wrap a real element, run layout, assert on the result:

```js
import { test, expect } from "../browser-fixture.js";

test("lays out a leaf node", async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { runLayoutGenerator } = await import("/src/layout/layout-driver.js");
		const { BlockContainerAlgorithm } = await import("/src/algorithms/block-container.js");
		const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
		const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

		const container = document.createElement("div");
		container.style.cssText = "position:absolute;left:-9999px;width:600px";
		container.innerHTML = '<div style="height:50px"></div>';
		document.body.appendChild(container);

		const root = new DOMLayoutNode(container.firstElementChild);
		const space = new ConstraintSpace({
			availableInlineSize: 600,
			availableBlockSize: 800,
			fragmentainerBlockSize: 800,
			fragmentationType: "page",
		});

		const { fragment, breakToken } = runLayoutGenerator(
			new BlockContainerAlgorithm(root, space, null),
		);
		container.remove();
		return { blockSize: fragment.blockSize, broke: breakToken !== null };
	});

	expect(result.blockSize).toBe(50);
	expect(result.broke).toBe(false);
});
```

**Mock-node test** — use `test/fixtures/nodes.js` factories (`blockNode`, `inlineNode`, `tableRowNode`, `flexNode`, `gridNode`, `multicolNode`, etc.) to build a tree without touching the DOM. Useful for break scoring, margin collapsing, parallel-flow edge cases.

### Filtering

```bash
# Single file
npx playwright test --config test/playwright.config.js test/layout/block-layout.test.js

# Pattern match on test title
npx playwright test --config test/playwright.config.js -g "forced break"
```

---

## Troubleshooting

- **Spec fails only on CI.** DPR or font-rendering differences. The spec config pins `deviceScaleFactor: 1` and `--font-render-hinting=none`; reproduce with the same flags locally.
- **Spec times out on `waitForSelector("[data-spec-ready]")`.** The engine threw inside `process.js`. Rerun with `fragment <spec>` and open DevTools — the error is also mirrored to `document.documentElement.dataset.specError`.
- **Ref and test page counts don't match.** The spec runner fails fast on `expect(testCount).toBe(refCount)`. Use `--inspect` to see how many fragmentainers the engine produced, then reconcile with the ref.
