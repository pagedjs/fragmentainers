import { describe, it, expect } from "vitest";
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
    expect(getLayoutAlgorithm(node)).toBe(layoutFlexContainer);
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
    expect(result.fragment.childFragments.length).toBe(1); // one line
    const line = result.fragment.childFragments[0];
    expect(line.childFragments.length).toBe(2); // two items
    // Tallest item (100) drives line height
    expect(line.blockSize).toBe(100);
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
    expect(line.blockSize).toBe(100);
    expect(result.breakToken).toBeTruthy();
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
    expect(lineToken).toBeTruthy();
    const itemTokens = lineToken.childBreakTokens;
    // One item broke, one completed
    const completed = itemTokens.filter(t => t.isAtBlockEnd);
    const broke = itemTokens.filter(t => !t.isAtBlockEnd);
    expect(completed.length).toBe(1);
    expect(broke.length).toBe(1);
  });

  it("break token has kFlexData", () => {
    const root = flexNode({
      children: [
        blockNode({ debugName: "A", blockSize: 200 }),
      ],
    });

    const result = layoutFlex(root, { blockSize: 100, fragmentationType: "page" });
    expect(result.breakToken).toBeTruthy();
    expect(result.breakToken.algorithmData.type).toBe("FlexData");
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
    expect(result.fragment.blockSize).toBe(200);
    expect(result.breakToken).toBe(null);
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
    expect(result.breakToken).toBeTruthy();
    expect(result.breakToken.algorithmData.type).toBe("FlexData");
  });

  it("empty flex container produces zero-height fragment", () => {
    const root = flexNode({ children: [] });
    const result = layoutFlex(root);
    expect(result.fragment.blockSize).toBe(0);
    expect(result.breakToken).toBe(null);
  });

  it("does not infinitely recurse (flow thread pattern for column)", () => {
    const root = flexNode({
      flexDirection: "column",
      children: [blockNode({ blockSize: 50 })],
    });
    const result = layoutFlex(root);
    expect(result.fragment).toBeTruthy();
  });
});
