import { test, expect } from "../browser-fixture.js";

test.describe("parseCounterDirective", () => {
	test("returns [] for null", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/fragmentation/counter-state.js");
			return parseCounterDirective(null);
		});
		expect(result).toEqual([]);
	});

	test("returns [] for 'none'", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/fragmentation/counter-state.js");
			return parseCounterDirective("none");
		});
		expect(result).toEqual([]);
	});

	test("returns [] for empty string", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/fragmentation/counter-state.js");
			return parseCounterDirective("");
		});
		expect(result).toEqual([]);
	});

	test("parses a single counter with value", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/fragmentation/counter-state.js");
			return parseCounterDirective("paragraph 0");
		});
		expect(result).toEqual([{ name: "paragraph", value: 0 }]);
	});

	test("parses a single counter with non-zero value", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/fragmentation/counter-state.js");
			return parseCounterDirective("paragraph 3");
		});
		expect(result).toEqual([{ name: "paragraph", value: 3 }]);
	});

	test("parses multiple counters", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/fragmentation/counter-state.js");
			return parseCounterDirective("paragraph 0 section 0");
		});
		expect(result).toEqual([
			{ name: "paragraph", value: 0 },
			{ name: "section", value: 0 },
		]);
	});

	test("parses counter name without explicit value as 0", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/fragmentation/counter-state.js");
			return parseCounterDirective("paragraph");
		});
		expect(result).toEqual([{ name: "paragraph", value: 0 }]);
	});

	test("filters out list-item counter", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/fragmentation/counter-state.js");
			return parseCounterDirective("list-item 0 paragraph 0");
		});
		expect(result).toEqual([{ name: "paragraph", value: 0 }]);
	});

	test("returns [] when only list-item", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/fragmentation/counter-state.js");
			return parseCounterDirective("list-item 0");
		});
		expect(result).toEqual([]);
	});

	test("filters engine-owned custom-property counter names", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/fragmentation/counter-state.js");
			return parseCounterDirective("--paged-tc-1 4 chapter 2 --private 8");
		});
		expect(result).toEqual([{ name: "chapter", value: 2 }]);
	});

	test("uses the caller's default for omitted integers", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/fragmentation/counter-state.js");
			return {
				reset: parseCounterDirective("chapter"),
				increment: parseCounterDirective("chapter", 1),
			};
		});
		expect(result.reset).toEqual([{ name: "chapter", value: 0 }]);
		expect(result.increment).toEqual([{ name: "chapter", value: 1 }]);
	});

	test("parses negative values", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/fragmentation/counter-state.js");
			return parseCounterDirective("paragraph -1");
		});
		expect(result).toEqual([{ name: "paragraph", value: -1 }]);
	});
});

