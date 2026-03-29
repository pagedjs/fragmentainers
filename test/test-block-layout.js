import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFragments, runLayoutGenerator } from "../src/driver.js";
import { layoutBlockContainer } from "../src/layout/block-container.js";
import { ConstraintSpace } from "../src/constraint-space.js";
import { blockNode } from "./fixtures/nodes.js";

describe("Phase 2: Block layout (single fragmentainer)", () => {
  it("lays out a single leaf node", () => {
    const root = blockNode({ debugName: "root", blockSize: 50, children: [] });
    const space = new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 800,
      fragmentainerBlockSize: 800,
      fragmentationType: "page",
    });

    const result = runLayoutGenerator(layoutBlockContainer, root, space, null);
    assert.equal(result.fragment.blockSize, 50); // leaf uses intrinsic block size
    assert.equal(result.breakToken, null);
  });

  it("lays out a root with block children that all fit", () => {
    const root = blockNode({
      debugName: "root",
      children: [
        blockNode({ debugName: "a", blockSize: 100 }),
        blockNode({ debugName: "b", blockSize: 150 }),
        blockNode({ debugName: "c", blockSize: 50 }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 800,
      fragmentainerBlockSize: 800,
      fragmentationType: "page",
    }));
    assert.equal(pages.length, 1);
    assert.equal(pages[0].blockSize, 300);
    assert.equal(pages[0].childFragments.length, 3);
    assert.equal(pages[0].breakToken, null);
  });

  it("lays out nested block containers", () => {
    const root = blockNode({
      debugName: "root",
      children: [
        blockNode({
          debugName: "outer",
          children: [
            blockNode({ debugName: "inner1", blockSize: 50 }),
            blockNode({ debugName: "inner2", blockSize: 75 }),
          ],
        }),
        blockNode({ debugName: "sibling", blockSize: 100 }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 800,
      fragmentainerBlockSize: 800,
      fragmentationType: "page",
    }));
    assert.equal(pages.length, 1);
    assert.equal(pages[0].blockSize, 225); // 50 + 75 + 100
    assert.equal(pages[0].childFragments.length, 2);
    // outer fragment should contain inner1 + inner2
    assert.equal(pages[0].childFragments[0].blockSize, 125);
    assert.equal(pages[0].childFragments[0].childFragments.length, 2);
  });

  it("sets inlineSize on fragments", () => {
    const root = blockNode({
      children: [blockNode({ blockSize: 50 })],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 800,
      fragmentainerBlockSize: 800,
      fragmentationType: "page",
    }));
    assert.equal(pages[0].inlineSize, 600);
  });
});

