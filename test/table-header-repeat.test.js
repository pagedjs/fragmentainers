import { describe, it, expect } from "vitest";
import { createFragments, runLayoutGenerator } from "../src/core/layout-request.js";
import { layoutBlockContainer } from "../src/layout/block-container.js";
import { ConstraintSpace } from "../src/core/constraint-space.js";
import { blockNode, tableNode, tableHeaderNode } from "./fixtures/nodes.js";
import { FRAGMENTATION_PAGE, FRAGMENTATION_COLUMN } from "../src/core/constants.js";

describe("Repeating table headers", () => {
  function pageSpace(blockSize = 300) {
    return new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: blockSize,
      fragmentainerBlockSize: blockSize,
      fragmentationType: FRAGMENTATION_PAGE,
    });
  }

  it("repeats thead on page 2 when table breaks across pages", () => {
    const thead = tableHeaderNode({
      children: [blockNode({ debugName: "header-row", blockSize: 40 })],
    });
    const table = tableNode({
      children: [
        thead,
        blockNode({ debugName: "row1", blockSize: 100 }),
        blockNode({ debugName: "row2", blockSize: 100 }),
        blockNode({ debugName: "row3", blockSize: 100 }),
      ],
    });
    const root = blockNode({ children: [table] });

    // Page height 300: thead(40) + row1(100) + row2(100) = 240 fits page 1
    // row3(100) won't fit → page 2 with repeated thead
    const pages = createFragments(root, pageSpace(250));

    expect(pages.length).toBe(2);

    // Page 2 should contain the table continuation
    const page2Table = pages[1].childFragments[0];
    expect(page2Table).toBeDefined();

    // First child fragment on page 2 should be the repeated header
    const repeatedHeader = page2Table.childFragments[0];
    expect(repeatedHeader.isRepeated).toBe(true);
    expect(repeatedHeader.node).toBe(thead);
    expect(repeatedHeader.blockSize).toBe(40);
  });

  it("does not repeat when table fits on one page", () => {
    const thead = tableHeaderNode({
      children: [blockNode({ debugName: "header-row", blockSize: 40 })],
    });
    const table = tableNode({
      children: [
        thead,
        blockNode({ debugName: "row1", blockSize: 50 }),
      ],
    });
    const root = blockNode({ children: [table] });

    const pages = createFragments(root, pageSpace(300));
    expect(pages.length).toBe(1);
    // No repeated fragments
    const tableFragment = pages[0].childFragments[0];
    for (const child of tableFragment.childFragments) {
      expect(child.isRepeated).toBe(false);
    }
  });

  it("does not repeat thead in column fragmentation mode", () => {
    const thead = tableHeaderNode({
      children: [blockNode({ debugName: "header-row", blockSize: 40 })],
    });
    const table = tableNode({
      children: [
        thead,
        blockNode({ debugName: "row1", blockSize: 100 }),
        blockNode({ debugName: "row2", blockSize: 100 }),
        blockNode({ debugName: "row3", blockSize: 100 }),
      ],
    });
    const root = blockNode({ children: [table] });

    const space = new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 250,
      fragmentainerBlockSize: 250,
      fragmentationType: FRAGMENTATION_COLUMN,
    });
    const pages = createFragments(root, space);

    // Should still break but no repeated headers
    expect(pages.length).toBeGreaterThan(1);
    for (let p = 1; p < pages.length; p++) {
      const tableFragment = pages[p].childFragments[0];
      if (tableFragment) {
        for (const child of tableFragment.childFragments) {
          expect(child.isRepeated).toBe(false);
        }
      }
    }
  });

  it("does not repeat when table has no thead", () => {
    const table = tableNode({
      children: [
        blockNode({ debugName: "row1", blockSize: 100 }),
        blockNode({ debugName: "row2", blockSize: 100 }),
        blockNode({ debugName: "row3", blockSize: 100 }),
      ],
    });
    const root = blockNode({ children: [table] });

    const pages = createFragments(root, pageSpace(250));
    expect(pages.length).toBe(2);

    const page2Table = pages[1].childFragments[0];
    for (const child of page2Table.childFragments) {
      expect(child.isRepeated).toBe(false);
    }
  });

  it("repeats thead even when it is tall", () => {
    const thead = tableHeaderNode({
      children: [blockNode({ debugName: "header-row", blockSize: 120 })],
    });
    const table = tableNode({
      children: [
        thead,
        blockNode({ debugName: "row1", blockSize: 100 }),
        blockNode({ debugName: "row2", blockSize: 100 }),
        blockNode({ debugName: "row3", blockSize: 100 }),
      ],
    });
    const root = blockNode({ children: [table] });

    // Page 300: thead(120) + row1(100) = 220 fits; row2 pushes to page 2
    const pages = createFragments(root, pageSpace(300));
    expect(pages.length).toBeGreaterThan(1);

    const page2Table = pages[1].childFragments[0];
    const repeatedHeader = page2Table.childFragments[0];
    expect(repeatedHeader.isRepeated).toBe(true);
    expect(repeatedHeader.blockSize).toBe(120);
  });

  it("repeats thead on every continuation page across multiple pages", () => {
    const thead = tableHeaderNode({
      children: [blockNode({ debugName: "header-row", blockSize: 30 })],
    });
    const rows = [];
    for (let i = 0; i < 10; i++) {
      rows.push(blockNode({ debugName: `row${i}`, blockSize: 50 }));
    }
    const table = tableNode({
      children: [thead, ...rows],
    });
    const root = blockNode({ children: [table] });

    // Page 150: thead(30) + 2 rows(100) = 130 per page (with header repeated)
    const pages = createFragments(root, pageSpace(150));
    expect(pages.length).toBeGreaterThan(2);

    // Every page after the first should have a repeated header
    for (let p = 1; p < pages.length; p++) {
      const tableFragment = pages[p].childFragments[0];
      const firstChild = tableFragment.childFragments[0];
      expect(firstChild.isRepeated).toBe(true);
      expect(firstChild.node).toBe(thead);
    }
  });

  it("hasSeenAllChildren is correct when repeated header is present", () => {
    const thead = tableHeaderNode({
      children: [blockNode({ debugName: "header-row", blockSize: 30 })],
    });
    const table = tableNode({
      children: [
        thead,
        blockNode({ debugName: "row1", blockSize: 100 }),
        blockNode({ debugName: "row2", blockSize: 100 }),
        blockNode({ debugName: "row3", blockSize: 100 }),
      ],
    });
    const root = blockNode({ children: [table] });

    // Page 160: page 1 = thead(30) + row1(100) + row2_partial(30) = 160
    // page 2 = repeated thead(30) + row2_remaining(70) + row3_partial(60) = 160
    // page 3 = repeated thead(30) + row3_remaining(40) = 70
    const pages = createFragments(root, pageSpace(160));
    expect(pages.length).toBe(3);

    // Page 2: table should still have a break token (row3 partially remains)
    const page2Table = pages[1].childFragments[0];
    expect(page2Table.breakToken).not.toBeNull();

    // Page 3: table should complete (no break token)
    const page3Table = pages[2].childFragments[0];
    expect(page3Table.breakToken).toBeNull();
  });

  it("reduces available space for body content by header height", () => {
    const thead = tableHeaderNode({
      children: [blockNode({ debugName: "header-row", blockSize: 60 })],
    });
    const table = tableNode({
      children: [
        thead,
        blockNode({ debugName: "row1", blockSize: 80 }),
        blockNode({ debugName: "row2", blockSize: 80 }),
        blockNode({ debugName: "row3", blockSize: 80 }),
      ],
    });
    const root = blockNode({ children: [table] });

    // Page 200: page 1 = thead(60) + row1(80) + row2(60 of 80) → breaks
    // page 2 = repeated thead(60) + row2 continuation + row3
    const pages = createFragments(root, pageSpace(200));
    expect(pages.length).toBeGreaterThan(1);

    // Page 2 table's first fragment must be the repeated header
    const page2Table = pages[1].childFragments[0];
    expect(page2Table.childFragments[0].isRepeated).toBe(true);
    expect(page2Table.childFragments[0].blockSize).toBe(60);
  });
});

