# Layout Modules

Layout modules extend the fragmentation engine with custom behaviors. A module is a self-contained object that taps into generic engine hooks during layout and composition. The engine itself is module-agnostic -- it calls into modules at defined points without knowing what they do.

## How Modules Work

A module hooks into the engine at these points:

0. **Initialization** -- When a module is registered, the engine calls `module.init()`. Modules use this for one-time feature detection (e.g., browser sniffing to enable/disable behavior).

1. **CSS rule matching** -- Before measurement begins, the engine walks all CSS rules in a single pass and calls `module.matchRule(rule, context)` for each leaf style rule. Modules accumulate state (selectors, descriptors) for use in later hooks. After the walk, `module.injectSheets()` can return additional stylesheets to prepend.

2. **Persistent element claim** -- After rule processing, the engine calls `module.claimPersistent(content)`. The module uses state from step 1 to identify elements that must be present in every measurement segment (e.g., `position: fixed` elements).

3. **Pre-layout scan** -- Before the normal layout pass, the engine calls `module.layout()`. The module scans the root node's children, lays out any it claims (via a provided callback), and returns space reservations. The engine adjusts the available space for remaining content.

4. **Child skip** -- During block container layout, each child is checked against all modules. If `module.claim(child)` returns `true`, that child is skipped -- it doesn't consume space in the normal flow.

5. **After-render** -- The module's `layout()` method returns an `afterRender` closure. After the engine composes normal content into the fragmentainer, it calls this closure. The module uses it to inject its own composed output (e.g., absolutely-positioned floats).

## Module Interface

A module extends `LayoutModule` and implements whichever methods it needs. All are optional:

```javascript
{
  // Called once when the module is registered.
  // Use for feature detection or setting internal flags.
  init() -> void,

  // Called per CSS style rule during the centralized rule walk.
  // context.wrappers contains grouping rule preambles (e.g. ["@media screen"]).
  matchRule(rule, context) -> void,

  // Push CSS rule text strings into the array. The registry creates a
  // shared sheet and calls sheet.insertRule() for each.
  appendRules(rules: string[]) -> void,

  // Reset state accumulated from a previous matchRule pass.
  resetRules() -> void,

  // Return true if this module claims a child node (removes it from flow).
  claim(node) -> boolean,

  // Pre-layout hook. Called once per fragmentainer at the top level.
  // Returns space reservations + an afterRender closure.
  layout(rootNode, constraintSpace, breakToken, layoutChild) -> {
    reservedBlockStart: number,
    reservedBlockEnd: number,
    afterRender: (fragment, contentStyles) => void
  },

  // Called before the child loop in layoutBlockContainer.
  // Returns a layout request descriptor for content to prepend, or null.
  beforeChildren(node, constraintSpace, breakToken) -> {
    node,              // the child node to lay out
    constraintSpace,   // constraint space for the layout
    isRepeated,        // mark the fragment as repeated content
  } | null,

  // Called after processRules() with the full content fragment.
  // Return elements that must persist across all measurement segments
  // (e.g., position: fixed elements that repeat on every page).
  claimPersistent(content) -> Element[],

  // Called after content layout completes for a fragmentainer.
  // Inspect the fragment and optionally request additional block-end space.
  // Returning a different reservedBlockEnd triggers a re-layout.
  afterContentLayout(fragment, constraintSpace, inputBreakToken) -> {
    reservedBlockEnd: number,
    afterRender: (fragment, contentStyles) => void
  } | null,
}
```

The `afterRender` closure captures whatever state the module needs from `layout()` and composes it when called. The `beforeChildren` hook returns a descriptor — the engine yields the layout on the module's behalf since modules can't participate in the generator protocol directly. The `afterContentLayout` hook enables iterative layout: if the returned `reservedBlockEnd` differs from what was used, the engine re-runs layout with the updated reservation.

## Centralized Rule Walk

CSS rules are processed in a single pass by `ModuleRegistry.processRules(styles)`. The walk recurses into grouping rules (`@media`, `@supports`, `@layer`) and dispatches each leaf style rule to every module's `matchRule()`. This replaces the previous pattern where each module independently walked all stylesheets in `claimPersistent()`.

The `context.wrappers` array tracks the chain of grouping rule preambles, e.g. `["@media screen"]` for a rule inside `@media screen { ... }`. This is used by the nth-selectors module to reconstruct wrapper context when generating per-fragment override sheets.

After the walk, the registry calls `appendRules(rules)` on each module. Modules push CSS rule text strings into the array. If any rules are collected, the registry creates a single `CSSStyleSheet`, inserts all rules, and prepends it to the styles array before measurement begins.

## Registration

All modules must extend the `LayoutModule` base class. Modules are registered on a global registry — any part of the engine can access them.

```javascript
import { LayoutModule, FragmentedFlow } from "fragmentainers";

class MyModule extends LayoutModule {
	claim(node) {
		/* ... */
	}
}

FragmentedFlow.register(new MyModule());

// Or import the registry directly
import { modules } from "fragmentainers";
modules.register(new MyModule());

// Unregister
FragmentedFlow.remove(myModule);
```

Built-in modules from `src/modules/index.js` are registered automatically at import time.

## Example: Full-Page Image Module

The `PageFit` module removes elements with `--page-fit: fill | contain | cover` from normal flow and positions them to fill the entire fragmentainer.
The image element is pulled out of normal flow. The engine reserves the full page height for it, pushing surrounding content to other pages.

```javascript
const VALID_VALUES = new Set(["fill", "contain", "cover"]);

export const PageFit = {
	claim(node) {
		const value = node.getCustomProperty("page-fit");
		return value !== null && VALID_VALUES.has(value);
	},

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
	},
};
```

## Writing Your Own Module

1. Create a class that extends `LayoutModule` (from `src/modules/module.js`).
2. Override `matchRule()` to inspect CSS rules and accumulate selectors or state.
3. Override `claim()`, `layout()`, and/or `beforeChildren()` as needed.
4. Use `node.getCustomProperty("my-prop")` to read CSS custom properties (the `--` prefix is added automatically). This uses the cached `getComputedStyle` on `DOMLayoutNode`, so repeated reads are free.
5. The `layoutChild` callback provided to `layout()` runs a node through the full layout algorithm. Use it to measure elements.
6. Export a singleton instance and register it via `FragmentedFlow.register()`.

### Module Initialization

Modules can override `init()` to run one-time setup when registered — typically feature detection. For example, the `NormalizeLayoutModule` uses `init()` to detect Blink browsers and disables itself elsewhere:

```javascript
class NormalizeLayoutModule extends LayoutModule {
	#enabled = false;

	init() {
		this.#enabled =
			typeof navigator !== "undefined" && /\bChrome\//.test(navigator.userAgent);
	}
}
```

## Built-in Modules

Built-in modules (in `src/modules/`) are registered by default.

To add a built-in module, export it from `src/modules/index.js` -- it will be registered automatically.
