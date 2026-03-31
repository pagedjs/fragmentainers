import { describe, it, expect } from "vitest";
import { PhysicalFragment } from "../src/fragment.js";
import { BlockBreakToken } from "../src/tokens.js";
import { blockNode, textToInlineItems } from "./fixtures/nodes.js";
import { INLINE_TEXT, INLINE_CONTROL } from "../src/constants.js";

// Import the compositor functions
import {
  hasBlockChildFragments,
} from "../src/compositor/index.js";

describe("hasBlockChildFragments", () => {
  it("returns false for empty childFragments", () => {
    const fragment = new PhysicalFragment(blockNode(), 100, []);
    expect(hasBlockChildFragments(fragment)).toBe(false);
  });

  it("returns false when all children have null nodes (line fragments)", () => {
    const lineFragment = new PhysicalFragment(null, 20);
    const fragment = new PhysicalFragment(blockNode(), 100, [lineFragment, lineFragment]);
    expect(hasBlockChildFragments(fragment)).toBe(false);
  });

  it("returns true when at least one child has a node", () => {
    const lineFragment = new PhysicalFragment(null, 20);
    const blockChild = new PhysicalFragment(blockNode({ debugName: "child" }), 50);
    const fragment = new PhysicalFragment(blockNode(), 100, [lineFragment, blockChild]);
    expect(hasBlockChildFragments(fragment)).toBe(true);
  });

  it("returns true when all children have nodes", () => {
    const child1 = new PhysicalFragment(blockNode({ debugName: "a" }), 50);
    const child2 = new PhysicalFragment(blockNode({ debugName: "b" }), 50);
    const fragment = new PhysicalFragment(blockNode(), 100, [child1, child2]);
    expect(hasBlockChildFragments(fragment)).toBe(true);
  });
});

describe("empty container shell detection", () => {
  /**
   * Mirrors the condition in renderFragment that skips empty container shells:
   *   fragment.childFragments.length === 0 && fragment.breakToken && node.children?.length > 0
   */
  function isEmptyContainerShell(fragment) {
    return fragment.childFragments.length === 0 &&
      fragment.breakToken !== null &&
      fragment.node.children?.length > 0;
  }

  it("detects an empty container with pushed children", () => {
    const child = blockNode({ debugName: "child" });
    const container = blockNode({ debugName: "container", children: [child] });
    const fragment = new PhysicalFragment(container, 0, []);
    fragment.breakToken = new BlockBreakToken(container);
    fragment.breakToken.childBreakTokens = [BlockBreakToken.createBreakBefore(child)];
    expect(isEmptyContainerShell(fragment)).toBe(true);
  });

  it("does not flag a leaf node being sliced", () => {
    const leaf = blockNode({ debugName: "leaf" }); // children: [] by default
    const fragment = new PhysicalFragment(leaf, 200, []);
    fragment.breakToken = new BlockBreakToken(leaf);
    fragment.breakToken.consumedBlockSize = 200;
    expect(isEmptyContainerShell(fragment)).toBe(false);
  });

  it("does not flag a container with placed children", () => {
    const child = blockNode({ debugName: "child" });
    const container = blockNode({ debugName: "container", children: [child] });
    const childFrag = new PhysicalFragment(child, 50);
    const fragment = new PhysicalFragment(container, 50, [childFrag]);
    fragment.breakToken = new BlockBreakToken(container);
    expect(isEmptyContainerShell(fragment)).toBe(false);
  });

  it("does not flag a completed container (no break token)", () => {
    const child = blockNode({ debugName: "child" });
    const container = blockNode({ debugName: "container", children: [child] });
    const childFrag = new PhysicalFragment(child, 50);
    const fragment = new PhysicalFragment(container, 50, [childFrag]);
    expect(isEmptyContainerShell(fragment)).toBe(false);
  });
});

describe("inline items data for compositor", () => {
  it("textToInlineItems creates kText items with correct offsets", () => {
    const data = textToInlineItems("Hello world");
    expect(data.textContent).toBe("Hello world");
    expect(data.items.length).toBe(1);
    expect(data.items[0].type).toBe(INLINE_TEXT);
    expect(data.items[0].startOffset).toBe(0);
    expect(data.items[0].endOffset).toBe(11);
  });

  it("textToInlineItems splits on newlines with kControl", () => {
    const data = textToInlineItems("Line one\nLine two");
    expect(data.items.length).toBe(3);
    expect(data.items[0].type).toBe(INLINE_TEXT);
    expect(data.items[0].endOffset).toBe(8);
    expect(data.items[1].type).toBe(INLINE_CONTROL);
    expect(data.items[2].type).toBe(INLINE_TEXT);
    expect(data.items[2].startOffset).toBe(9);
    expect(data.items[2].endOffset).toBe(17);
  });

  it("inline break token offsets correctly slice text content", () => {
    const data = textToInlineItems("The quick brown fox jumps over the lazy dog");
    const startOffset = 10; // "brown fox..."
    const endOffset = 25;   // ..."jumps over"
    const visible = data.textContent.slice(startOffset, endOffset);
    expect(visible).toBe("brown fox jumps");
  });
});

