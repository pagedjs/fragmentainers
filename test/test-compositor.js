import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PhysicalFragment } from "../src/fragment.js";
import { BlockBreakToken, InlineBreakToken } from "../src/tokens.js";
import { blockNode, inlineNode, textToInlineItems } from "./fixtures/nodes.js";
import { findChildBreakToken } from "../src/helpers.js";

// Import the compositor functions
import {
  hasBlockChildFragments,
  getFragmentainerSize,
} from "../src/compositor/index.js";

import { applySliceDecorations } from "../src/compositor/render-fragments.js";

// ---------------------------------------------------------------------------
// hasBlockChildFragments
// ---------------------------------------------------------------------------

describe("hasBlockChildFragments", () => {
  it("returns false for empty childFragments", () => {
    const fragment = new PhysicalFragment(blockNode(), 100, []);
    assert.equal(hasBlockChildFragments(fragment), false);
  });

  it("returns false when all children have null nodes (line fragments)", () => {
    const lineFragment = new PhysicalFragment(null, 20);
    const fragment = new PhysicalFragment(blockNode(), 100, [lineFragment, lineFragment]);
    assert.equal(hasBlockChildFragments(fragment), false);
  });

  it("returns true when at least one child has a node", () => {
    const lineFragment = new PhysicalFragment(null, 20);
    const blockChild = new PhysicalFragment(blockNode({ debugName: "child" }), 50);
    const fragment = new PhysicalFragment(blockNode(), 100, [lineFragment, blockChild]);
    assert.equal(hasBlockChildFragments(fragment), true);
  });

  it("returns true when all children have nodes", () => {
    const child1 = new PhysicalFragment(blockNode({ debugName: "a" }), 50);
    const child2 = new PhysicalFragment(blockNode({ debugName: "b" }), 50);
    const fragment = new PhysicalFragment(blockNode(), 100, [child1, child2]);
    assert.equal(hasBlockChildFragments(fragment), true);
  });
});

// ---------------------------------------------------------------------------
// getFragmentainerSize
// ---------------------------------------------------------------------------

describe("getFragmentainerSize", () => {
  const sizes = [
    { inlineSize: 600, blockSize: 800 },
    { inlineSize: 800, blockSize: 600 },
  ];

  it("returns the size at the given index", () => {
    assert.deepEqual(getFragmentainerSize(sizes, 0), { inlineSize: 600, blockSize: 800 });
    assert.deepEqual(getFragmentainerSize(sizes, 1), { inlineSize: 800, blockSize: 600 });
  });

  it("returns the last size for indices beyond the array", () => {
    assert.deepEqual(getFragmentainerSize(sizes, 2), { inlineSize: 800, blockSize: 600 });
    assert.deepEqual(getFragmentainerSize(sizes, 99), { inlineSize: 800, blockSize: 600 });
  });

  it("works with a single-element array", () => {
    const single = [{ inlineSize: 500, blockSize: 700 }];
    assert.deepEqual(getFragmentainerSize(single, 0), { inlineSize: 500, blockSize: 700 });
    assert.deepEqual(getFragmentainerSize(single, 5), { inlineSize: 500, blockSize: 700 });
  });
});

// ---------------------------------------------------------------------------
// Fragment tree structure tests (verify compositor contract)
// ---------------------------------------------------------------------------

describe("compositor fragment tree contract", () => {
  it("PhysicalFragment stores node, blockSize, and childFragments", () => {
    const node = blockNode({ debugName: "root" });
    const child = new PhysicalFragment(blockNode({ debugName: "child" }), 50);
    const fragment = new PhysicalFragment(node, 100, [child]);

    assert.equal(fragment.node, node);
    assert.equal(fragment.blockSize, 100);
    assert.equal(fragment.childFragments.length, 1);
    assert.equal(fragment.childFragments[0], child);
    assert.equal(fragment.breakToken, null);
  });

  it("break tokens attach to fragments for continuation", () => {
    const node = blockNode({ debugName: "paragraph" });
    const fragment = new PhysicalFragment(node, 200);
    const bt = new BlockBreakToken(node);
    bt.consumedBlockSize = 200;
    fragment.breakToken = bt;

    assert.equal(fragment.breakToken.type, "block");
    assert.equal(fragment.breakToken.consumedBlockSize, 200);
    assert.equal(fragment.breakToken.node, node);
  });

  it("inline break tokens use content-addressed offsets", () => {
    const node = blockNode({ debugName: "ifc" });
    const token = new InlineBreakToken(node);
    token.itemIndex = 5;
    token.textOffset = 142;

    assert.equal(token.type, "inline");
    assert.equal(token.itemIndex, 5);
    assert.equal(token.textOffset, 142);
  });

  it("findChildBreakToken locates child tokens in parent", () => {
    const childNode = blockNode({ debugName: "child" });
    const parentBT = new BlockBreakToken(blockNode({ debugName: "parent" }));
    const childBT = new BlockBreakToken(childNode);
    childBT.consumedBlockSize = 100;
    parentBT.childBreakTokens = [childBT];

    const found = findChildBreakToken(parentBT, childNode);
    assert.equal(found, childBT);
    assert.equal(found.consumedBlockSize, 100);
  });

  it("findChildBreakToken returns null when no match", () => {
    const parentBT = new BlockBreakToken(blockNode({ debugName: "parent" }));
    parentBT.childBreakTokens = [];
    const other = blockNode({ debugName: "other" });

    assert.equal(findChildBreakToken(parentBT, other), null);
    assert.equal(findChildBreakToken(null, other), null);
  });
});

