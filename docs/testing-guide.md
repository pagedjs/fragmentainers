# Testing Guide

How to write and run tests for `fragmentainers`.

---

## Test Architecture

The test suite is split into two tiers:

| Tier                            | Environment | Purpose                                                                           | Speed             |
| ------------------------------- | ----------- | --------------------------------------------------------------------------------- | ----------------- |
| **Tests** (`test/**/*.test.js`) | Playwright  | Layout algorithms, break scoring, tokens, DOM measurement, compositor, end-to-end | ~2s for 440 tests |
| **Spec tests** (`specs/`)       | Playwright  | Visual comparison against reference HTML                                          | ~3-5 min          |

All tests run in real browsers — there is no separate Node environment. All test files use the `.test.js` extension. Tests are organized into subdirectories by module:

- `test/core/` — break scoring, tokens, counter state, reflow, overflow, fragmentainer layout
- `test/layout/` — block, inline, multicol, flex, grid, table, forced breaks, monolithic
- `test/compositor/` — composition, nth-selectors
- `test/modules/` — page floats, footnotes, fixed position, repeated headers
- `test/atpage/` — @page rule resolution
- `test/dom/` — DOM measurement, layout node, inline collection
- `test/fixtures/` — mock node factories

---

## Running Tests

```bash
npm test               # Run ESLint + all tests
npm run specs          # All spec tests
```

### Single spec suite

```bash
npx playwright test --config specs/playwright.config.js --project css-page
```

### Filtering tests

```bash
# Run a specific test file
npx vitest run test/layout/block-layout.test.js

# Run tests matching a pattern
npx vitest run -t "forced break"
```

---

## Unit Test Patterns

Unit tests use mock node factories from `test/fixtures/nodes.js`. These create plain objects matching the `LayoutNode` interface without requiring a DOM.

### Available Factories

| Factory               | Creates                          | Key Options                                                         |
| --------------------- | -------------------------------- | ------------------------------------------------------------------- |
| `blockNode()`         | Block-level element              | `blockSize`, `children`, `breakBefore`, `breakAfter`, `breakInside` |
| `replacedNode()`      | Replaced element (monolithic)    | `blockSize`                                                         |
| `scrollableNode()`    | Scrollable element (monolithic)  | `blockSize`, `children`                                             |
| `inlineNode()`        | Inline formatting context        | `inlineItemsData`, `lineHeight`, `measureText`                      |
| `tableRowNode()`      | Table row (parallel flows)       | `cells`                                                             |
| `multicolNode()`      | Multicol container               | `columnCount`, `columnWidth`, `columnGap`, `columnFill`             |
| `flexNode()`          | Flex container                   | `flexDirection`, `flexWrap`                                         |
| `gridNode()`          | Grid container                   | `children` (use `gridItemNode` for items)                           |
| `gridItemNode()`      | Grid item with row placement     | `blockSize`, `gridRowStart`                                         |
| `textToInlineItems()` | InlineItemsData from text string | Plain text string                                                   |

### Example: Block Fragmentation

```javascript
import { describe, it, expect } from "vitest";
import { createFragments, ConstraintSpace } from "../../src/index.js";
import { blockNode } from "./fixtures/nodes.js";

describe("block fragmentation", () => {
	it("splits content across two fragmentainers", () => {
		const root = blockNode({
			children: [blockNode({ blockSize: 300 }), blockNode({ blockSize: 300 })],
		});

		const fragments = createFragments(
			root,
			new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 400,
				fragmentainerBlockSize: 400,
				fragmentationType: "page",
			}),
		);

		expect(fragments).toHaveLength(2);
		expect(fragments[0].childFragments).toHaveLength(1);
		expect(fragments[1].childFragments).toHaveLength(1);
	});
});
```

### Example: Forced Breaks

```javascript
it("handles break-before: page", () => {
	const root = blockNode({
		children: [blockNode({ blockSize: 100 }), blockNode({ blockSize: 100, breakBefore: "page" })],
	});

	const fragments = createFragments(
		root,
		new ConstraintSpace({
			availableInlineSize: 600,
			availableBlockSize: 1000,
			fragmentainerBlockSize: 1000,
			fragmentationType: "page",
		}),
	);

	expect(fragments).toHaveLength(2);
});
```

### Example: Inline Content

```javascript
import { inlineNode, textToInlineItems } from "./fixtures/nodes.js";

it("breaks text across fragmentainers", () => {
	const root = blockNode({
		children: [
			inlineNode({
				inlineItemsData: textToInlineItems("word ".repeat(50)),
				lineHeight: 20,
				measureText: (text) => text.length * 8,
				availableInlineSize: 200,
			}),
		],
	});

	const fragments = createFragments(
		root,
		new ConstraintSpace({
			availableInlineSize: 200,
			availableBlockSize: 100,
			fragmentainerBlockSize: 100,
			fragmentationType: "page",
		}),
	);

	expect(fragments.length).toBeGreaterThan(1);
	expect(fragments[0].childFragments[0].lineCount).toBeGreaterThan(0);
});
```

