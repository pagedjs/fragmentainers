import { describe, it, expect } from "vitest";
import { createFragments, runLayoutGenerator } from "../../src/core/layout-request.js";
import { layoutBlockContainer } from "../../src/layout/block-container.js";
import { ConstraintSpace } from "../../src/core/constraint-space.js";
import { blockNode } from "../fixtures/nodes.js";

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
    expect(result.fragment.blockSize).toBe(50); // leaf uses intrinsic block size
    expect(result.breakToken).toBe(null);
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
    expect(pages.length).toBe(1);
    expect(pages[0].blockSize).toBe(300);
    expect(pages[0].childFragments.length).toBe(3);
    expect(pages[0].breakToken).toBe(null);
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
    expect(pages.length).toBe(1);
    expect(pages[0].blockSize).toBe(225); // 50 + 75 + 100
    expect(pages[0].childFragments.length).toBe(2);
    // outer fragment should contain inner1 + inner2
    expect(pages[0].childFragments[0].blockSize).toBe(125);
    expect(pages[0].childFragments[0].childFragments.length).toBe(2);
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
    expect(pages[0].inlineSize).toBe(600);
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
    expect(pages.length).toBe(2);

    // Page 1: children a + b = 200px (fills exactly)
    expect(pages[0].blockSize).toBe(200);
    expect(pages[0].childFragments.length).toBe(2);
    expect(pages[0].breakToken).not.toBe(null);

    // Page 2: child c = 100px
    expect(pages[1].blockSize).toBe(100);
    expect(pages[1].childFragments.length).toBe(1);
    expect(pages[1].breakToken).toBe(null);
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
    expect(pages.length).toBe(3);
    expect(pages[0].childFragments.length).toBe(2); // 200px
    expect(pages[1].childFragments.length).toBe(2); // 200px
    expect(pages[2].childFragments.length).toBe(1); // 100px
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
    expect(bt.consumedBlockSize).toBe(200);
    expect(bt.sequenceNumber).toBe(0);
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

    expect(pages.length).toBe(3);
    // Page 1 break token should have container's break token as child
    const rootBT = pages[0].breakToken;
    expect(rootBT).toBeTruthy();
    expect(rootBT.childBreakTokens.length).toBe(1);
    const containerBT = rootBT.childBreakTokens[0];
    expect(containerBT.node.debugName).toBe("container");
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
    expect(pages.length).toBe(2);

    const bt = pages[0].breakToken;
    expect(bt).toBeTruthy();
    // Should have a createBreakBefore token for 'c'
    expect(bt.childBreakTokens.length).toBe(1);
    expect(bt.childBreakTokens[0].isBreakBefore).toBe(true);
    expect(bt.childBreakTokens[0].node.debugName).toBe("c");

    // Page 2 should have 'c'
    expect(pages[1].blockSize).toBe(50);
    expect(pages[1].childFragments.length).toBe(1);
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
    expect(pages.length).toBe(2);
    expect(pages[0].childFragments.length).toBe(2); // child0 full + child1 partial
    expect(pages[1].childFragments.length).toBe(2); // child1 remainder + child2
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
    expect(pages.length).toBe(3);
  });
});

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

    expect(fragments.length).toBe(2);

    // Continuation fragment should include containerBoxStart (10) because clone
    // repeats decorations: padding-top (10) + remaining child (70) + padding-bottom (10) = 90
    expect(fragments[1].blockSize).toBe(90);
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

    expect(fragments.length).toBe(2);

    // Non-final fragment should include containerBoxEnd (padding-bottom)
    // padding-top (10) + child portion (180) + padding-bottom (10) = 200
    expect(fragments[0].blockSize).toBe(200);
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

    expect(fragments.length).toBe(2);

    // Slice first fragment: padding-top (10) + child portion (180) = 190 (no bottom padding)
    expect(fragments[0].blockSize).toBe(190);

    // Slice continuation: NO padding-top, child remainder (70) + padding-bottom (10) = 80
    expect(fragments[1].blockSize).toBe(80);
  });
});
