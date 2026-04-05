import { test, expect } from "../browser-fixture.js";

test.describe("parseCounterDirective", () => {
	test("returns [] for null", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/core/counter-state.js");
			return parseCounterDirective(null);
		});
		expect(result).toEqual([]);
	});

	test("returns [] for 'none'", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/core/counter-state.js");
			return parseCounterDirective("none");
		});
		expect(result).toEqual([]);
	});

	test("returns [] for empty string", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/core/counter-state.js");
			return parseCounterDirective("");
		});
		expect(result).toEqual([]);
	});

	test("parses a single counter with value", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/core/counter-state.js");
			return parseCounterDirective("paragraph 0");
		});
		expect(result).toEqual([{ name: "paragraph", value: 0 }]);
	});

	test("parses a single counter with non-zero value", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/core/counter-state.js");
			return parseCounterDirective("paragraph 3");
		});
		expect(result).toEqual([{ name: "paragraph", value: 3 }]);
	});

	test("parses multiple counters", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/core/counter-state.js");
			return parseCounterDirective("paragraph 0 section 0");
		});
		expect(result).toEqual([
			{ name: "paragraph", value: 0 },
			{ name: "section", value: 0 },
		]);
	});

	test("parses counter name without explicit value as 0", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/core/counter-state.js");
			return parseCounterDirective("paragraph");
		});
		expect(result).toEqual([{ name: "paragraph", value: 0 }]);
	});

	test("filters out list-item counter", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/core/counter-state.js");
			return parseCounterDirective("list-item 0 paragraph 0");
		});
		expect(result).toEqual([{ name: "paragraph", value: 0 }]);
	});

	test("returns [] when only list-item", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/core/counter-state.js");
			return parseCounterDirective("list-item 0");
		});
		expect(result).toEqual([]);
	});

	test("parses negative values", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseCounterDirective } = await import("/src/core/counter-state.js");
			return parseCounterDirective("paragraph -1");
		});
		expect(result).toEqual([{ name: "paragraph", value: -1 }]);
	});
});

test.describe("CounterState", () => {
	test("starts empty", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/core/counter-state.js");
			const state = new CounterState();
			return { isEmpty: state.isEmpty(), snapshot: state.snapshot() };
		});
		expect(result.isEmpty).toBe(true);
		expect(result.snapshot).toEqual({});
	});

	test("applyReset sets counter value", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/core/counter-state.js");
			const state = new CounterState();
			state.applyReset([{ name: "p", value: 0 }]);
			return { isEmpty: state.isEmpty(), snapshot: state.snapshot() };
		});
		expect(result.isEmpty).toBe(false);
		expect(result.snapshot).toEqual({ p: 0 });
	});

	test("applyIncrement on empty state starts from 0", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/core/counter-state.js");
			const state = new CounterState();
			state.applyIncrement([{ name: "p", value: 1 }]);
			return state.snapshot();
		});
		expect(result).toEqual({ p: 1 });
	});

	test("accumulates increments", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/core/counter-state.js");
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
			const { CounterState } = await import("/src/core/counter-state.js");
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
			const { CounterState } = await import("/src/core/counter-state.js");
			const state = new CounterState();
			state.applyIncrement([{ name: "p", value: 5 }]);
			return state.snapshot();
		});
		expect(result).toEqual({ p: 5 });
	});

	test("reset overwrites previous value", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/core/counter-state.js");
			const state = new CounterState();
			state.applyIncrement([{ name: "p", value: 10 }]);
			state.applyReset([{ name: "p", value: 0 }]);
			return state.snapshot();
		});
		expect(result).toEqual({ p: 0 });
	});

	test("snapshot returns a frozen copy", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/core/counter-state.js");
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
			const { CounterState } = await import("/src/core/counter-state.js");
			const state = new CounterState();
			state.restore({ p: 5, s: 2 });
			return state.snapshot();
		});
		expect(result).toEqual({ p: 5, s: 2 });
	});

	test("restore() clears existing state", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/core/counter-state.js");
			const state = new CounterState();
			state.applyReset([{ name: "old", value: 99 }]);
			state.restore({ p: 1 });
			return state.snapshot();
		});
		expect(result).toEqual({ p: 1 });
	});

	test("restore(null) clears all counters", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/core/counter-state.js");
			const state = new CounterState();
			state.applyReset([{ name: "p", value: 5 }]);
			state.restore(null);
			return state.isEmpty();
		});
		expect(result).toBe(true);
	});

	test("accumulates after restore", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState } = await import("/src/core/counter-state.js");
			const state = new CounterState();
			state.restore({ p: 3 });
			state.applyIncrement([{ name: "p", value: 1 }]);
			return state.snapshot();
		});
		expect(result).toEqual({ p: 4 });
	});
});

test.describe("walkFragmentTree", () => {
	test("applies counter-reset and counter-increment for fresh elements", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState, walkFragmentTree } = await import("/src/core/counter-state.js");
			const { PhysicalFragment } = await import("/src/core/fragment.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			function frag(node, children = [], bt = null) {
				const f = new PhysicalFragment(node, 100, children);
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
			const { CounterState, walkFragmentTree } = await import("/src/core/counter-state.js");
			const { PhysicalFragment } = await import("/src/core/fragment.js");
			const { BlockBreakToken } = await import("/src/core/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			function frag(node, children = [], bt = null) {
				const f = new PhysicalFragment(node, 100, children);
				f.breakToken = bt;
				return f;
			}

			const section = blockNode({ debugName: "section", counterReset: "paragraph 0" });
			const p1 = blockNode({ debugName: "p1", counterIncrement: "paragraph 1" });

			const sectionBT = new BlockBreakToken(section);
			const tree = frag(section, [frag(p1)]);
			const state = new CounterState();
			walkFragmentTree(tree, sectionBT, state);
			return state.snapshot();
		});
		expect(result).toEqual({ paragraph: 1 });
	});

	test("skips both parent and child when both are continuations", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState, walkFragmentTree } = await import("/src/core/counter-state.js");
			const { PhysicalFragment } = await import("/src/core/fragment.js");
			const { BlockBreakToken } = await import("/src/core/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			function frag(node, children = [], bt = null) {
				const f = new PhysicalFragment(node, 100, children);
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
			const { CounterState, walkFragmentTree } = await import("/src/core/counter-state.js");
			const { PhysicalFragment } = await import("/src/core/fragment.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			function frag(node, children = [], bt = null) {
				const f = new PhysicalFragment(node, 100, children);
				f.breakToken = bt;
				return f;
			}

			const root = blockNode({ debugName: "root" });
			const lineFragment = new PhysicalFragment(null, 20);
			const p1 = blockNode({ debugName: "p1", counterIncrement: "paragraph 1" });

			const tree = frag(root, [lineFragment, frag(p1)]);
			const state = new CounterState();
			walkFragmentTree(tree, null, state);
			return state.snapshot();
		});
		expect(result).toEqual({ paragraph: 1 });
	});

	test("accumulates across multiple calls (simulating fragmentainers)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { CounterState, walkFragmentTree } = await import("/src/core/counter-state.js");
			const { PhysicalFragment } = await import("/src/core/fragment.js");
			const { BlockBreakToken } = await import("/src/core/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			function frag(node, children = [], bt = null) {
				const f = new PhysicalFragment(node, 100, children);
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
});