### Example: Parallel Flows (Table Row)

```javascript
import { tableRowNode } from "./fixtures/nodes.js";

it("all cells get break tokens when one overflows", () => {
	const root = blockNode({
		children: [
			tableRowNode({
				cells: [blockNode({ blockSize: 100 }), blockNode({ blockSize: 500 })],
			}),
		],
	});

	const fragments = createFragments(
		root,
		new ConstraintSpace({
			availableInlineSize: 400,
			availableBlockSize: 300,
			fragmentainerBlockSize: 300,
			fragmentationType: "page",
		}),
	);

	const rowToken = fragments[0].breakToken.childBreakTokens[0];
	expect(rowToken.childBreakTokens).toHaveLength(2);
	expect(rowToken.childBreakTokens[0].isAtBlockEnd).toBe(true);
});
```

### Example: CSS Properties

Any `LayoutNode` property can be overridden:

```javascript
const avoidBreak = blockNode({ blockSize: 100, breakAfter: "avoid" });
const pageBreak = blockNode({ blockSize: 100, breakBefore: "page" });
const clonedBox = blockNode({
	blockSize: 200,
	boxDecorationBreak: "clone",
	paddingBlockStart: 10,
	paddingBlockEnd: 10,
	children: [blockNode({ blockSize: 180 })],
});
```

---

## DOM-Dependent Test Patterns

Some tests exercise real DOM APIs:

- **DOM measurement** (`getBoundingClientRect`, `Range.getClientRects`)
- **Layout node properties** (`DOMLayoutNode` wrapping real elements)
- **Fragment building** (cloning elements, shadow DOM)
- **End-to-end fragmentation** (`FragmentedFlow.flow()` with real content)
- **Inline layout with real text** (actual font metrics, word wrapping)

```javascript
// test/core/flow.test.js
import { describe, it, expect, afterEach } from "vitest";
import { FragmentedFlow } from "../../src/core/fragmented-flow.js";

describe("flow", () => {
	let layout;

	afterEach(() => {
		layout?.destroy();
	});

	it("produces fragment containers with shadow DOM", () => {
		const template = document.createElement("template");
		template.innerHTML = "<p>Hello</p><p>World</p>";

		layout = new FragmentedFlow(template.content, {
			width: 200,
			height: 50,
		});
		const flow = layout.flow();

		expect(flow.length).toBeGreaterThan(0);
		expect(flow[0].tagName.toLowerCase()).toBe("fragment-container");
	});
});
```

---

## Spec Tests (Visual Comparison)

### How It Works

Each spec test has a test HTML file and a reference HTML file (`-ref.html`). The shared processor (`specs/helpers/process.js`) runs fragmentation on the test file, then Playwright screenshots both the processed test and the static reference and compares them for pixel differences.

### Test Suites

### Writing a New Spec Test

1. **Create the test HTML** (`specs/fragmentation/my-test.html`):

```html
<!DOCTYPE html>
<style>
	@page {
		size: 200px 100px;
		margin: 0;
	}
	div {
		height: 60px;
		background: blue;
	}
</style>
<div></div>
<div></div>
```

2. **Create the reference HTML** (`specs/fragmentation/my-test-ref.html`):

```html
<!DOCTYPE html>
<style>
	.page {
		width: 200px;
		height: 100px;
		overflow: hidden;
	}
	.body {
		width: 200px;
		height: 100px;
	}
	div {
		height: 60px;
		background: blue;
	}
</style>
<page-container>
		<div></div>
	</div>
</page-container>
<page-container>
	<div class="body">
		<div></div>
	</div>
</page-container>
```

3. **Add to the manifest** (`specs/tests.yml`):

```yaml
- fragmentation
  - name: my-test
  - type: print # runs paginate on the content
```

4. **Run the test**:

```bash
npx playwright test --config specs/playwright.config.js --project fragmentation -g "my-test"
```

### Debugging Failures

When a spec test fails, Playwright saves diff images to `test-results/spec-diffs/`. Each diff shows:

- **Expected** — Screenshot of the reference HTML
- **Actual** — Screenshot of the processed test HTML
- **Diff** — Pixel differences highlighted

To visually inspect a specific test, open it in the debug viewer:

```bash
npm run serve
# Open http://localhost:8080/specs/fragmentation/my-test.html
```
