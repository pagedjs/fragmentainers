import { describe, it, expect } from "vitest";
import { runLayoutGenerator, getLayoutAlgorithm } from "../../src/core/layout-request.js";
import { layoutGridContainer } from "../../src/layout/grid-container.js";
import { ConstraintSpace } from "../../src/core/constraint-space.js";
import { blockNode, gridNode, gridItemNode } from "../fixtures/nodes.js";

function layoutGrid(node, { inlineSize = 600, blockSize = 400, fragmentationType = "none" } = {}) {
  const cs = new ConstraintSpace({
    availableInlineSize: inlineSize,
    availableBlockSize: blockSize,
    fragmentainerBlockSize: blockSize,
    blockOffsetInFragmentainer: 0,
    fragmentationType,
  });
  return runLayoutGenerator(getLayoutAlgorithm(node), node, cs, null);
}

describe("layoutGridContainer", () => {
  it("dispatches grid nodes to the grid algorithm", () => {
    const node = gridNode();
    expect(getLayoutAlgorithm(node)).toBe(layoutGridContainer);
  });

  it("lays out single-row grid items as parallel flows", () => {
    const root = gridNode({
      children: [
        gridItemNode({ debugName: "A", blockSize: 100, gridRowStart: 1 }),
        gridItemNode({ debugName: "B", blockSize: 80, gridRowStart: 1 }),
      ],
    });

    const result = layoutGrid(root);
    // One grid row containing both items
    expect(result.fragment.childFragments.length).toBe(1);
    const row = result.fragment.childFragments[0];
    expect(row.childFragments.length).toBe(2);
    // Tallest item (100) drives row height
    expect(row.blockSize).toBe(100);
  });

  it("multi-row grid stacks rows", () => {
    const root = gridNode({
      children: [
        gridItemNode({ debugName: "A", blockSize: 100, gridRowStart: 1 }),
        gridItemNode({ debugName: "B", blockSize: 80, gridRowStart: 2 }),
      ],
    });

    const result = layoutGrid(root);
    expect(result.fragment.childFragments.length).toBe(2);
    expect(result.fragment.blockSize).toBe(180); // 100 + 80
  });

  it("items in the same row fragment independently (parallel flows)", () => {
    const root = gridNode({
      children: [
        gridItemNode({ debugName: "A", blockSize: 200, gridRowStart: 1 }),
        gridItemNode({ debugName: "B", blockSize: 50, gridRowStart: 1 }),
      ],
    });

    // Fragmentainer height 100: A breaks, B completes
    const result = layoutGrid(root, { blockSize: 100, fragmentationType: "page" });
    expect(result.breakToken).toBeTruthy();
  });

  it("completed items get isAtBlockEnd tokens", () => {
    const root = gridNode({
      children: [
        gridItemNode({ debugName: "A", blockSize: 200, gridRowStart: 1 }),
        gridItemNode({ debugName: "B", blockSize: 50, gridRowStart: 1 }),
      ],
    });

    const result = layoutGrid(root, { blockSize: 100, fragmentationType: "page" });
    // Row break token should exist
    expect(result.breakToken).toBeTruthy();
  });

  it("break token has kGridData with rowIndex", () => {
    const root = gridNode({
      children: [
        gridItemNode({ debugName: "A", blockSize: 200, gridRowStart: 1 }),
      ],
    });

    const result = layoutGrid(root, { blockSize: 100, fragmentationType: "page" });
    expect(result.breakToken).toBeTruthy();
    expect(result.breakToken.algorithmData.type).toBe("GridData");
    expect(typeof result.breakToken.algorithmData.rowIndex).toBe("number");
  });

  it("empty grid container produces zero-height fragment", () => {
    const root = gridNode({ children: [] });
    const result = layoutGrid(root);
    expect(result.fragment.blockSize).toBe(0);
    expect(result.breakToken).toBe(null);
  });

  it("auto-placed items (no gridRowStart) each get their own row", () => {
    const root = gridNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50 }),
      ],
    });

    const result = layoutGrid(root);
    // Each auto-placed item is its own row
    expect(result.fragment.childFragments.length).toBe(2);
    expect(result.fragment.blockSize).toBe(100);
  });
});
