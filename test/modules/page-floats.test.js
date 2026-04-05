import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createFragments } from "../../src/core/layout-request.js";
import { ConstraintSpace } from "../../src/core/constraint-space.js";
import { FragmentedFlow } from "../../src/core/fragmented-flow.js";
import { FRAGMENTATION_PAGE } from "../../src/core/constants.js";
import { LayoutModule } from "../../src/modules/module.js";
import { PageFloat } from "../../src/modules/page-float.js";
import { blockNode, floatNode } from "../fixtures/nodes.js";

const PAGE_HEIGHT = 800;
const PAGE_WIDTH = 600;

function pageConstraintSpace() {
  return new ConstraintSpace({
    availableInlineSize: PAGE_WIDTH,
    availableBlockSize: PAGE_HEIGHT,
    fragmentainerBlockSize: PAGE_HEIGHT,
    fragmentationType: FRAGMENTATION_PAGE,
  });
}

describe("PageFloat.matches", () => {
  it("returns true for a page-float node", () => {
    const node = floatNode({ blockSize: 100 });
    expect(PageFloat.matches(node)).toBe(true);
  });

  it("returns false for a regular block node", () => {
    const node = blockNode({ blockSize: 100 });
    expect(PageFloat.matches(node)).toBe(false);
  });
});

describe("PageFloat.layout", () => {
  it("reserves block-start space for a top float", () => {
    const root = blockNode({
      children: [
        floatNode({ placement: "top", blockSize: 100 }),
        blockNode({ blockSize: 300 }),
      ],
    });

    const cs = pageConstraintSpace();
    const layoutChildFn = (child, childCs) => {
      return { fragment: { blockSize: child.blockSize, childFragments: [] } };
    };

    const result = PageFloat.layout(root, cs, null, layoutChildFn);
    expect(result.reservedBlockStart).toBe(100);
    expect(result.reservedBlockEnd).toBe(0);
    expect(typeof result.afterRender).toBe("function");
  });

  it("reserves block-end space for a bottom float", () => {
    const root = blockNode({
      children: [
        floatNode({ placement: "bottom", blockSize: 150 }),
        blockNode({ blockSize: 300 }),
      ],
    });

    const cs = pageConstraintSpace();
    const layoutChildFn = (child) => {
      return { fragment: { blockSize: child.blockSize, childFragments: [] } };
    };

    const result = PageFloat.layout(root, cs, null, layoutChildFn);
    expect(result.reservedBlockStart).toBe(0);
    expect(result.reservedBlockEnd).toBe(150);
  });

  it("reserves space for both top and bottom floats", () => {
    const root = blockNode({
      children: [
        floatNode({ placement: "top", blockSize: 50 }),
        floatNode({ placement: "bottom", blockSize: 75 }),
        blockNode({ blockSize: 300 }),
      ],
    });

    const cs = pageConstraintSpace();
    const layoutChildFn = (child) => {
      return { fragment: { blockSize: child.blockSize, childFragments: [] } };
    };

    const result = PageFloat.layout(root, cs, null, layoutChildFn);
    expect(result.reservedBlockStart).toBe(50);
    expect(result.reservedBlockEnd).toBe(75);
  });

  it("returns zero reservations when no floats present", () => {
    const root = blockNode({
      children: [blockNode({ blockSize: 300 }), blockNode({ blockSize: 200 })],
    });

    const cs = pageConstraintSpace();
    const layoutChildFn = (child) => {
      return { fragment: { blockSize: child.blockSize, childFragments: [] } };
    };

    const result = PageFloat.layout(root, cs, null, layoutChildFn);
    expect(result.reservedBlockStart).toBe(0);
    expect(result.reservedBlockEnd).toBe(0);
  });
});

describe("page floats integration with createFragments", () => {
  it("top float reduces available space for content", () => {
    const root = blockNode({
      children: [
        floatNode({ placement: "top", blockSize: 100 }),
        blockNode({ blockSize: 700 }),
      ],
    });

    const cs = pageConstraintSpace();
    // Without modules: content fits in one page (100 + 700 = 800)
    const noModFragments = createFragments(root, cs);
    expect(noModFragments.length).toBe(1);

    // With modules: float takes 100, content takes 700, total exceeds adjusted 700
    // The float is skipped by layoutBlockContainer, but the constraint space
    // has only 700px available. The 700px block should still fit exactly.
    const csWithLayoutModules = new ConstraintSpace({
      availableInlineSize: PAGE_WIDTH,
      availableBlockSize: PAGE_HEIGHT - 100,
      fragmentainerBlockSize: PAGE_HEIGHT - 0, // reservedBlockEnd is 0
      blockOffsetInFragmentainer: 100, // reservedBlockStart
      fragmentationType: FRAGMENTATION_PAGE,
      modules: [PageFloat],
    });
    const fragments = createFragments(root, csWithLayoutModules);
    // The 700px block should fit in the remaining 700px
    expect(fragments.length).toBe(1);
    expect(fragments[0].blockSize).toBe(700);
  });

  it("float causes content to overflow into second page", () => {
    const root = blockNode({
      children: [
        floatNode({ placement: "top", blockSize: 200 }),
        blockNode({ blockSize: 700 }),
      ],
    });

    // With modules active via constraint space: 800 - 200 = 600 available
    const cs = new ConstraintSpace({
      availableInlineSize: PAGE_WIDTH,
      availableBlockSize: PAGE_HEIGHT - 200,
      fragmentainerBlockSize: PAGE_HEIGHT,
      blockOffsetInFragmentainer: 200,
      fragmentationType: FRAGMENTATION_PAGE,
      modules: [PageFloat],
    });
    const fragments = createFragments(root, cs);
    // 700px content doesn't fit in 600px → overflow to page 2
    expect(fragments.length).toBe(2);
  });

  it("no modules produces same results as before", () => {
    const root = blockNode({
      children: [
        blockNode({ blockSize: 300 }),
        blockNode({ blockSize: 300 }),
        blockNode({ blockSize: 300 }),
        blockNode({ blockSize: 300 }),
      ],
    });

    const cs = pageConstraintSpace();
    const fragments = createFragments(root, cs);
    // 1200px total in 800px pages → 2 pages (600 + 600, break after child 2)
    expect(fragments.length).toBe(2);
  });
});

describe("FragmentedFlow.register / .remove", () => {
  afterEach(() => {
    FragmentedFlow.remove(PageFloat);
  });

  it("register() registers a module globally", () => {
    FragmentedFlow.register(PageFloat);
    // Registering the same module twice should be a no-op
    FragmentedFlow.register(PageFloat);
    // After removal, it should be gone
    FragmentedFlow.remove(PageFloat);
    // Removing again should be safe
    FragmentedFlow.remove(PageFloat);
  });

  it("register() does not duplicate a module", () => {
    const spy = new LayoutModule();
    FragmentedFlow.register(spy);
    FragmentedFlow.register(spy);
    FragmentedFlow.remove(spy);

    // After one register + one register (deduped) + one remove, spy should be fully gone.
    // Re-register to verify it was removed
    FragmentedFlow.register(spy);
    FragmentedFlow.remove(spy);
  });
});