describe("break-inside: avoid push for tables", () => {
  function pageSpace(blockSize = 300) {
    return new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: blockSize,
      fragmentainerBlockSize: blockSize,
      fragmentationType: FRAGMENTATION_PAGE,
    });
  }

  it("pushes a break-inside:avoid table that does not fit to the next page", () => {
    // Content before the table fills most of the page
    const table = tableNode({
      blockSize: 200,
      breakInside: "avoid",
      children: [
        blockNode({ debugName: "row1", blockSize: 80 }),
        blockNode({ debugName: "row2", blockSize: 80 }),
      ],
    });
    const root = blockNode({
      children: [
        blockNode({ debugName: "para", blockSize: 200 }),
        table,
      ],
    });

    // Page 300: para(200) fills most of page, table(200) doesn't fit
    // in remaining 100. Table should be pushed to page 2.
    const pages = createFragments(root, pageSpace(300));
    expect(pages.length).toBe(2);

    // Page 1: only the paragraph
    expect(pages[0].childFragments.length).toBe(1);
    expect(pages[0].childFragments[0].node.debugName).toBe("para");

    // Page 2: the table
    expect(pages[1].childFragments[0].node).toBe(table);
  });

  it("does not push when table is the first element on the page", () => {
    // Table is larger than a full page — can't push, must break
    const table = tableNode({
      blockSize: 500,
      breakInside: "avoid",
      children: [
        blockNode({ debugName: "row1", blockSize: 200 }),
        blockNode({ debugName: "row2", blockSize: 200 }),
      ],
    });
    const root = blockNode({ children: [table] });

    // Page 300: table(500) exceeds page, but it's the first element
    // so it can't be pushed. Must break inside.
    const pages = createFragments(root, pageSpace(300));
    expect(pages.length).toBeGreaterThan(1);

    // Page 1 should contain part of the table (not empty)
    expect(pages[0].childFragments[0].node).toBe(table);
    expect(pages[0].blockSize).toBeGreaterThan(0);
  });

  it("does not push when table fits in remaining space", () => {
    const table = tableNode({
      blockSize: 80,
      breakInside: "avoid",
      children: [
        blockNode({ debugName: "row1", blockSize: 40 }),
        blockNode({ debugName: "row2", blockSize: 40 }),
      ],
    });
    const root = blockNode({
      children: [
        blockNode({ debugName: "para", blockSize: 100 }),
        table,
      ],
    });

    // Page 300: para(100) + table(80) = 180, fits on one page
    const pages = createFragments(root, pageSpace(300));
    expect(pages.length).toBe(1);
  });
});