test.describe("CounterState", () => {
	test("starts empty", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/fragmentation/counter-state.js");
			const state = new CounterState();
			return { isEmpty: state.isEmpty(), snapshot: state.snapshot() };
		});
		expect(result.isEmpty).toBe(true);
		expect(result.snapshot).toEqual({});
	});

	test("applyReset sets counter value", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/fragmentation/counter-state.js");
			const state = new CounterState();
			state.applyReset([{ name: "p", value: 0 }]);
			return { isEmpty: state.isEmpty(), snapshot: state.snapshot() };
		});
		expect(result.isEmpty).toBe(false);
		expect(result.snapshot).toEqual({ p: 0 });
	});

	test("applyIncrement on empty state starts from 0", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/fragmentation/counter-state.js");
			const state = new CounterState();
			state.applyIncrement([{ name: "p", value: 1 }]);
			return state.snapshot();
		});
		expect(result).toEqual({ p: 1 });
	});

	test("accumulates increments", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/fragmentation/counter-state.js");
			const state = new CounterState();
			state.applyReset([{ name: "p", value: 0 }]);
			state.applyIncrement([{ name: "p", value: 1 }]);
			state.applyIncrement([{ name: "p", value: 1 }]);
			return state.snapshot();
		});
		expect(result).toEqual({ p: 2 });
	});

	test("handles multiple counters", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/fragmentation/counter-state.js");
			const state = new CounterState();
			state.applyReset([
				{ name: "p", value: 0 },
				{ name: "s", value: 0 },
			]);
			state.applyIncrement([{ name: "p", value: 1 }]);
			return state.snapshot();
		});
		expect(result).toEqual({ p: 1, s: 0 });
	});

	test("handles increment by non-1 value", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/fragmentation/counter-state.js");
			const state = new CounterState();
			state.applyIncrement([{ name: "p", value: 5 }]);
			return state.snapshot();
		});
		expect(result).toEqual({ p: 5 });
	});

	test("reset overwrites previous value", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/fragmentation/counter-state.js");
			const state = new CounterState();
			state.applyIncrement([{ name: "p", value: 10 }]);
			state.applyReset([{ name: "p", value: 0 }]);
			return state.snapshot();
		});
		expect(result).toEqual({ p: 0 });
	});

	test("snapshot returns a frozen copy", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/fragmentation/counter-state.js");
			const state = new CounterState();
			state.applyReset([{ name: "p", value: 0 }]);
			const snap = state.snapshot();
			const isFrozen = Object.isFrozen(snap);
			state.applyIncrement([{ name: "p", value: 1 }]);
			return { isFrozen, snapP: snap.p };
		});
		expect(result.isFrozen).toBe(true);
		expect(result.snapP).toBe(0);
	});

	test("restore() populates counters from a snapshot", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/fragmentation/counter-state.js");
			const state = new CounterState();
			state.restore({ p: 5, s: 2 });
			return state.snapshot();
		});
		expect(result).toEqual({ p: 5, s: 2 });
	});

	test("restore() clears existing state", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/fragmentation/counter-state.js");
			const state = new CounterState();
			state.applyReset([{ name: "old", value: 99 }]);
			state.restore({ p: 1 });
			return state.snapshot();
		});
		expect(result).toEqual({ p: 1 });
	});

	test("restore(null) clears all counters", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/fragmentation/counter-state.js");
			const state = new CounterState();
			state.applyReset([{ name: "p", value: 5 }]);
			state.restore(null);
			return state.isEmpty();
		});
		expect(result).toBe(true);
	});

	test("accumulates after restore", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/fragmentation/counter-state.js");
			const state = new CounterState();
			state.restore({ p: 3 });
			state.applyIncrement([{ name: "p", value: 1 }]);
			return state.snapshot();
		});
		expect(result).toEqual({ p: 4 });
	});

	test("counter-set updates the innermost counter and creates a missing counter", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/fragmentation/counter-state.js");
			const state = new CounterState();
			const outer = {};
			const inner = {};
			state.applyReset([{ name: "chapter", value: 1 }], outer);
			state.applyReset([{ name: "chapter", value: 10 }], inner);
			state.applySet([{ name: "chapter", value: 12 }], inner);
			state.applySet([{ name: "figure", value: 4 }], inner);
			return {
				chapter: state.value("chapter"),
				chapters: state.values("chapter"),
				figure: state.value("figure"),
			};
		});
		expect(result).toEqual({ chapter: 12, chapters: [1, 12], figure: 4 });
	});

	test("same-scope resets replace while descendant resets nest", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/fragmentation/counter-state.js");
			const state = new CounterState();
			const documentScope = {};
			const sectionScope = {};
			state.applyReset([{ name: "chapter", value: 1 }], documentScope);
			state.applyReset([{ name: "chapter", value: 2 }], documentScope);
			const afterSibling = state.values("chapter");
			state.applyReset([{ name: "chapter", value: 10 }], sectionScope);
			const nested = state.values("chapter");
			state.closeScope(sectionScope);
			return {
				afterSibling,
				nested,
				afterClose: state.values("chapter"),
			};
		});
		expect(result.afterSibling).toEqual([2]);
		expect(result.nested).toEqual([2, 10]);
		expect(result.afterClose).toEqual([2]);
	});

	test("snapshot preserves scoped stacks and restores them independently", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState, counterValue, counterValues } = await import(
				"/src/fragmentation/counter-state.js"
			);
			const outer = {};
			const inner = {};
			const state = new CounterState();
			state.applyReset([{ name: "chapter", value: 2 }], outer);
			state.applyReset([{ name: "chapter", value: 7 }], inner);
			const snapshot = state.snapshot();
			const restored = new CounterState();
			restored.restore(snapshot);
			restored.applyIncrement([{ name: "chapter", value: 1 }]);
			const restoredValues = restored.values("chapter");
			restored.closeScope(inner);
			return {
				isFrozen: Object.isFrozen(snapshot),
				valuesFrozen: Object.isFrozen(counterValues(snapshot, "chapter")),
				scalarProjection: snapshot.chapter,
				snapshotValue: counterValue(snapshot, "chapter"),
				snapshotValues: counterValues(snapshot, "chapter"),
				restoredValues,
				afterClose: restored.values("chapter"),
			};
		});
		expect(result).toEqual({
			isFrozen: true,
			valuesFrozen: true,
			scalarProjection: 7,
			snapshotValue: 7,
			snapshotValues: [2, 7],
			restoredValues: [2, 8],
			afterClose: [2],
		});
	});

	test("direct operations also ignore excluded names", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/fragmentation/counter-state.js");
			const state = new CounterState();
			state.applyReset([
				{ name: "list-item", value: 2 },
				{ name: "--paged-tc-1", value: 3 },
			]);
			state.applyIncrement([{ name: "--paged-tc-2", value: 1 }]);
			state.applySet([{ name: "--paged-tc-3", value: 4 }]);
			return { empty: state.isEmpty(), snapshot: state.snapshot() };
		});
		expect(result).toEqual({ empty: true, snapshot: {} });
	});
});

