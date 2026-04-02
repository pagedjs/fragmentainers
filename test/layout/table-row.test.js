import { describe, it, expect } from "vitest";
import { createFragments, runLayoutGenerator } from "../../src/core/layout-request.js";
import { layoutTableRow } from "../../src/layout/table-row.js";
import { ConstraintSpace } from "../../src/core/constraint-space.js";
import { blockNode, tableRowNode } from "../fixtures/nodes.js";

describe("Phase 6: Parallel flows (table row)", () => {
  it("lays out a table row where all cells fit", () => {
    const row = tableRowNode({
      cells: [
        blockNode({ debugName: "cellA", blockSize: 50 }),
        blockNode({ debugName: "cellB", blockSize: 80 }),
        blockNode({ debugName: "cellC", blockSize: 30 }),
      ],
    });

    const space = new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 800,
      fragmentainerBlockSize: 800,
      fragmentationType: "page",
    });

    const result = runLayoutGenerator(layoutTableRow, row, space, null);

    // Row height = max cell height = 80
    expect(result.fragment.blockSize).toBe(80);
    expect(result.fragment.childFragments.length).toBe(3);
    expect(result.breakToken).toBe(null);
  });

  it("all cells get break tokens when any cell overflows", () => {
    const row = tableRowNode({
      cells: [
        blockNode({ debugName: "cellA", blockSize: 100 }),
        blockNode({ debugName: "cellB", blockSize: 300 }),
        blockNode({ debugName: "cellC", blockSize: 50 }),
      ],
    });

    const space = new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    });

    const result = runLayoutGenerator(layoutTableRow, row, space, null);

    // Cell B (300px) fragments: 200px on page 1
    expect(result.breakToken).toBeTruthy();
    expect(result.breakToken.childBreakTokens.length).toBe(3);
    expect(result.breakToken.algorithmData.type).toBe("TableRowData");

    // Cells A and C should have isAtBlockEnd tokens
    const tokenA = result.breakToken.childBreakTokens[0];
    const tokenC = result.breakToken.childBreakTokens[2];
    expect(tokenA.isAtBlockEnd).toBe(true);
    expect(tokenA.hasSeenAllChildren).toBe(true);
    expect(tokenC.isAtBlockEnd).toBe(true);

    // Cell B should NOT be at block end
    const tokenB = result.breakToken.childBreakTokens[1];
    expect(tokenB.isAtBlockEnd).toBe(false);
    expect(tokenB.consumedBlockSize > 0).toBeTruthy();
  });

  it("resumes correctly with completed cells producing zero-height fragments", () => {
    const cellA = blockNode({ debugName: "cellA", blockSize: 100 });
    const cellB = blockNode({ debugName: "cellB", blockSize: 300 });
    const cellC = blockNode({ debugName: "cellC", blockSize: 50 });

    const row = tableRowNode({ cells: [cellA, cellB, cellC] });
    const root = blockNode({ children: [row] });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));

    expect(pages.length).toBe(2);

    // Page 1: row with max height 200 (cell B's partial fragment)
    expect(pages[0].blockSize).toBe(200);

    // Page 2: resumed row. Cell A and C produce 0-height (already done).
    // Cell B produces remaining 100px.
    expect(pages[1].blockSize > 0).toBeTruthy();
    expect(pages[1].breakToken).toBe(null);
  });

  it("row height is driven by tallest cell", () => {
    const row = tableRowNode({
      cells: [
        blockNode({ debugName: "short", blockSize: 20 }),
        blockNode({ debugName: "tall", blockSize: 150 }),
      ],
    });

    const space = new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 800,
      fragmentainerBlockSize: 800,
      fragmentationType: "page",
    });

    const result = runLayoutGenerator(layoutTableRow, row, space, null);
    expect(result.fragment.blockSize).toBe(150);
  });
});
