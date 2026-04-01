import { describe, it, expect } from "vitest";
import { createFragments } from "../src/core/layout-request.js";
import { ConstraintSpace } from "../src/core/constraint-space.js";
import { blockNode } from "./fixtures/nodes.js";

describe("Phase 7: Break scoring & two-pass layout", () => {
  it("respects break-after: avoid by choosing an earlier break", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 100 }),
        blockNode({ debugName: "B", blockSize: 100, breakAfter: "avoid" }),
        // Without scoring, break would go between B and C (at 200px).
        // But B has break-after: avoid, so the engine should prefer
        // breaking between A and B (at 100px) — a "perfect" break.
        blockNode({ debugName: "C", blockSize: 100 }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));

    // Two-pass should break between A and B (at 100px), not between B and C
    expect(pages.length).toBe(2);
    expect(pages[0].childFragments.length).toBe(1); // just A
    expect(pages[0].blockSize).toBe(100);
    expect(pages[1].childFragments.length).toBe(2); // B + C
  });

  it("respects break-before: avoid on the next sibling", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 100 }),
        blockNode({ debugName: "B", blockSize: 100 }),
        blockNode({ debugName: "C", blockSize: 100, breakBefore: "avoid" }),
      ],
    });

    // Without scoring, break goes between B and C (at 200px).
    // C has break-before: avoid → violating. Better break: between A and B (100px).
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));

    expect(pages.length).toBe(2);
    expect(pages[0].childFragments.length).toBe(1); // just A
    expect(pages[0].blockSize).toBe(100);
    expect(pages[1].childFragments.length).toBe(2); // B + C
  });

  it("break-inside: avoid on parent degrades all interior breaks", () => {
    const container = blockNode({
      debugName: "container",
      breakInside: "avoid",
      children: [
        blockNode({ debugName: "inner1", blockSize: 100 }),
        blockNode({ debugName: "inner2", blockSize: 100 }),
      ],
    });

    const root = blockNode({
      children: [
        blockNode({ debugName: "before", blockSize: 50 }),
        container,
      ],
    });

    // Fragmentainer = 120px. 'before' takes 50px. Container gets 70px.
    // Container has break-inside: avoid. The break scoring should detect
    // that any break inside the container violates the rule.
    // Without a better alternative at root level, it still breaks inside
    // (since it has to make progress).
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 120,
      fragmentainerBlockSize: 120,
      fragmentationType: "page",
    }));
    expect(pages.length >= 2).toBeTruthy();
  });

  it("falls back to normal break when no better alternative exists", () => {
    const root = blockNode({
      children: [
        // All three siblings have break-after: avoid — no perfect break exists
        blockNode({ debugName: "A", blockSize: 100, breakAfter: "avoid" }),
        blockNode({ debugName: "B", blockSize: 100, breakAfter: "avoid" }),
        blockNode({ debugName: "C", blockSize: 100 }),
      ],
    });

    // 200px fragmentainer. Break between B and C has break-after:avoid on B.
    // Break between A and B also has break-after:avoid on A.
    // Both are equal score — falls back to last break (between B and C).
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));
    expect(pages.length).toBe(2);
    // Should still make progress — either 1 or 2 children on page 1
    expect(pages[0].childFragments.length >= 1).toBeTruthy();
  });

  it("perfect break is not overridden by two-pass", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 100 }),
        blockNode({ debugName: "B", blockSize: 100 }),
        blockNode({ debugName: "C", blockSize: 100 }),
      ],
    });

    // No avoid rules — all breaks are perfect. No re-layout needed.
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));
    expect(pages.length).toBe(2);
    expect(pages[0].childFragments.length).toBe(2); // A + B at 200px
  });
});