describe("Phase 3: Block fragmentation across fragmentainers", () => {
  it("splits content across 2 pages", () => {
    const root = blockNode({
      debugName: "root",
      children: [
        blockNode({ debugName: "a", blockSize: 100 }),
        blockNode({ debugName: "b", blockSize: 100 }),
        blockNode({ debugName: "c", blockSize: 100 }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));
    assert.equal(pages.length, 2);

    // Page 1: children a + b = 200px (fills exactly)
    assert.equal(pages[0].blockSize, 200);
    assert.equal(pages[0].childFragments.length, 2);
    assert.notEqual(pages[0].breakToken, null);

    // Page 2: child c = 100px
    assert.equal(pages[1].blockSize, 100);
    assert.equal(pages[1].childFragments.length, 1);
    assert.equal(pages[1].breakToken, null);
  });

  it("splits content across 3 pages", () => {
    const children = Array.from({ length: 5 }, (_, i) =>
      blockNode({ debugName: `child${i}`, blockSize: 100 })
    );
    const root = blockNode({ debugName: "root", children });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));
    assert.equal(pages.length, 3);
    assert.equal(pages[0].childFragments.length, 2); // 200px
    assert.equal(pages[1].childFragments.length, 2); // 200px
    assert.equal(pages[2].childFragments.length, 1); // 100px
  });

  it("break token has correct consumedBlockSize and sequenceNumber", () => {
    const root = blockNode({
      children: [
        blockNode({ blockSize: 100 }),
        blockNode({ blockSize: 100 }),
        blockNode({ blockSize: 100 }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));
    const bt = pages[0].breakToken;
    assert.equal(bt.consumedBlockSize, 200);
    assert.equal(bt.sequenceNumber, 0);
  });

  it("handles nested container breaking mid-child", () => {
    const root = blockNode({
      debugName: "root",
      children: [
        blockNode({ debugName: "before", blockSize: 50 }),
        blockNode({
          debugName: "container",
          children: [
            blockNode({ debugName: "inner1", blockSize: 100 }),
            blockNode({ debugName: "inner2", blockSize: 100 }),
          ],
        }),
      ],
    });

    // Fragmentainer = 120px. 'before' takes 50px. 'container' gets 70px.
    // inner1 (100px) fragments: 70px on page 1, 30px on page 2.
    // inner2 (100px) fragments across pages 2 and 3.
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 120,
      fragmentainerBlockSize: 120,
      fragmentationType: "page",
    }));

    assert.equal(pages.length, 3);
    // Page 1 break token should have container's break token as child
    const rootBT = pages[0].breakToken;
    assert.ok(rootBT);
    assert.equal(rootBT.childBreakTokens.length, 1);
    const containerBT = rootBT.childBreakTokens[0];
    assert.equal(containerBT.node.debugName, "container");
  });

  it("handles the exact-fill edge case (createBreakBefore)", () => {
    // Children fill space exactly, more remain, no child broke
    const root = blockNode({
      children: [
        blockNode({ debugName: "a", blockSize: 100 }),
        blockNode({ debugName: "b", blockSize: 100 }),
        blockNode({ debugName: "c", blockSize: 50 }),
      ],
    });

    // 200px fragmentainer, a+b fill it exactly, c remains
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));
    assert.equal(pages.length, 2);

    const bt = pages[0].breakToken;
    assert.ok(bt);
    // Should have a createBreakBefore token for 'c'
    assert.equal(bt.childBreakTokens.length, 1);
    assert.equal(bt.childBreakTokens[0].isBreakBefore, true);
    assert.equal(bt.childBreakTokens[0].node.debugName, "c");

    // Page 2 should have 'c'
    assert.equal(pages[1].blockSize, 50);
    assert.equal(pages[1].childFragments.length, 1);
  });

  it("uses varying fragmentainer sizes", () => {
    const root = blockNode({
      children: [
        blockNode({ blockSize: 100 }),
        blockNode({ blockSize: 100 }),
        blockNode({ blockSize: 100 }),
      ],
    });

    // Page 1: 150px — child0 (100) + child1 partial (50) = 150
    // Page 2: 250px — child1 remainder (50) + child2 (100) = 150
    const pages = createFragments(root, {
      resolve: (index) => {
        const sizes = [
          { inlineSize: 600, blockSize: 150 },
          { inlineSize: 600, blockSize: 250 },
        ];
        const size = sizes[index] || sizes.at(-1);
        return {
          toConstraintSpace: () => new ConstraintSpace({
            availableInlineSize: size.inlineSize,
            availableBlockSize: size.blockSize,
            fragmentainerBlockSize: size.blockSize,
            fragmentationType: "page",
          }),
        };
      },
    });
    assert.equal(pages.length, 2);
    assert.equal(pages[0].childFragments.length, 2); // child0 full + child1 partial
    assert.equal(pages[1].childFragments.length, 2); // child1 remainder + child2
  });

  it("last fragmentainer size is reused for subsequent pages", () => {
    const children = Array.from({ length: 6 }, (_, i) =>
      blockNode({ debugName: `child${i}`, blockSize: 100 })
    );
    const root = blockNode({ children });

    // Only one size provided, reused for all pages
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));
    assert.equal(pages.length, 3);
  });
});

// ---------------------------------------------------------------------------
// box-decoration-break: clone layout
// ---------------------------------------------------------------------------

describe("box-decoration-break: clone layout", () => {
  // Uses a single child that overflows to create exactly 2 fragments.
  // Container: padding-top=10, padding-bottom=10. Fragmentainer: 200px.
  // Child: 250px. Available on first fragment: 200 - 10 (top) - 10 (bottom reserved) = 180.

  it("includes containerBoxStart in continuation fragment blockOffset", () => {
    const root = blockNode({
      debugName: "clone-container",
      paddingBlockStart: 10,
      paddingBlockEnd: 10,
      boxDecorationBreak: "clone",
      children: [
        blockNode({ debugName: "child", blockSize: 250 }),
      ],
    });

    const fragments = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));

    assert.equal(fragments.length, 2);

    // Continuation fragment should include containerBoxStart (10) because clone
    // repeats decorations: padding-top (10) + remaining child (70) + padding-bottom (10) = 90
    assert.equal(fragments[1].blockSize, 90);
  });

  it("includes containerBoxEnd on non-final fragments with clone", () => {
    const root = blockNode({
      debugName: "clone-container",
      paddingBlockStart: 10,
      paddingBlockEnd: 10,
      boxDecorationBreak: "clone",
      children: [
        blockNode({ debugName: "child", blockSize: 250 }),
      ],
    });

    const fragments = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));

    assert.equal(fragments.length, 2);

    // Non-final fragment should include containerBoxEnd (padding-bottom)
    // padding-top (10) + child portion (180) + padding-bottom (10) = 200
    assert.equal(fragments[0].blockSize, 200);
  });

  it("slice mode does NOT include containerBoxStart on continuation", () => {
    const root = blockNode({
      debugName: "slice-container",
      paddingBlockStart: 10,
      paddingBlockEnd: 10,
      boxDecorationBreak: "slice",
      children: [
        blockNode({ debugName: "child", blockSize: 250 }),
      ],
    });

    const fragments = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));

    assert.equal(fragments.length, 2);

    // Slice first fragment: padding-top (10) + child portion (180) = 190 (no bottom padding)
    assert.equal(fragments[0].blockSize, 190);

    // Slice continuation: NO padding-top, child remainder (70) + padding-bottom (10) = 80
    assert.equal(fragments[1].blockSize, 80);
  });
});
