import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCounterDirective, CounterState, walkFragmentTree } from "../src/counter-state.js";
import { PhysicalFragment } from "../src/fragment.js";
import { BlockBreakToken } from "../src/tokens.js";
import { blockNode } from "./fixtures/nodes.js";

// ---------------------------------------------------------------------------
// parseCounterDirective
// ---------------------------------------------------------------------------

describe("parseCounterDirective", () => {
  it("returns [] for null", () => {
    assert.deepStrictEqual(parseCounterDirective(null), []);
  });

  it("returns [] for 'none'", () => {
    assert.deepStrictEqual(parseCounterDirective("none"), []);
  });

  it("returns [] for empty string", () => {
    assert.deepStrictEqual(parseCounterDirective(""), []);
  });

  it("parses a single counter with value", () => {
    assert.deepStrictEqual(parseCounterDirective("paragraph 0"), [
      { name: "paragraph", value: 0 },
    ]);
  });

  it("parses a single counter with non-zero value", () => {
    assert.deepStrictEqual(parseCounterDirective("paragraph 3"), [
      { name: "paragraph", value: 3 },
    ]);
  });

  it("parses multiple counters", () => {
    assert.deepStrictEqual(parseCounterDirective("paragraph 0 section 0"), [
      { name: "paragraph", value: 0 },
      { name: "section", value: 0 },
    ]);
  });

  it("parses counter name without explicit value as 0", () => {
    assert.deepStrictEqual(parseCounterDirective("paragraph"), [
      { name: "paragraph", value: 0 },
    ]);
  });

  it("filters out list-item counter", () => {
    assert.deepStrictEqual(parseCounterDirective("list-item 0 paragraph 0"), [
      { name: "paragraph", value: 0 },
    ]);
  });

  it("returns [] when only list-item", () => {
    assert.deepStrictEqual(parseCounterDirective("list-item 0"), []);
  });

  it("parses negative values", () => {
    assert.deepStrictEqual(parseCounterDirective("paragraph -1"), [
      { name: "paragraph", value: -1 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// CounterState
// ---------------------------------------------------------------------------

describe("CounterState", () => {
  it("starts empty", () => {
    const state = new CounterState();
    assert.equal(state.isEmpty(), true);
    assert.deepStrictEqual(state.snapshot(), {});
  });

  it("applyReset sets counter value", () => {
    const state = new CounterState();
    state.applyReset([{ name: "p", value: 0 }]);
    assert.equal(state.isEmpty(), false);
    assert.deepStrictEqual(state.snapshot(), { p: 0 });
  });

  it("applyIncrement on empty state starts from 0", () => {
    const state = new CounterState();
    state.applyIncrement([{ name: "p", value: 1 }]);
    assert.deepStrictEqual(state.snapshot(), { p: 1 });
  });

  it("accumulates increments", () => {
    const state = new CounterState();
    state.applyReset([{ name: "p", value: 0 }]);
    state.applyIncrement([{ name: "p", value: 1 }]);
    state.applyIncrement([{ name: "p", value: 1 }]);
    assert.deepStrictEqual(state.snapshot(), { p: 2 });
  });

  it("handles multiple counters", () => {
    const state = new CounterState();
    state.applyReset([{ name: "p", value: 0 }, { name: "s", value: 0 }]);
    state.applyIncrement([{ name: "p", value: 1 }]);
    assert.deepStrictEqual(state.snapshot(), { p: 1, s: 0 });
  });

  it("handles increment by non-1 value", () => {
    const state = new CounterState();
    state.applyIncrement([{ name: "p", value: 5 }]);
    assert.deepStrictEqual(state.snapshot(), { p: 5 });
  });

  it("reset overwrites previous value", () => {
    const state = new CounterState();
    state.applyIncrement([{ name: "p", value: 10 }]);
    state.applyReset([{ name: "p", value: 0 }]);
    assert.deepStrictEqual(state.snapshot(), { p: 0 });
  });

  it("snapshot returns a frozen copy", () => {
    const state = new CounterState();
    state.applyReset([{ name: "p", value: 0 }]);
    const snap = state.snapshot();
    assert.equal(Object.isFrozen(snap), true);
    // Mutating state doesn't affect snapshot
    state.applyIncrement([{ name: "p", value: 1 }]);
    assert.equal(snap.p, 0);
  });
});

// ---------------------------------------------------------------------------
// walkFragmentTree
// ---------------------------------------------------------------------------

describe("walkFragmentTree", () => {
  /** Helper: create a PhysicalFragment with mock node and optional children/break token */
  function frag(node, childFragments = [], breakToken = null) {
    const f = new PhysicalFragment(node, 100, childFragments);
    f.breakToken = breakToken;
    return f;
  }

  it("applies counter-reset and counter-increment for fresh elements", () => {
    const section = blockNode({ debugName: "section", counterReset: "paragraph 0" });
    const p1 = blockNode({ debugName: "p1", counterIncrement: "paragraph 1" });
    const p2 = blockNode({ debugName: "p2", counterIncrement: "paragraph 1" });

    const tree = frag(section, [frag(p1), frag(p2)]);
    const state = new CounterState();
    walkFragmentTree(tree, null, state);

    assert.deepStrictEqual(state.snapshot(), { paragraph: 2 });
  });

  it("skips counter operations on continuations", () => {
    const section = blockNode({ debugName: "section", counterReset: "paragraph 0" });
    const p1 = blockNode({ debugName: "p1", counterIncrement: "paragraph 1" });

    // section is a continuation (inputBreakToken is non-null)
    const sectionBT = new BlockBreakToken(section);
    const tree = frag(section, [frag(p1)]);
    const state = new CounterState();
    walkFragmentTree(tree, sectionBT, state);

    // section's counter-reset is skipped, but p1 is fresh (no child break token)
    assert.deepStrictEqual(state.snapshot(), { paragraph: 1 });
  });

  it("skips both parent and child when both are continuations", () => {
    const section = blockNode({ debugName: "section", counterReset: "paragraph 0" });
    const p1 = blockNode({ debugName: "p1", counterIncrement: "paragraph 1" });

    const p1BT = new BlockBreakToken(p1);
    const sectionBT = new BlockBreakToken(section);
    sectionBT.childBreakTokens = [p1BT];

    const tree = frag(section, [frag(p1)]);
    const state = new CounterState();
    walkFragmentTree(tree, sectionBT, state);

    // Both are continuations — no counter operations
    assert.deepStrictEqual(state.snapshot(), {});
  });

  it("skips fragments with null node", () => {
    const root = blockNode({ debugName: "root" });
    const lineFragment = new PhysicalFragment(null, 20);
    const p1 = blockNode({ debugName: "p1", counterIncrement: "paragraph 1" });

    const tree = frag(root, [lineFragment, frag(p1)]);
    const state = new CounterState();
    walkFragmentTree(tree, null, state);

    assert.deepStrictEqual(state.snapshot(), { paragraph: 1 });
  });

  it("accumulates across multiple calls (simulating fragmentainers)", () => {
    const section = blockNode({ debugName: "section", counterReset: "paragraph 0" });
    const p1 = blockNode({ debugName: "p1", counterIncrement: "paragraph 1" });
    const p2 = blockNode({ debugName: "p2", counterIncrement: "paragraph 1" });
    const p3 = blockNode({ debugName: "p3", counterIncrement: "paragraph 1" });

    const state = new CounterState();

    // Fragmentainer 1: section (fresh) + p1 + p2, breaks after p2
    const bt = new BlockBreakToken(section);
    const tree1 = frag(section, [frag(p1), frag(p2)], bt);
    walkFragmentTree(tree1, null, state);
    assert.deepStrictEqual(state.snapshot(), { paragraph: 2 });

    // Fragmentainer 2: section (continuation) + p3 (fresh)
    const sectionBT = new BlockBreakToken(section);
    const tree2 = frag(section, [frag(p3)]);
    walkFragmentTree(tree2, sectionBT, state);
    assert.deepStrictEqual(state.snapshot(), { paragraph: 3 });
  });
});
