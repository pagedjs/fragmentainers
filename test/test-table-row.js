import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFragments, runLayoutGenerator } from "../src/layout-request.js";
import { layoutTableRow } from "../src/layout/table-row.js";
import { ConstraintSpace } from "../src/constraint-space.js";
import { blockNode, tableRowNode } from "./fixtures/nodes.js";

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
    assert.equal(result.fragment.blockSize, 80);
    assert.equal(result.fragment.childFragments.length, 3);
    assert.equal(result.breakToken, null);
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
    assert.ok(result.breakToken);
    assert.equal(result.breakToken.childBreakTokens.length, 3);
    assert.equal(result.breakToken.algorithmData.type, "TableRowData");

    // Cells A and C should have isAtBlockEnd tokens
    const tokenA = result.breakToken.childBreakTokens[0];
    const tokenC = result.breakToken.childBreakTokens[2];
    assert.equal(tokenA.isAtBlockEnd, true);
    assert.equal(tokenA.hasSeenAllChildren, true);
    assert.equal(tokenC.isAtBlockEnd, true);

    // Cell B should NOT be at block end
    const tokenB = result.breakToken.childBreakTokens[1];
    assert.equal(tokenB.isAtBlockEnd, false);
    assert.ok(tokenB.consumedBlockSize > 0);
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

    assert.equal(pages.length, 2);

    // Page 1: row with max height 200 (cell B's partial fragment)
    assert.equal(pages[0].blockSize, 200);

    // Page 2: resumed row. Cell A and C produce 0-height (already done).
    // Cell B produces remaining 100px.
    assert.ok(pages[1].blockSize > 0);
    assert.equal(pages[1].breakToken, null);
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
    assert.equal(result.fragment.blockSize, 150);
  });
});
