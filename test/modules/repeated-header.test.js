import { describe, it, expect } from "vitest";
import { ConstraintSpace } from "../../src/core/constraint-space.js";
import { BlockBreakToken } from "../../src/core/tokens.js";
import { FRAGMENTATION_PAGE, FRAGMENTATION_COLUMN } from "../../src/core/constants.js";
import { RepeatedTableHeader } from "../../src/modules/repeated-header.js";
import { blockNode, tableNode, tableHeaderNode } from "../fixtures/nodes.js";

function pageSpace(blockSize = 300) {
  return new ConstraintSpace({
    availableInlineSize: 600,
    availableBlockSize: blockSize,
    fragmentainerBlockSize: blockSize,
    fragmentationType: FRAGMENTATION_PAGE,
  });
}

describe("RepeatedTableHeader.beforeChildren", () => {
  it("returns layout request for thead on table continuation", () => {
    const thead = tableHeaderNode({
      children: [blockNode({ blockSize: 40 })],
    });
    const table = tableNode({
      children: [
        thead,
        blockNode({ blockSize: 100 }),
      ],
    });

    const breakToken = new BlockBreakToken(table);
    const result = RepeatedTableHeader.beforeChildren(table, pageSpace(), breakToken);

    expect(result).not.toBeNull();
    expect(result.node).toBe(thead);
    expect(result.isRepeated).toBe(true);
  });

  it("returns null when there is no break token", () => {
    const table = tableNode({
      children: [
        tableHeaderNode({ children: [blockNode({ blockSize: 40 })] }),
        blockNode({ blockSize: 100 }),
      ],
    });

    const result = RepeatedTableHeader.beforeChildren(table, pageSpace(), null);
    expect(result).toBeNull();
  });

  it("returns null for non-table nodes", () => {
    const root = blockNode({
      children: [blockNode({ blockSize: 100 })],
    });
    const breakToken = new BlockBreakToken(root, 0, 100, []);

    const result = RepeatedTableHeader.beforeChildren(root, pageSpace(), breakToken);
    expect(result).toBeNull();
  });

  it("returns null in column fragmentation mode", () => {
    const thead = tableHeaderNode({
      children: [blockNode({ blockSize: 40 })],
    });
    const table = tableNode({
      children: [thead, blockNode({ blockSize: 100 })],
    });

    const cs = new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 300,
      fragmentainerBlockSize: 300,
      fragmentationType: FRAGMENTATION_COLUMN,
    });
    const breakToken = new BlockBreakToken(table);

    const result = RepeatedTableHeader.beforeChildren(table, cs, breakToken);
    expect(result).toBeNull();
  });

  it("returns null when thead has an active break token", () => {
    const thead = tableHeaderNode({
      children: [blockNode({ blockSize: 40 })],
    });
    const table = tableNode({
      children: [thead, blockNode({ blockSize: 100 })],
    });

    const theadBT = new BlockBreakToken(thead);
    const breakToken = new BlockBreakToken(table);
    breakToken.childBreakTokens = [theadBT];

    const result = RepeatedTableHeader.beforeChildren(table, pageSpace(), breakToken);
    expect(result).toBeNull();
  });

  it("returns null when table has no thead", () => {
    const table = tableNode({
      children: [
        blockNode({ blockSize: 100 }),
        blockNode({ blockSize: 100 }),
      ],
    });
    const breakToken = new BlockBreakToken(table);

    const result = RepeatedTableHeader.beforeChildren(table, pageSpace(), breakToken);
    expect(result).toBeNull();
  });
});
