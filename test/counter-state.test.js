import { describe, it, expect } from "vitest";
import { parseCounterDirective, CounterState, walkFragmentTree } from "../src/counter-state.js";
import { PhysicalFragment } from "../src/fragment.js";
import { BlockBreakToken } from "../src/tokens.js";
import { blockNode } from "./fixtures/nodes.js";

describe("parseCounterDirective", () => {
  it("returns [] for null", () => {
    expect(parseCounterDirective(null)).toEqual([]);
  });

  it("returns [] for 'none'", () => {
    expect(parseCounterDirective("none")).toEqual([]);
  });

  it("returns [] for empty string", () => {
    expect(parseCounterDirective("")).toEqual([]);
  });

  it("parses a single counter with value", () => {
    expect(parseCounterDirective("paragraph 0")).toEqual([
      { name: "paragraph", value: 0 },
    ]);
  });

  it("parses a single counter with non-zero value", () => {
    expect(parseCounterDirective("paragraph 3")).toEqual([
      { name: "paragraph", value: 3 },
    ]);
  });

  it("parses multiple counters", () => {
    expect(parseCounterDirective("paragraph 0 section 0")).toEqual([
      { name: "paragraph", value: 0 },
      { name: "section", value: 0 },
    ]);
  });

  it("parses counter name without explicit value as 0", () => {
    expect(parseCounterDirective("paragraph")).toEqual([
      { name: "paragraph", value: 0 },
    ]);
  });

  it("filters out list-item counter", () => {
    expect(parseCounterDirective("list-item 0 paragraph 0")).toEqual([
      { name: "paragraph", value: 0 },
    ]);
  });

  it("returns [] when only list-item", () => {
    expect(parseCounterDirective("list-item 0")).toEqual([]);
  });

  it("parses negative values", () => {
    expect(parseCounterDirective("paragraph -1")).toEqual([
      { name: "paragraph", value: -1 },
    ]);
  });
});

describe("CounterState", () => {
  it("starts empty", () => {
    const state = new CounterState();
    expect(state.isEmpty()).toBe(true);
    expect(state.snapshot()).toEqual({});
  });

  it("applyReset sets counter value", () => {
    const state = new CounterState();
    state.applyReset([{ name: "p", value: 0 }]);
    expect(state.isEmpty()).toBe(false);
    expect(state.snapshot()).toEqual({ p: 0 });
  });

  it("applyIncrement on empty state starts from 0", () => {
    const state = new CounterState();
    state.applyIncrement([{ name: "p", value: 1 }]);
    expect(state.snapshot()).toEqual({ p: 1 });
  });

  it("accumulates increments", () => {
    const state = new CounterState();
    state.applyReset([{ name: "p", value: 0 }]);
    state.applyIncrement([{ name: "p", value: 1 }]);
    state.applyIncrement([{ name: "p", value: 1 }]);
    expect(state.snapshot()).toEqual({ p: 2 });
  });

  it("handles multiple counters", () => {
    const state = new CounterState();
    state.applyReset([{ name: "p", value: 0 }, { name: "s", value: 0 }]);
    state.applyIncrement([{ name: "p", value: 1 }]);
    expect(state.snapshot()).toEqual({ p: 1, s: 0 });
  });

  it("handles increment by non-1 value", () => {
    const state = new CounterState();
    state.applyIncrement([{ name: "p", value: 5 }]);
    expect(state.snapshot()).toEqual({ p: 5 });
  });

  it("reset overwrites previous value", () => {
    const state = new CounterState();
    state.applyIncrement([{ name: "p", value: 10 }]);
    state.applyReset([{ name: "p", value: 0 }]);
    expect(state.snapshot()).toEqual({ p: 0 });
  });

  it("snapshot returns a frozen copy", () => {
    const state = new CounterState();
    state.applyReset([{ name: "p", value: 0 }]);
    const snap = state.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    // Mutating state doesn't affect snapshot
    state.applyIncrement([{ name: "p", value: 1 }]);
    expect(snap.p).toBe(0);
  });

  it("restore() populates counters from a snapshot", () => {
    const state = new CounterState();
    state.restore({ p: 5, s: 2 });
    expect(state.snapshot()).toEqual({ p: 5, s: 2 });
  });

  it("restore() clears existing state", () => {
    const state = new CounterState();
    state.applyReset([{ name: "old", value: 99 }]);
    state.restore({ p: 1 });
    expect(state.snapshot()).toEqual({ p: 1 });
  });

  it("restore(null) clears all counters", () => {
    const state = new CounterState();
    state.applyReset([{ name: "p", value: 5 }]);
    state.restore(null);
    expect(state.isEmpty()).toBe(true);
  });

  it("accumulates after restore", () => {
    const state = new CounterState();
    state.restore({ p: 3 });
    state.applyIncrement([{ name: "p", value: 1 }]);
    expect(state.snapshot()).toEqual({ p: 4 });
  });
});

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

    expect(state.snapshot()).toEqual({ paragraph: 2 });
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
    expect(state.snapshot()).toEqual({ paragraph: 1 });
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
    expect(state.snapshot()).toEqual({});
  });

  it("skips fragments with null node", () => {
    const root = blockNode({ debugName: "root" });
    const lineFragment = new PhysicalFragment(null, 20);
    const p1 = blockNode({ debugName: "p1", counterIncrement: "paragraph 1" });

    const tree = frag(root, [lineFragment, frag(p1)]);
    const state = new CounterState();
    walkFragmentTree(tree, null, state);

    expect(state.snapshot()).toEqual({ paragraph: 1 });
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
    expect(state.snapshot()).toEqual({ paragraph: 2 });

    // Fragmentainer 2: section (continuation) + p3 (fresh)
    const sectionBT = new BlockBreakToken(section);
    const tree2 = frag(section, [frag(p3)]);
    walkFragmentTree(tree2, sectionBT, state);
    expect(state.snapshot()).toEqual({ paragraph: 3 });
  });
});
