# Layout Handlers

Layout handlers extend the fragmentation engine with custom behaviors. A handler is a self-contained object that taps into generic engine hooks during layout and composition. The engine itself is handler-agnostic -- it calls into handlers at defined points without knowing what they do.

## How Handlers Work

A handler hooks into the engine at these points:

0. **Initialization** -- Each flow creates its own instance of every catalog class and calls `handler.init(options, context)` at layout initialization. `options` are the flow's constructor options (plus `isPageBased`); `context` is the flow's `FlowContext` (`handlers`, `cloneMap`, `flow`). Handlers use this for feature detection, reading options, and keeping the context for any layout nodes or parallel flows they create.

1. **CSS rule matching** -- Before measurement begins, the engine walks all CSS rules in a single pass and calls `handler.matchRule(rule, context)` for each leaf style rule. Handlers accumulate state (selectors, descriptors) for use in later hooks. After the walk, `handler.appendRules(rules)` can add rules to one shared sheet appended to the measurement styles.

2. **Content preparation** -- After rule processing and before the measurer segments the content, the engine calls `handler.prepareContent(content)` with the full source content. The content is not yet in the measurement DOM, so `getComputedStyle()` is unavailable; handlers match via selectors accumulated in step 1 or inline styles. Handlers may mutate the content or set [markers](#markers) on it (e.g., `FixedPosition` marks `position: fixed` elements persistent).

3. **Measurement hooks** -- Once the active segment is injected, `beforeMeasurement(contentRoot)` may mutate the live DOM before reflow. After reflow, `afterMeasurementSetup(contentRoot)` can inspect computed layout without mutating it. `getAdoptedSheets()` contributes per-flow sheets to visible composition.

4. **Pre-layout scan** -- Before the normal layout pass, the engine calls `handler.layout()`. The handler scans the root node's children, lays out any it claims (via a provided callback), and returns space reservations. The engine adjusts the available space for remaining content.

5. **Child skip** -- During block container layout, each child is checked against all handlers. If `handler.claim(child)` returns `true`, that child is skipped -- it doesn't consume space in the normal flow.

6. **Post-layout and rendering** -- `afterContentLayout()` can request a revised block-end reservation and trigger another layout pass. Once settled, `afterRender` and any `composeFlowFragment()` callbacks add handler-owned output to the composed fragmentainer.

## Handler Interface

A handler extends `LayoutHandler` and implements whichever methods it needs. All are optional:

```javascript
{
  // Called on the fresh instance a flow creates at layout initialization.
  // Use for feature detection, options, and keeping the flow context.
  init(options, context) -> void,

  // Called per CSS style rule during the centralized rule walk.
  // context.wrappers contains grouping rule preambles (e.g. ["@media screen"]).
  matchRule(rule, context) -> void,

  // Push CSS rule text strings into the array. The registry creates a
  // shared sheet and calls sheet.insertRule() for each.
  appendRules(rules: string[]) -> void,

  // Reset state accumulated from a previous matchRule pass.
  resetRules() -> void,

  // Return true if this handler claims a child node (removes it from flow).
  claim(node) -> boolean,

  // Pre-layout hook. Called once per fragmentainer at the top level.
  // Returns space reservations + an afterRender closure.
  layout(rootNode, constraintSpace, breakToken, layoutChild) -> {
    reservedBlockStart: number,
    reservedBlockEnd: number,
    afterRender: (fragment, contentStyles) => void
  },

  // Called before the child loop in BlockContainerAlgorithm.
  // Returns a layout request descriptor for content to prepend, or null.
  beforeChildren(node, constraintSpace, breakToken) -> {
    node,              // the child node to lay out
    constraintSpace,   // constraint space for the layout
    isRepeated,        // mark the fragment as repeated content
  } | null,

  // Called after processRules() with the full source content, before
  // it is injected into the measurement DOM. Mutate it or set markers.
  prepareContent(content) -> void,

  // Called after content is injected but before the browser reflow.
  // May materialize or mutate measurement DOM.
  beforeMeasurement(contentRoot) -> void,

  // Called after measurement setup and reflow. Probe computed styles here.
  afterMeasurementSetup(contentRoot) -> void,

  // Return per-flow sheets folded into the composite scoped sheet.
  getAdoptedSheets() -> CSSStyleSheet[],

  // Called after content layout completes for a fragmentainer.
  // Inspect the fragment and optionally request additional block-end space.
  // Returning a different reservedBlockEnd triggers a re-layout.
  afterContentLayout(fragment, constraintSpace, inputBreakToken) -> {
    reservedBlockEnd: number,
    afterRender: (fragment, contentStyles) => void
  } | null,

  // Optional handler-owned parallel flow lifecycle.
  getFlow() -> FragmentFlow | null,
  extractFlowChildren(fragment, inputBreakToken, cap) -> {
    children: LayoutNode[],
    pushForward: Element[]
  },
  getFlowCap(constraintSpace) -> number,
  composeFlowFragment(wrapper, fragment, inputBreakToken) -> void,

  // Release resources when the flow is destroyed or handlers reinitialize.
  destroy() -> void,
}
```

The `afterRender` closure captures whatever state the handler needs from `layout()` and composes it when called. The `beforeChildren` hook returns a descriptor — the engine yields the layout on the handler's behalf since handlers can't participate in the generator protocol directly. The `afterContentLayout` hook enables iterative layout: if the returned `reservedBlockEnd` differs from what was used, the engine re-runs layout with the updated reservation.

## Centralized Rule Walk

CSS rules are processed in a single pass by `HandlerRegistry.processRules(styles)`. The walk recurses into grouping rules (`@media`, `@supports`, `@layer`) and dispatches each leaf style rule to every handler's `matchRule()`. This replaces the previous pattern where each handler independently walked all stylesheets.

The `context.wrappers` array tracks the chain of grouping rule preambles, e.g. `["@media screen"]` for a rule inside `@media screen { ... }`. Handlers that re-emit rules preserve these wrappers so grouping-rule context survives.

After the walk, the registry calls `appendRules(rules)` on each handler. Handlers push CSS rule text strings into the array. If any rules are collected, the registry creates a single `CSSStyleSheet`, inserts all rules, and appends it to the styles array before measurement begins.

## Markers

Features cooperate through DOM attribute markers rather than by calling each other. Anything that can touch the content before layout can set them: a handler in `prepareContent()`, or the caller before constructing a `Fragmenter`. Import the helpers from `fragmentainers/handlers`.

| Helper | Attribute | Effect |
| --- | --- | --- |
| `markPersistent(element, owner = "")` | `data-frag-persistent="<owner>"` | The element is included in every measurement segment (e.g. a `position: fixed` header repeated on each page). Applies to **top-level** children of the content only; marking a nested element has no effect. |
| `markNativePseudo(element, "before" \| "after")` | `data-frag-native-pseudo-<pseudo>` | `PseudoElements` leaves that pseudo alone instead of materializing it as a `<frag-pseudo>`. Use it when the pseudo's content must stay native (e.g. a counter rendered by the browser). |

The `owner` value on `data-frag-persistent` lets a handler distinguish its own markers from a caller's when content is re-prepared after a style change: a handler clears only markers carrying its own owner string (`clearPersistent(element, owner)`), and never a caller's (`""`). Markers are ordinary attributes, so they survive cloning into the output and can be styled.

## Registration

All handlers must extend the `LayoutHandler` base class. Register the **class** (not an instance) on the global registry — the engine creates a fresh instance each time a `Fragmenter` initializes, so handler state never leaks between flows.

```javascript
import { LayoutHandler, Fragmenter } from "fragmentainers";

class MyHandler extends LayoutHandler {
	claim(node) {
		/* ... */
	}
}

// Add it to the catalog once, at package load.
Fragmenter.handlers.push(MyHandler);

// Every flow constructed afterwards owns a fresh instance.
const flow = new Fragmenter(content, options);
const instance = flow.handlers.get(MyHandler);
```

`Fragmenter.handlers` is a plain ordered array of handler classes — the one catalog for the page. Fragmentainers fills it with the handlers CSS fragmentation needs; a package built on fragmentainers (pagedjs) appends its own once at import. There is no per-flow configuration: every `Fragmenter` resolves the catalog at construction into its own instances, so two flows never share handler state, and a push after a flow exists affects only flows constructed later.

Resolution rules, applied in list order:

- anything that is not a `LayoutHandler` subclass throws;
- a class listed twice is kept once, at its first position;
- a class that **extends** an earlier entry **replaces** it in place.

That last rule is how a core handler is overridden without disturbing handler order:

```javascript
class PagedFixedPosition extends FixedPosition {
	/* ... */
}
Fragmenter.handlers.push(PagedFixedPosition); // takes FixedPosition's slot
```

Removing a handler is not a supported operation.

## Example: Full-Page Image Handler

The `PageFit` handler removes elements with `--page-fit: fill | contain | cover` from normal flow and positions them to fill the entire fragmentainer.
The image element is pulled out of normal flow. The engine reserves the full page height for it, pushing surrounding content to other pages.

```javascript
class PageFit extends LayoutHandler {
	claim(node) {
		const value = node.getCustomProperty("page-fit");
		return value !== null && VALID_VALUES.has(value);
	}

	layout(rootNode, constraintSpace, breakToken, layoutChild) {
		const placed = [];

		for (const child of rootNode.children) {
			if (!this.claim(child)) continue;
			placed.push({ node: child, fit: child.getCustomProperty("page-fit") });
		}

		return {
			reservedBlockStart: placed.length > 0 ? constraintSpace.fragmentainerBlockSize : 0,
			reservedBlockEnd: 0,
			afterRender(fragment) {
				for (const pf of placed) {
					const clone = pf.node.element.cloneNode(true);
					clone.style.setProperty("width", "100%");
					clone.style.setProperty("height", "100%");
					clone.style.setProperty("object-fit", pf.fit);
					clone.style.setProperty("position", "absolute");
					clone.style.setProperty("inset", "0");
					fragment.style.setProperty("position", "relative");
					fragment.appendChild(clone);
				}
			},
		};
	}
}
```

## Writing Your Own Handler

1. Create a class that extends `LayoutHandler` from `fragmentainers/handlers`.
2. Override `matchRule()` to inspect CSS rules and accumulate selectors or state.
3. Override `claim()`, `layout()`, and/or `beforeChildren()` as needed.
4. Use `node.getCustomProperty("my-prop")` to read CSS custom properties (the `--` prefix is added automatically). This uses the cached `getComputedStyle` on `DOMLayoutNode`, so repeated reads are free.
5. The `layoutChild` callback provided to `layout()` runs a node through the full layout algorithm. Use it to measure elements.
6. Export the class and append it to the catalog: `Fragmenter.handlers.push(MyHandler)`. Every flow creates its own instance.

### Handler Initialization

Handlers can override `init(options, context)` to run setup when a flow initializes — typically feature detection or reading options. Since a fresh instance is created per flow, `init()` is called on a clean object each time. `Fragmenter` additionally injects an `isPageBased` flag (`true` when a `PageResolver` is used or when neither `resolver` nor `constraintSpace` is supplied) so handlers can no-op for non-page flows.

For example, `EmulatePrintPixelRatio` gates its line-height normalization on both browser family and fragmentation mode:

```javascript
class EmulatePrintPixelRatio extends LayoutHandler {
	#enabled = false;

	init({ emulatePrintPixelRatio = true, isPageBased = false } = {}) {
		this.#enabled =
			emulatePrintPixelRatio &&
			isPageBased &&
			typeof navigator !== "undefined" &&
			/\bChrome\//.test(navigator.userAgent);
	}
}
```

## Built-in Handlers

Handlers in the default catalog (`Fragmenter.handlers`, in order):

| Handler                  | Purpose                                                                   | Page-only? |
| ------------------------ | ------------------------------------------------------------------------- | :--------: |
| `RepeatedTableHeader`    | Repeat `<thead>` on continuation pages                                    |     —      |
| `FixedPosition`          | Repeat `position: fixed` elements on every page                           |     —      |
| `StyleResolver`          | Per-element overrides for structural-pseudo rules                         |     —      |
| `EmulatePrintPixelRatio` | Line-height normalization so screen rendering matches DPR-1 layout        |    yes     |
| `BodyRewriter`           | Rewrites `body`/`html` rules to `:scope` and `:host(content-measure) > slot` |    yes     |
| `PseudoElements`         | Materializes `::before` / `::after` as layout objects                       |     —      |

Shipped but not in the default catalog (push them yourself):

| Handler        | Import                                                       | Purpose                                                          |
| -------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| `PageFloat`    | `import { PageFloat } from "fragmentainers/handlers"`        | Page-relative floats (`--float-reference: page`)                 |
| `MutationSync` | `import { MutationSync } from "fragmentainers/handlers"`     | Sync mutations from fragment-container clones back to source     |

Paged-media handlers such as footnotes live in pagedjs, which appends them to the catalog.

To add a handler to the default catalog, add it to `src/handlers/catalog.js`.
