import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runLayoutGenerator, getLayoutAlgorithm } from "../src/layout-request.js";
import { layoutFlexContainer } from "../src/layout/flex-container.js";
import { ConstraintSpace } from "../src/constraint-space.js";
import { blockNode, flexNode } from "./fixtures/nodes.js";

function layoutFlex(node, { inlineSize = 600, blockSize = 400, fragmentationType = "none" } = {}) {
  const cs = new ConstraintSpace({
    availableInlineSize: inlineSize,
    availableBlockSize: blockSize,
    fragmentainerBlockSize: blockSize,
    blockOffsetInFragmentainer: 0,
    fragmentationType,
  });
  return runLayoutGenerator(getLayoutAlgorithm(node), node, cs, null);
}

describe("layoutFlexContainer", () => {
  it("dispatches flex nodes to the flex algorithm", () => {
    const node = flexNode();
    assert.equal(getLayoutAlgorithm(node), layoutFlexContainer);
  });

  it("lays out single-line row flex items as parallel flows", () => {
    const root = flexNode({
      children: [
        blockNode({ debugName: "A", blockSize: 100 }),
        blockNode({ debugName: "B", blockSize: 80 }),
      ],
    });

    const result = layoutFlex(root);
    // One flex line containing both items
    assert.equal(result.fragment.childFragments.length, 1); // one line
    const line = result.fragment.childFragments[0];
    assert.equal(line.childFragments.length, 2); // two items
    // Tallest item (100) drives line height
    assert.equal(line.blockSize, 100);
  });

  it("items fragment independently (parallel flows)", () => {
    const root = flexNode({
      children: [
        blockNode({ debugName: "A", blockSize: 200 }),
        blockNode({ debugName: "B", blockSize: 50 }),
      ],
    });

    // Fragmentainer height 100: A breaks, B completes
    const result = layoutFlex(root, { blockSize: 100, fragmentationType: "page" });
    const line = result.fragment.childFragments[0];
    assert.equal(line.blockSize, 100);
    assert.ok(result.breakToken);
  });

  it("completed items get isAtBlockEnd tokens", () => {
    const root = flexNode({
      children: [
        blockNode({ debugName: "A", blockSize: 200 }),
        blockNode({ debugName: "B", blockSize: 50 }),
      ],
    });

    const result = layoutFlex(root, { blockSize: 100, fragmentationType: "page" });
    // The line break token should have child tokens for both items
    const lineToken = result.breakToken.childBreakTokens[0];
    assert.ok(lineToken);
    const itemTokens = lineToken.childBreakTokens;
    // One item broke, one completed
    const completed = itemTokens.filter(t => t.isAtBlockEnd);
    const broke = itemTokens.filter(t => !t.isAtBlockEnd);
    assert.equal(completed.length, 1);
    assert.equal(broke.length, 1);
  });

  it("break token has kFlexData", () => {
    const root = flexNode({
      children: [
        blockNode({ debugName: "A", blockSize: 200 }),
      ],
    });

    const result = layoutFlex(root, { blockSize: 100, fragmentationType: "page" });
    assert.ok(result.breakToken);
    assert.equal(result.breakToken.algorithmData.type, "FlexData");
  });

  it("column flex uses flow thread (sequential fragmentation)", () => {
    const root = flexNode({
      flexDirection: "column",
      children: [
        blockNode({ debugName: "A", blockSize: 100 }),
        blockNode({ debugName: "B", blockSize: 100 }),
      ],
    });

    // Items stack sequentially, total 200px
    const result = layoutFlex(root, { blockSize: 400 });
    assert.equal(result.fragment.blockSize, 200);
    assert.equal(result.breakToken, null);
  });

  it("column flex fragments across pages", () => {
    const root = flexNode({
      flexDirection: "column",
      children: [
        blockNode({ debugName: "A", blockSize: 100 }),
        blockNode({ debugName: "B", blockSize: 100 }),
      ],
    });

    const result = layoutFlex(root, { blockSize: 150, fragmentationType: "page" });
    assert.ok(result.breakToken);
    assert.equal(result.breakToken.algorithmData.type, "FlexData");
  });

  it("empty flex container produces zero-height fragment", () => {
    const root = flexNode({ children: [] });
    const result = layoutFlex(root);
    assert.equal(result.fragment.blockSize, 0);
    assert.equal(result.breakToken, null);
  });

  it("does not infinitely recurse (flow thread pattern for column)", () => {
    const root = flexNode({
      flexDirection: "column",
      children: [blockNode({ blockSize: 50 })],
    });
    const result = layoutFlex(root);
    assert.ok(result.fragment);
  });
});