test.describe("walkFragmentTree", () => {
	test("applies counter-reset and counter-increment for fresh elements", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState, walkFragmentTree } = await import("/src/fragmentation/counter-state.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			function frag(node, children = [], bt = null) {
				const f = new Fragment(node, 100, children);
				f.breakToken = bt;
				return f;
			}

			const section = blockNode({ debugName: "section", counterReset: "paragraph 0" });
			const p1 = blockNode({ debugName: "p1", counterIncrement: "paragraph 1" });
			const p2 = blockNode({ debugName: "p2", counterIncrement: "paragraph 1" });

			const tree = frag(section, [frag(p1), frag(p2)]);
			const state = new CounterState();
			walkFragmentTree(tree, null, state);
			return state.snapshot();
		});
		expect(result).toEqual({ paragraph: 2 });
	});

	test("skips counter operations on continuations", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState, walkFragmentTree } = await import("/src/fragmentation/counter-state.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			function frag(node, children = [], bt = null) {
				const f = new Fragment(node, 100, children);
				f.breakToken = bt;
				return f;
			}

			const section = blockNode({ debugName: "section", counterReset: "paragraph 0" });
			const p1 = blockNode({ debugName: "p1", counterIncrement: "paragraph 1" });

			const sectionBT = new BlockBreakToken(section);
			const tree = frag(section, [frag(p1)], sectionBT);
			const state = new CounterState();
			walkFragmentTree(tree, sectionBT, state);
			return state.snapshot();
		});
		expect(result).toEqual({ paragraph: 1 });
	});

	test("skips both parent and child when both are continuations", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState, walkFragmentTree } = await import("/src/fragmentation/counter-state.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			function frag(node, children = [], bt = null) {
				const f = new Fragment(node, 100, children);
				f.breakToken = bt;
				return f;
			}

			const section = blockNode({ debugName: "section", counterReset: "paragraph 0" });
			const p1 = blockNode({ debugName: "p1", counterIncrement: "paragraph 1" });

			const p1BT = new BlockBreakToken(p1);
			const sectionBT = new BlockBreakToken(section);
			sectionBT.childBreakTokens = [p1BT];

			const tree = frag(section, [frag(p1)]);
			const state = new CounterState();
			walkFragmentTree(tree, sectionBT, state);
			return state.snapshot();
		});
		expect(result).toEqual({});
	});

	test("skips fragments with null node", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState, walkFragmentTree } = await import("/src/fragmentation/counter-state.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			function frag(node, children = [], bt = null) {
				const f = new Fragment(node, 100, children);
				f.breakToken = bt;
				return f;
			}

			const root = blockNode({ debugName: "root" });
			const lineFragment = new Fragment(null, 20);
			const p1 = blockNode({ debugName: "p1", counterIncrement: "paragraph 1" });

			const tree = frag(root, [lineFragment, frag(p1)], new BlockBreakToken(root));
			const state = new CounterState();
			walkFragmentTree(tree, null, state);
			return state.snapshot();
		});
		expect(result).toEqual({ paragraph: 1 });
	});

	test("accumulates across multiple calls (simulating fragmentainers)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState, walkFragmentTree } = await import("/src/fragmentation/counter-state.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			function frag(node, children = [], bt = null) {
				const f = new Fragment(node, 100, children);
				f.breakToken = bt;
				return f;
			}

			const section = blockNode({ debugName: "section", counterReset: "paragraph 0" });
			const p1 = blockNode({ debugName: "p1", counterIncrement: "paragraph 1" });
			const p2 = blockNode({ debugName: "p2", counterIncrement: "paragraph 1" });
			const p3 = blockNode({ debugName: "p3", counterIncrement: "paragraph 1" });

			const state = new CounterState();

			const bt = new BlockBreakToken(section);
			const tree1 = frag(section, [frag(p1), frag(p2)], bt);
			walkFragmentTree(tree1, null, state);
			const snap1 = state.snapshot();

			const sectionBT = new BlockBreakToken(section);
			const tree2 = frag(section, [frag(p3)]);
			walkFragmentTree(tree2, sectionBT, state);
			const snap2 = state.snapshot();

			return { snap1, snap2 };
		});
		expect(result.snap1).toEqual({ paragraph: 2 });
		expect(result.snap2).toEqual({ paragraph: 3 });
	});

	test("applies reset, set, then increment on the same element", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState, walkFragmentTree } = await import("/src/fragmentation/counter-state.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const node = blockNode({
				counterReset: "chapter 2",
				counterSet: "chapter 5",
				counterIncrement: "chapter 3",
			});
			const fragment = new Fragment(node, 100);
			const state = new CounterState();
			walkFragmentTree(fragment, null, state);
			return state.value("chapter");
		});
		expect(result).toBe(8);
	});

	test("closes descendant scopes before returning to an outer sibling", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState, walkFragmentTree } = await import("/src/fragmentation/counter-state.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const outer = blockNode({ counterReset: "chapter 0" });
			const section = blockNode();
			const inner = blockNode({ counterReset: "chapter 10", counterIncrement: "chapter 1" });
			const sibling = blockNode({ counterIncrement: "chapter 1" });
			const sectionFragment = new Fragment(section, 50, [new Fragment(inner, 20)]);
			const rootFragment = new Fragment(outer, 100, [sectionFragment, new Fragment(sibling, 20)]);
			// Retain the document scope so the final scalar remains observable.
			rootFragment.breakToken = new BlockBreakToken(outer);

			const state = new CounterState();
			walkFragmentTree(rootFragment, null, state);
			return { value: state.value("chapter"), values: state.values("chapter") };
		});
		expect(result).toEqual({ value: 1, values: [1] });
	});

	test("retains active scopes across a continuation and closes them when it finishes", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { CounterState, walkFragmentTree } = await import("/src/fragmentation/counter-state.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const doc = blockNode();
			const outer = blockNode({ counterReset: "chapter 0" });
			const section = blockNode({ counterReset: "chapter 10" });
			const item = blockNode({ counterIncrement: "chapter 1" });

			const itemToken = new BlockBreakToken(item);
			const sectionToken = new BlockBreakToken(section);
			sectionToken.childBreakTokens = [itemToken];
			const outerToken = new BlockBreakToken(outer);
			outerToken.childBreakTokens = [sectionToken];
			const docToken = new BlockBreakToken(doc);
			docToken.childBreakTokens = [outerToken];

			const firstItem = new Fragment(item, 20);
			firstItem.breakToken = itemToken;
			const firstSection = new Fragment(section, 50, [firstItem]);
			firstSection.breakToken = sectionToken;
			const firstOuter = new Fragment(outer, 100, [firstSection]);
			firstOuter.breakToken = outerToken;
			const firstDoc = new Fragment(doc, 100, [firstOuter]);
			firstDoc.breakToken = docToken;

			const state = new CounterState();
			walkFragmentTree(firstDoc, null, state);
			const afterFirst = state.values("chapter");

			const lastItem = new Fragment(item, 20);
			const lastSection = new Fragment(section, 50, [lastItem]);
			const lastOuter = new Fragment(outer, 100, [lastSection]);
			const lastDoc = new Fragment(doc, 100, [lastOuter]);
			walkFragmentTree(lastDoc, docToken, state);
			return { afterFirst, afterLast: state.values("chapter") };
		});
		expect(result.afterFirst).toEqual([0, 11]);
		expect(result.afterLast).toEqual([0]);
	});

	test("keeps document-level scopes open when the root fragment completes", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState, walkFragmentTree } = await import("/src/fragmentation/counter-state.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const root = blockNode();
			const first = blockNode({ counterReset: "chapter 0", counterIncrement: "chapter 1" });
			const second = blockNode({ counterIncrement: "chapter 1" });
			const rootFragment = new Fragment(root, 100, [
				new Fragment(first, 20),
				new Fragment(second, 20),
			]);

			const state = new CounterState();
			walkFragmentTree(rootFragment, null, state);
			return state.values("chapter");
		});
		expect(result).toEqual([2]);
	});

	test("keeps DOM-parent keying for children promoted out of a top-level display: contents box", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { CounterState, walkFragmentTree } = await import("/src/fragmentation/counter-state.js");
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="display:contents">
        <div style="height:20px;counter-reset:chapter 5;counter-increment:chapter 1;margin:0;padding:0"></div>
      </div>
      <div style="height:20px;counter-increment:chapter 1;margin:0;padding:0"></div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 500,
					fragmentainerBlockSize: 500,
					fragmentationType: "page",
				}),
			);

			const state = new CounterState();
			walkFragmentTree(pages[0], null, state, container);
			const values = state.values("chapter");
			container.remove();
			return { pageCount: pages.length, values };
		});
		expect(result.pageCount).toBe(1);
		expect(result.values).toEqual([1]);
	});
});