// ---------------------------------------------------------------------------
// Inline items data structure (used by buildInlineContent)
// ---------------------------------------------------------------------------

describe("inline items data for compositor", () => {
  it("textToInlineItems creates kText items with correct offsets", () => {
    const data = textToInlineItems("Hello world");
    assert.equal(data.textContent, "Hello world");
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].type, "kText");
    assert.equal(data.items[0].startOffset, 0);
    assert.equal(data.items[0].endOffset, 11);
  });

  it("textToInlineItems splits on newlines with kControl", () => {
    const data = textToInlineItems("Line one\nLine two");
    assert.equal(data.items.length, 3); // kText, kControl, kText
    assert.equal(data.items[0].type, "kText");
    assert.equal(data.items[0].endOffset, 8);
    assert.equal(data.items[1].type, "kControl");
    assert.equal(data.items[2].type, "kText");
    assert.equal(data.items[2].startOffset, 9);
    assert.equal(data.items[2].endOffset, 17);
  });

  it("inline break token offsets correctly slice text content", () => {
    const data = textToInlineItems("The quick brown fox jumps over the lazy dog");
    const startOffset = 10; // "brown fox..."
    const endOffset = 25;   // ..."jumps over"
    const visible = data.textContent.slice(startOffset, endOffset);
    assert.equal(visible, "brown fox jumps");
  });
});

// ---------------------------------------------------------------------------
// applySliceDecorations (box-decoration-break: slice)
// ---------------------------------------------------------------------------

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
    assert.equal(el.style.borderBlockStart, undefined);
    assert.equal(el.style.borderBlockEnd, undefined);
    assert.equal(el.style.paddingBlockStart, undefined);
    assert.equal(el.style.paddingBlockEnd, undefined);
  });

  it("suppresses block-end on first fragment (non-final)", () => {
    const el = mockEl();
    const fragment = new PhysicalFragment(blockNode(), 200);
    const bt = new BlockBreakToken(fragment.node);
    fragment.breakToken = bt;
    // inputBreakToken = null (first), fragment.breakToken = bt (non-final)
    applySliceDecorations(el, null, fragment);
    assert.equal(el.style.borderBlockStart, undefined);
    assert.equal(el.style.paddingBlockStart, undefined);
    assert.equal(el.style.borderBlockEnd, "none");
    assert.equal(el.style.paddingBlockEnd, "0");
  });

  it("suppresses block-start on final fragment (continuation)", () => {
    const el = mockEl();
    const inputBT = new BlockBreakToken(blockNode());
    const fragment = new PhysicalFragment(blockNode(), 200);
    // inputBreakToken = inputBT (continuation), fragment.breakToken = null (final)
    applySliceDecorations(el, inputBT, fragment);
    assert.equal(el.style.borderBlockStart, "none");
    assert.equal(el.style.paddingBlockStart, "0");
    assert.equal(el.style.borderBlockEnd, undefined);
    assert.equal(el.style.paddingBlockEnd, undefined);
  });

  it("suppresses both block-start and block-end on middle fragment", () => {
    const el = mockEl();
    const inputBT = new BlockBreakToken(blockNode());
    const fragment = new PhysicalFragment(blockNode(), 200);
    const outputBT = new BlockBreakToken(fragment.node);
    fragment.breakToken = outputBT;
    // inputBreakToken = inputBT (continuation), fragment.breakToken = outputBT (non-final)
    applySliceDecorations(el, inputBT, fragment);
    assert.equal(el.style.borderBlockStart, "none");
    assert.equal(el.style.paddingBlockStart, "0");
    assert.equal(el.style.borderBlockEnd, "none");
    assert.equal(el.style.paddingBlockEnd, "0");
  });
});
