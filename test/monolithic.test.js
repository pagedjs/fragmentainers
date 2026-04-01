import { describe, it, expect } from "vitest";
import { createFragments } from "../src/core/layout-request.js";
import { ConstraintSpace } from "../src/core/constraint-space.js";
import { blockNode, replacedNode, scrollableNode } from "./fixtures/nodes.js";

describe("Phase 4: Monolithic content", () => {
  it("pushes a monolithic element to the next page when it does not fit", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "div", blockSize: 50 }),
        replacedNode({ debugName: "img", blockSize: 300 }),
        blockNode({ debugName: "after", blockSize: 50 }),
      ],
    });

    // 200px fragmentainer. div=50, img=300 doesn't fit (150 remaining), pushed.
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));

    // Page 1: just the div (img pushed)
    expect(pages[0].childFragments.length).toBe(1);
    expect(pages[0].blockSize).toBe(50);
    expect(pages[0].breakToken).toBeTruthy();
    expect(pages[0].breakToken.childBreakTokens[0].isBreakBefore).toBe(true);

    // Page 2: img sliced to 200px (last resort: monolithic exceeds page)
    expect(pages[1].childFragments.length).toBe(1);
    expect(pages[1].childFragments[0].blockSize).toBe(200);

    // Page 3: remaining 100px of img + after (50px)
    expect(pages.length >= 3).toBeTruthy();
  });

  it("slices monolithic at page boundary when it exceeds the page", () => {
    const root = blockNode({
      children: [
        replacedNode({ debugName: "big-img", blockSize: 500 }),
      ],
    });

    // 200px page. img=500 → sliced across 3 pages (200+200+100).
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));

    expect(pages.length).toBe(3);
    expect(pages[0].childFragments[0].blockSize).toBe(200);
    expect(pages[1].childFragments[0].blockSize).toBe(200);
    expect(pages[2].childFragments[0].blockSize).toBe(100);
  });

  it("monolithic elements produce break tokens when sliced in page mode", () => {
    const root = blockNode({
      children: [
        replacedNode({ debugName: "img", blockSize: 500 }),
        blockNode({ debugName: "after", blockSize: 50 }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));

    // img sliced: first fragment has a break token
    expect(pages[0].childFragments[0].breakToken).toBeTruthy();
    expect(pages[0].childFragments[0].breakToken.consumedBlockSize).toBe(200);
  });

  it("pushes scrollable monolithic then slices if exceeds page", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "header", blockSize: 100 }),
        scrollableNode({ debugName: "scroller", blockSize: 200 }),
      ],
    });

    // 150px page. header=100, scroller=200 doesn't fit (50 remaining) → pushed.
    // On page 2, scroller (200) > page (150) → sliced: 150 + 50.
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 150,
      fragmentainerBlockSize: 150,
      fragmentationType: "page",
    }));

    expect(pages[0].childFragments.length).toBe(1); // just header
    expect(pages[1].childFragments[0].blockSize).toBe(150); // scroller sliced
    expect(pages.length >= 3).toBeTruthy(); // remaining scroller on page 3
  });

  it("monolithic element that fits is placed normally", () => {
    const root = blockNode({
      children: [
        replacedNode({ debugName: "small-img", blockSize: 100 }),
        blockNode({ debugName: "text", blockSize: 50 }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));
    expect(pages.length).toBe(1);
    expect(pages[0].childFragments.length).toBe(2);
  });
});
