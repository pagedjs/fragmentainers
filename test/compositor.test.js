import { describe, it, expect } from "vitest";
import { PhysicalFragment } from "../src/fragment.js";
import { BlockBreakToken, InlineBreakToken } from "../src/tokens.js";
import { blockNode, textToInlineItems } from "./fixtures/nodes.js";
import { INLINE_TEXT, INLINE_CONTROL } from "../src/constants.js";
import { findChildBreakToken } from "../src/helpers.js";

// Import the compositor functions
import {
  hasBlockChildFragments,
  getFragmentainerSize,
} from "../src/compositor/index.js";

import { applySliceDecorations } from "../src/compositor/render-fragments.js";

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

describe("getFragmentainerSize", () => {
  const sizes = [
    { inlineSize: 600, blockSize: 800 },
    { inlineSize: 800, blockSize: 600 },
  ];

  it("returns the size at the given index", () => {
    expect(getFragmentainerSize(sizes, 0)).toEqual({ inlineSize: 600, blockSize: 800 });
    expect(getFragmentainerSize(sizes, 1)).toEqual({ inlineSize: 800, blockSize: 600 });
  });

  it("returns the last size for indices beyond the array", () => {
    expect(getFragmentainerSize(sizes, 2)).toEqual({ inlineSize: 800, blockSize: 600 });
    expect(getFragmentainerSize(sizes, 99)).toEqual({ inlineSize: 800, blockSize: 600 });
  });

  it("works with a single-element array", () => {
    const single = [{ inlineSize: 500, blockSize: 700 }];
    expect(getFragmentainerSize(single, 0)).toEqual({ inlineSize: 500, blockSize: 700 });
    expect(getFragmentainerSize(single, 5)).toEqual({ inlineSize: 500, blockSize: 700 });
  });
});

describe("compositor fragment tree contract", () => {
  it("PhysicalFragment stores node, blockSize, and childFragments", () => {
    const node = blockNode({ debugName: "root" });
    const child = new PhysicalFragment(blockNode({ debugName: "child" }), 50);
    const fragment = new PhysicalFragment(node, 100, [child]);

    expect(fragment.node).toBe(node);
    expect(fragment.blockSize).toBe(100);
    expect(fragment.childFragments.length).toBe(1);
    expect(fragment.childFragments[0]).toBe(child);
    expect(fragment.breakToken).toBe(null);
  });

  it("break tokens attach to fragments for continuation", () => {
    const node = blockNode({ debugName: "paragraph" });
    const fragment = new PhysicalFragment(node, 200);
    const bt = new BlockBreakToken(node);
    bt.consumedBlockSize = 200;
    fragment.breakToken = bt;

    expect(fragment.breakToken.type).toBe("block");
    expect(fragment.breakToken.consumedBlockSize).toBe(200);
    expect(fragment.breakToken.node).toBe(node);
  });

  it("inline break tokens use content-addressed offsets", () => {
    const node = blockNode({ debugName: "ifc" });
    const token = new InlineBreakToken(node);
    token.itemIndex = 5;
    token.textOffset = 142;

    expect(token.type).toBe("inline");
    expect(token.itemIndex).toBe(5);
    expect(token.textOffset).toBe(142);
  });

  it("findChildBreakToken locates child tokens in parent", () => {
    const childNode = blockNode({ debugName: "child" });
    const parentBT = new BlockBreakToken(blockNode({ debugName: "parent" }));
    const childBT = new BlockBreakToken(childNode);
    childBT.consumedBlockSize = 100;
    parentBT.childBreakTokens = [childBT];

    const found = findChildBreakToken(parentBT, childNode);
    expect(found).toBe(childBT);
    expect(found.consumedBlockSize).toBe(100);
  });

  it("findChildBreakToken returns null when no match", () => {
    const parentBT = new BlockBreakToken(blockNode({ debugName: "parent" }));
    parentBT.childBreakTokens = [];
    const other = blockNode({ debugName: "other" });

    expect(findChildBreakToken(parentBT, other)).toBe(null);
    expect(findChildBreakToken(null, other)).toBe(null);
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

describe("applySliceDecorations", () => {
  /** Mock element with a style object */
  function mockEl() {
    return { style: {} };
  }

  it("does nothing for only-fragment (no breaks)", () => {
    const el = mockEl();
    const fragment = new PhysicalFragment(blockNode(), 200);
    // inputBreakToken = null, fragment.breakToken = null
    applySliceDecorations(el, null, fragment);
    expect(el.style.borderBlockStart).toBe(undefined);
    expect(el.style.borderBlockEnd).toBe(undefined);
    expect(el.style.paddingBlockStart).toBe(undefined);
    expect(el.style.paddingBlockEnd).toBe(undefined);
  });

  it("suppresses block-end on first fragment (non-final)", () => {
    const el = mockEl();
    const fragment = new PhysicalFragment(blockNode(), 200);
    const bt = new BlockBreakToken(fragment.node);
    fragment.breakToken = bt;
    // inputBreakToken = null (first), fragment.breakToken = bt (non-final)
    applySliceDecorations(el, null, fragment);
    expect(el.style.borderBlockStart).toBe(undefined);
    expect(el.style.paddingBlockStart).toBe(undefined);
    expect(el.style.borderBlockEnd).toBe("none");
    expect(el.style.paddingBlockEnd).toBe("0");
  });

  it("suppresses block-start on final fragment (continuation)", () => {
    const el = mockEl();
    const inputBT = new BlockBreakToken(blockNode());
    const fragment = new PhysicalFragment(blockNode(), 200);
    // inputBreakToken = inputBT (continuation), fragment.breakToken = null (final)
    applySliceDecorations(el, inputBT, fragment);
    expect(el.style.borderBlockStart).toBe("none");
    expect(el.style.paddingBlockStart).toBe("0");
    expect(el.style.borderBlockEnd).toBe(undefined);
    expect(el.style.paddingBlockEnd).toBe(undefined);
  });

  it("suppresses both block-start and block-end on middle fragment", () => {
    const el = mockEl();
    const inputBT = new BlockBreakToken(blockNode());
    const fragment = new PhysicalFragment(blockNode(), 200);
    const outputBT = new BlockBreakToken(fragment.node);
    fragment.breakToken = outputBT;
    // inputBreakToken = inputBT (continuation), fragment.breakToken = outputBT (non-final)
    applySliceDecorations(el, inputBT, fragment);
    expect(el.style.borderBlockStart).toBe("none");
    expect(el.style.paddingBlockStart).toBe("0");
    expect(el.style.borderBlockEnd).toBe("none");
    expect(el.style.paddingBlockEnd).toBe("0");
  });
});
