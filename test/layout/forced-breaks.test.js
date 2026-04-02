import { describe, it, expect } from "vitest";
import { createFragments } from "../../src/core/layout-request.js";
import { ConstraintSpace } from "../../src/core/constraint-space.js";
import { blockNode } from "../fixtures/nodes.js";

describe("Phase 8: Forced breaks", () => {
  it("break-before: page forces a page break", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50, breakBefore: "page" }),
        blockNode({ debugName: "C", blockSize: 50 }),
      ],
    });

    // 1000px fragmentainer — everything fits, but forced break before B
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: "page",
    }));
    expect(pages.length).toBe(2);

    // Page 1: only A
    expect(pages[0].childFragments.length).toBe(1);
    expect(pages[0].blockSize).toBe(50);
    expect(pages[0].breakToken).toBeTruthy();
    expect(pages[0].breakToken.childBreakTokens[0].isForcedBreak).toBe(true);

    // Page 2: B + C
    expect(pages[1].childFragments.length).toBe(2);
    expect(pages[1].blockSize).toBe(100);
  });

  it("break-before: column forces a break", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50, breakBefore: "column" }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: "page",
    }));
    expect(pages.length).toBe(2);
  });

  it("break-before: always forces a break", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50, breakBefore: "always" }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: "page",
    }));
    expect(pages.length).toBe(2);
  });

  it("break-after: page forces a break after the element", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50, breakAfter: "page" }),
        blockNode({ debugName: "B", blockSize: 50 }),
        blockNode({ debugName: "C", blockSize: 50 }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: "page",
    }));
    expect(pages.length).toBe(2);

    // Page 1: only A
    expect(pages[0].childFragments.length).toBe(1);
    expect(pages[0].blockSize).toBe(50);

    // Page 2: B + C
    expect(pages[1].childFragments.length).toBe(2);
  });

  it("break-before on first child does nothing (already at top)", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50, breakBefore: "page" }),
        blockNode({ debugName: "B", blockSize: 50 }),
      ],
    });

    // First child has break-before but blockOffset is 0 → no effect
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: "page",
    }));
    expect(pages.length).toBe(1);
    expect(pages[0].childFragments.length).toBe(2);
  });

  it("break-after on last child does nothing", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50, breakAfter: "page" }),
      ],
    });

    // Last child has break-after but no more children → no break
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: "page",
    }));
    expect(pages.length).toBe(1);
  });

  it("multiple forced breaks produce multiple pages", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "ch1", blockSize: 50 }),
        blockNode({ debugName: "ch2", blockSize: 50, breakBefore: "page" }),
        blockNode({ debugName: "ch3", blockSize: 50, breakBefore: "page" }),
        blockNode({ debugName: "ch4", blockSize: 50 }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: "page",
    }));
    expect(pages.length).toBe(3);
    expect(pages[0].childFragments.length).toBe(1); // ch1
    expect(pages[1].childFragments.length).toBe(1); // ch2
    expect(pages[2].childFragments.length).toBe(2); // ch3 + ch4
  });

  it("break-before: avoid does not force a break", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50, breakBefore: "avoid" }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: "page",
    }));
    expect(pages.length).toBe(1);
  });
});
