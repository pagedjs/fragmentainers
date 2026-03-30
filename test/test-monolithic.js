import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFragments } from "../src/layout-request.js";
import { ConstraintSpace } from "../src/constraint-space.js";
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
    assert.equal(pages[0].childFragments.length, 1);
    assert.equal(pages[0].blockSize, 50);
    assert.ok(pages[0].breakToken);
    assert.equal(pages[0].breakToken.childBreakTokens[0].isBreakBefore, true);

    // Page 2: img sliced to 200px (last resort: monolithic exceeds page)
    assert.equal(pages[1].childFragments.length, 1);
    assert.equal(pages[1].childFragments[0].blockSize, 200);

    // Page 3: remaining 100px of img + after (50px)
    assert.ok(pages.length >= 3);
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

    assert.equal(pages.length, 3);
    assert.equal(pages[0].childFragments[0].blockSize, 200);
    assert.equal(pages[1].childFragments[0].blockSize, 200);
    assert.equal(pages[2].childFragments[0].blockSize, 100);
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
    assert.ok(pages[0].childFragments[0].breakToken);
    assert.equal(pages[0].childFragments[0].breakToken.consumedBlockSize, 200);
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

    assert.equal(pages[0].childFragments.length, 1); // just header
    assert.equal(pages[1].childFragments[0].blockSize, 150); // scroller sliced
    assert.ok(pages.length >= 3); // remaining scroller on page 3
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
    assert.equal(pages.length, 1);
    assert.equal(pages[0].childFragments.length, 2);
  });
});
