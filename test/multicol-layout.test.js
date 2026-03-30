import { describe, it, expect } from "vitest";
import { runLayoutGenerator, getLayoutAlgorithm } from "../src/layout-request.js";
import { layoutMulticolContainer } from "../src/layout/multicol-container.js";
import { ConstraintSpace } from "../src/constraint-space.js";
import { blockNode, multicolNode } from "./fixtures/nodes.js";

/**
 * Helper: run the multicol layout algorithm on a node.
 */
function layoutMulticol(node, { inlineSize = 600, blockSize = 400 } = {}) {
  const cs = new ConstraintSpace({
    availableInlineSize: inlineSize,
    availableBlockSize: blockSize,
    fragmentainerBlockSize: blockSize,
    blockOffsetInFragmentainer: 0,
    fragmentationType: "none",
  });

  return runLayoutGenerator(
    getLayoutAlgorithm(node), node, cs, null
  );
}

describe("layoutMulticolContainer", () => {
  it("dispatches multicol nodes to the multicol algorithm", () => {
    const node = multicolNode({ columnCount: 2 });
    expect(getLayoutAlgorithm(node)).toBe(layoutMulticolContainer);
  });

  it("does not dispatch non-multicol nodes to multicol", () => {
    const node = blockNode();
    expect(getLayoutAlgorithm(node)).not.toBe(layoutMulticolContainer);
  });

  it("lays out content across 2 columns", () => {
    const root = multicolNode({
      columnCount: 2, columnGap: 0,
      children: [
        blockNode({ debugName: "A", blockSize: 100 }),
        blockNode({ debugName: "B", blockSize: 100 }),
      ],
    });

    // Column height 100: A fills col 1, B fills col 2
    const result = layoutMulticol(root, { inlineSize: 600, blockSize: 100 });
    expect(result.fragment.childFragments.length).toBe(2);
    expect(result.fragment.multicolData.columnCount).toBe(2);
    expect(result.fragment.multicolData.columnWidth).toBe(300);
  });

  it("all content fits in one column when column height is large", () => {
    const root = multicolNode({
      columnCount: 2, columnGap: 0,
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50 }),
      ],
    });

    // Column height 200: both children fit in col 1
    const result = layoutMulticol(root, { inlineSize: 600, blockSize: 200 });
    expect(result.fragment.childFragments.length).toBe(1);
  });

  it("content flows across 3 columns", () => {
    const root = multicolNode({
      columnCount: 3, columnGap: 0,
      children: [
        blockNode({ debugName: "A", blockSize: 100 }),
        blockNode({ debugName: "B", blockSize: 100 }),
        blockNode({ debugName: "C", blockSize: 100 }),
      ],
    });

    // Column height 100: one child per column
    const result = layoutMulticol(root, { inlineSize: 600, blockSize: 100 });
    expect(result.fragment.childFragments.length).toBe(3);
  });

  it("respects column-fill: auto — stops at column count", () => {
    const root = multicolNode({
      columnCount: 2, columnGap: 0, columnFill: "auto",
      children: [
        blockNode({ debugName: "A", blockSize: 100 }),
        blockNode({ debugName: "B", blockSize: 100 }),
        blockNode({ debugName: "C", blockSize: 100 }),
      ],
    });

    // Column height 100, 2 columns, fill: auto → A in col1, B in col2, C overflows
    const result = layoutMulticol(root, { inlineSize: 600, blockSize: 100 });
    expect(result.fragment.childFragments.length).toBe(2);
    // No break token emitted when not in outer fragmentation context
    expect(result.breakToken).toBe(null);
  });

  it("resolves column width correctly with gap", () => {
    const root = multicolNode({
      columnCount: 2, columnGap: 20,
      children: [blockNode({ blockSize: 50 })],
    });

    const result = layoutMulticol(root, { inlineSize: 620, blockSize: 200 });
    // W = (620 - 1*20) / 2 = 300
    expect(result.fragment.multicolData.columnWidth).toBe(300);
    expect(result.fragment.multicolData.columnGap).toBe(20);
  });

  it("sets multicolData on the fragment", () => {
    const root = multicolNode({
      columnCount: 3, columnGap: 10,
      children: [blockNode({ blockSize: 50 })],
    });

    const result = layoutMulticol(root, { inlineSize: 640, blockSize: 200 });
    expect(result.fragment.multicolData).toBeTruthy();
    expect(result.fragment.multicolData.columnCount).toBe(3);
    expect(result.fragment.multicolData.columnGap).toBe(10);
  });

  it("break-before: column forces a column break", () => {
    const root = multicolNode({
      columnCount: 3, columnGap: 0,
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50, breakBefore: "column" }),
      ],
    });

    // Column height 200: both fit in one column, but forced break pushes B to col 2
    const result = layoutMulticol(root, { inlineSize: 600, blockSize: 200 });
    expect(result.fragment.childFragments.length).toBe(2);
  });

  it("emits break token with kMulticolData when nested in outer context", () => {
    const root = multicolNode({
      columnCount: 2, columnGap: 0, columnFill: "auto",
      children: [
        blockNode({ debugName: "A", blockSize: 100 }),
        blockNode({ debugName: "B", blockSize: 100 }),
        blockNode({ debugName: "C", blockSize: 100 }),
      ],
    });

    // Run in a page fragmentation context
    const cs = new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 100,
      fragmentainerBlockSize: 100,
      blockOffsetInFragmentainer: 0,
      fragmentationType: "page",
    });

    const result = runLayoutGenerator(layoutMulticolContainer, root, cs, null);
    expect(result.breakToken).toBeTruthy();
    expect(result.breakToken.algorithmData.type).toBe("MulticolData");
    expect(result.breakToken.algorithmData.columnCount).toBe(2);
    expect(result.breakToken.algorithmData.columnWidth).toBe(300);
  });

  it("does not infinitely recurse (flow thread pattern)", () => {
    // This test verifies the core architectural decision:
    // layoutMulticolContainer creates a flow thread that dispatches
    // to layoutBlockContainer, not back to layoutMulticolContainer.
    const root = multicolNode({
      columnCount: 2, columnGap: 0,
      children: [blockNode({ blockSize: 50 })],
    });

    // If this doesn't hang, the flow thread pattern works
    const result = layoutMulticol(root, { inlineSize: 600, blockSize: 200 });
    expect(result.fragment).toBeTruthy();
    expect(result.fragment.childFragments.length).toBe(1);
  });

  it("fragment inlineSize matches container", () => {
    const root = multicolNode({
      columnCount: 2, columnGap: 0,
      children: [blockNode({ blockSize: 50 })],
    });

    const result = layoutMulticol(root, { inlineSize: 800, blockSize: 200 });
    expect(result.fragment.inlineSize).toBe(800);
  });
});
