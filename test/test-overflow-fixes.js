import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFragments } from "../src/layout-request.js";
import { ConstraintSpace } from "../src/constraint-space.js";
import { blockNode, inlineNode, textToInlineItems } from "./fixtures/nodes.js";

describe("Overflow fixes: margin truncation at breaks", () => {
  it("trailing margin is truncated when a child breaks", () => {
    // A paragraph with margin-bottom that breaks across pages.
    // The margin should NOT be added on the page where the break occurs.
    const words = Array.from({ length: 100 }, () => "word").join(" ");
    const para = inlineNode({
      debugName: "p",
      inlineItemsData: textToInlineItems(words),
      lineHeight: 20,
      measureText: (t) => t.length * 8,
      availableInlineSize: 200,
      marginBlockEnd: 16,
    });

    const root = blockNode({ children: [para] });
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 200,
      availableBlockSize: 100,
      fragmentainerBlockSize: 100,
      fragmentationType: "page",
    }));

    // Page 1 should NOT exceed 100px (the margin-bottom is truncated at break)
    assert.ok(pages.length > 1, "content should span multiple pages");
    assert.ok(pages[0].blockSize <= 100,
      `Page 1 blockSize ${pages[0].blockSize} should not exceed fragmentainer 100`);
  });

  it("trailing margin is truncated when next sibling is pushed", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "a", blockSize: 90, marginBlockEnd: 20 }),
        blockNode({ debugName: "b", blockSize: 50 }),
      ],
    });

    // 100px page: child 'a' is 90px, margin-end 20 would push to 110.
    // But 'b' gets pushed, so 'a's trailing margin is truncated.
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 200,
      availableBlockSize: 100,
      fragmentainerBlockSize: 100,
      fragmentationType: "page",
    }));
    assert.ok(pages[0].blockSize <= 100,
      `Page 1 blockSize ${pages[0].blockSize} should not exceed 100`);
  });

  it("trailing margin is included when all children fit", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "a", blockSize: 30, marginBlockEnd: 10 }),
        blockNode({ debugName: "b", blockSize: 30 }),
      ],
    });

    // 200px page: both fit (30 + 10 margin + 30 = 70). Trailing margin of 'b' is 0.
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 200,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));
    assert.equal(pages.length, 1);
    // blockSize should include margin between children
    assert.ok(pages[0].blockSize >= 70);
  });
});

describe("Overflow fixes: availableBlockSize propagation", () => {
  it("inline content respects parent padding reservation", () => {
    // Container with 20px bottom padding. Inline child should not fill
    // all the way to the page boundary — it should leave room for padding.
    const words = Array.from({ length: 200 }, () => "word").join(" ");
    const para = inlineNode({
      debugName: "p",
      inlineItemsData: textToInlineItems(words),
      lineHeight: 20,
      measureText: (t) => t.length * 8,
      availableInlineSize: 200,
    });

    const container = blockNode({
      debugName: "section",
      children: [para],
      paddingBlockEnd: 20,
    });

    const root = blockNode({ children: [container] });
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 200,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));

    // The section fragment on page 1 should not exceed 200px.
    // The inline content should stop at 180px (200 - 20px padding).
    assert.ok(pages[0].blockSize <= 200,
      `Page 1 blockSize ${pages[0].blockSize} should not exceed fragmentainer 200`);
  });

  it("leaf node respects parent padding reservation", () => {
    const container = blockNode({
      debugName: "section",
      children: [
        blockNode({ debugName: "tall-div", blockSize: 300 }),
      ],
      paddingBlockEnd: 20,
    });

    const root = blockNode({ children: [container] });
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 200,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));

    // Leaf (300px) should fragment respecting the 20px padding reservation
    assert.ok(pages[0].blockSize <= 200,
      `Page 1 blockSize ${pages[0].blockSize} should not exceed 200`);
  });
});

describe("Overflow fixes: insufficient space for inline content", () => {
  it("inline content defers to next page when less than one line fits", () => {
    // Place content so that only a fraction of a line height remains,
    // then start a paragraph. It should NOT force one line and overflow.
    const words = Array.from({ length: 50 }, () => "word").join(" ");
    const para = inlineNode({
      debugName: "p",
      inlineItemsData: textToInlineItems(words),
      lineHeight: 20,
      measureText: (t) => t.length * 8,
      availableInlineSize: 200,
    });

    const root = blockNode({
      children: [
        blockNode({ debugName: "fill", blockSize: 90 }), // leaves 10px
        para, // needs 20px per line — should defer
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 200,
      availableBlockSize: 100,
      fragmentainerBlockSize: 100,
      fragmentationType: "page",
    }));

    // Page 1: 'fill' (90px) + paragraph defers (0px) = 90px. No overflow.
    assert.ok(pages[0].blockSize <= 100,
      `Page 1 blockSize ${pages[0].blockSize} should not exceed 100`);
    assert.ok(pages.length >= 2, "paragraph should continue on page 2");
  });

  it("inline content still places one line at top of empty page", () => {
    // If the paragraph is the first thing on a page, it MUST place at
    // least one line to guarantee progress, even if the page is too short.
    const words = Array.from({ length: 50 }, () => "word").join(" ");
    const para = inlineNode({
      debugName: "p",
      inlineItemsData: textToInlineItems(words),
      lineHeight: 20,
      measureText: (t) => t.length * 8,
      availableInlineSize: 200,
    });

    const root = blockNode({ children: [para] });

    // Page height 15px < lineHeight 20px. Still must place one line.
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 200,
      availableBlockSize: 15,
      fragmentainerBlockSize: 15,
      fragmentationType: "page",
    }));
    assert.ok(pages.length > 1);
    // First page should have at least one line (20px, overflows by 5px — acceptable for progress)
    assert.ok(pages[0].blockSize >= 20);
  });

  it("margin collapsing works between siblings", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "a", blockSize: 40, marginBlockEnd: 20 }),
        blockNode({ debugName: "b", blockSize: 40, marginBlockStart: 15 }),
        blockNode({ debugName: "c", blockSize: 40 }),
      ],
    });

    // Margins collapse: max(20, 15) = 20 between a and b.
    // Total: 40 + 20 + 40 + 40 = 140
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 200,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));
    assert.equal(pages.length, 1);
    assert.equal(pages[0].blockSize, 140);
  });

  it("parent padding is included in fragment blockSize", () => {
    const container = blockNode({
      debugName: "padded",
      children: [blockNode({ blockSize: 50 })],
      paddingBlockStart: 10,
      paddingBlockEnd: 10,
    });

    const root = blockNode({ children: [container] });
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 200,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));
    assert.equal(pages.length, 1);
    // 10 (padding-top) + 50 (child) + 10 (padding-bottom) = 70
    assert.equal(pages[0].childFragments[0].blockSize, 70);
  });
});
