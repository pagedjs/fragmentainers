import { describe, it, expect, afterEach } from "vitest";
import { createFragments } from "../../src/core/layout-request.js";
import { FragmentainerLayout } from "../../src/core/fragmentainer-layout.js";
import { ConstraintSpace } from "../../src/core/constraint-space.js";
import { FRAGMENTATION_PAGE, FRAGMENTATION_COLUMN } from "../../src/core/constants.js";
import { FixedPosition } from "../../src/modules/fixed-position.js";
import { blockNode, fixedNode } from "../fixtures/nodes.js";

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

function columnConstraintSpace() {
  return new ConstraintSpace({
    availableInlineSize: PAGE_WIDTH,
    availableBlockSize: PAGE_HEIGHT,
    fragmentainerBlockSize: PAGE_HEIGHT,
    fragmentationType: FRAGMENTATION_COLUMN,
  });
}

describe("FixedPosition.matches", () => {
  it("returns true for a position: fixed node", () => {
    const node = fixedNode({ blockSize: 100 });
    expect(FixedPosition.matches(node)).toBe(true);
  });

  it("returns false for a regular block node", () => {
    const node = blockNode({ blockSize: 100 });
    expect(FixedPosition.matches(node)).toBe(false);
  });
});

describe("FixedPosition.layout", () => {
  it("reserves block-start space for a top-anchored fixed element", () => {
    const root = blockNode({
      children: [
        fixedNode({ anchorEdge: "block-start", blockSize: 80 }),
        blockNode({ blockSize: 300 }),
      ],
    });

    const cs = pageConstraintSpace();
    const layoutChildFn = (child) => {
      return { fragment: { blockSize: child.blockSize, childFragments: [] } };
    };

    const result = FixedPosition.layout(root, cs, null, layoutChildFn);
    expect(result.reservedBlockStart).toBe(80);
    expect(result.reservedBlockEnd).toBe(0);
    expect(typeof result.afterRender).toBe("function");
  });

  it("reserves block-end space for a bottom-anchored fixed element", () => {
    const root = blockNode({
      children: [
        fixedNode({ anchorEdge: "block-end", blockSize: 60 }),
        blockNode({ blockSize: 300 }),
      ],
    });

    const cs = pageConstraintSpace();
    const layoutChildFn = (child) => {
      return { fragment: { blockSize: child.blockSize, childFragments: [] } };
    };

    const result = FixedPosition.layout(root, cs, null, layoutChildFn);
    expect(result.reservedBlockStart).toBe(0);
    expect(result.reservedBlockEnd).toBe(60);
  });

  it("reserves space for both top and bottom fixed elements", () => {
    const root = blockNode({
      children: [
        fixedNode({ anchorEdge: "block-start", blockSize: 80 }),
        fixedNode({ anchorEdge: "block-end", blockSize: 60 }),
        blockNode({ blockSize: 300 }),
      ],
    });

    const cs = pageConstraintSpace();
    const layoutChildFn = (child) => {
      return { fragment: { blockSize: child.blockSize, childFragments: [] } };
    };

    const result = FixedPosition.layout(root, cs, null, layoutChildFn);
    expect(result.reservedBlockStart).toBe(80);
    expect(result.reservedBlockEnd).toBe(60);
  });

  it("does not reserve space for overlay fixed elements", () => {
    const root = blockNode({
      children: [
        fixedNode({ anchorEdge: "overlay", blockSize: 100 }),
        blockNode({ blockSize: 300 }),
      ],
    });

    const cs = pageConstraintSpace();
    const layoutChildFn = (child) => {
      return { fragment: { blockSize: child.blockSize, childFragments: [] } };
    };

    const result = FixedPosition.layout(root, cs, null, layoutChildFn);
    expect(result.reservedBlockStart).toBe(0);
    expect(result.reservedBlockEnd).toBe(0);
    expect(typeof result.afterRender).toBe("function");
  });

  it("returns zero reservations in column fragmentation", () => {
    const root = blockNode({
      children: [
        fixedNode({ anchorEdge: "block-start", blockSize: 80 }),
        blockNode({ blockSize: 300 }),
      ],
    });

    const cs = columnConstraintSpace();
    const layoutChildFn = (child) => {
      return { fragment: { blockSize: child.blockSize, childFragments: [] } };
    };

    const result = FixedPosition.layout(root, cs, null, layoutChildFn);
    expect(result.reservedBlockStart).toBe(0);
    expect(result.reservedBlockEnd).toBe(0);
    expect(result.afterRender).toBeNull();
  });

  it("returns zero reservations when no fixed elements present", () => {
    const root = blockNode({
      children: [
        blockNode({ blockSize: 300 }),
        blockNode({ blockSize: 200 }),
      ],
    });

    const cs = pageConstraintSpace();
    const layoutChildFn = (child) => {
      return { fragment: { blockSize: child.blockSize, childFragments: [] } };
    };

    const result = FixedPosition.layout(root, cs, null, layoutChildFn);
    expect(result.reservedBlockStart).toBe(0);
    expect(result.reservedBlockEnd).toBe(0);
    expect(result.afterRender).toBeNull();
  });

  it("finds fixed elements nested inside non-fixed containers", () => {
    const root = blockNode({
      children: [
        blockNode({
          children: [
            fixedNode({ anchorEdge: "block-start", blockSize: 50 }),
            blockNode({ blockSize: 200 }),
          ],
        }),
      ],
    });

    const cs = pageConstraintSpace();
    const layoutChildFn = (child) => {
      return { fragment: { blockSize: child.blockSize, childFragments: [] } };
    };

    const result = FixedPosition.layout(root, cs, null, layoutChildFn);
    expect(result.reservedBlockStart).toBe(50);
  });
});

describe("fixed position integration with createFragments", () => {
  it("fixed header reduces available space for content", () => {
    const root = blockNode({
      children: [
        fixedNode({ anchorEdge: "block-start", blockSize: 100 }),
        blockNode({ blockSize: 700 }),
      ],
    });

    const cs = new ConstraintSpace({
      availableInlineSize: PAGE_WIDTH,
      availableBlockSize: PAGE_HEIGHT - 100,
      fragmentainerBlockSize: PAGE_HEIGHT,
      blockOffsetInFragmentainer: 100,
      fragmentationType: FRAGMENTATION_PAGE,

    });
    const fragments = createFragments(root, cs);
    expect(fragments.length).toBe(1);
    expect(fragments[0].blockSize).toBe(700);
  });

  it("fixed header causes content to overflow into second page", () => {
    const root = blockNode({
      children: [
        fixedNode({ anchorEdge: "block-start", blockSize: 200 }),
        blockNode({ blockSize: 700 }),
      ],
    });

    const cs = new ConstraintSpace({
      availableInlineSize: PAGE_WIDTH,
      availableBlockSize: PAGE_HEIGHT - 200,
      fragmentainerBlockSize: PAGE_HEIGHT,
      blockOffsetInFragmentainer: 200,
      fragmentationType: FRAGMENTATION_PAGE,

    });
    const fragments = createFragments(root, cs);
    expect(fragments.length).toBe(2);
  });
});

describe("position: fixed in paged media (browser)", () => {
  let layout;

  afterEach(() => {
    layout?.destroy();
  });

  function pageConstraint(height = 400) {
    return new ConstraintSpace({
      availableInlineSize: 400,
      availableBlockSize: height,
      fragmentainerBlockSize: height,
      fragmentationType: FRAGMENTATION_PAGE,
    });
  }

  it("fixed header reduces available page space", async () => {
    const template = document.createElement("template");
    template.innerHTML = `
      <div style="margin: 0; padding: 0;">
        <div style="position: fixed; top: 0; left: 0; right: 0; height: 50px; margin: 0; padding: 0;"></div>
        <div style="height: 180px; margin: 0; padding: 0;"></div>
        <div style="height: 180px; margin: 0; padding: 0;"></div>
      </div>
    `;
    layout = new FragmentainerLayout(template.content, {
      constraintSpace: pageConstraint(400),
    });
    const flow = await layout.flow();

    // Without fixed handling: 180 + 180 = 360 fits in 400 → 1 page
    // With fixed handling: 400 - 50 = 350 available, 360 > 350 → 2 pages
    expect(flow.fragmentainerCount).toBe(2);
  });

  it("fixed header repeats in rendered output on every page", async () => {
    const template = document.createElement("template");
    template.innerHTML = `
      <div style="margin: 0; padding: 0;">
        <div style="position: fixed; top: 0; left: 0; right: 0; height: 50px; margin: 0; padding: 0;" class="fixed-header"></div>
        <div style="height: 200px; margin: 0; padding: 0;"></div>
        <div style="height: 200px; margin: 0; padding: 0;"></div>
      </div>
    `;
    layout = new FragmentainerLayout(template.content, {
      constraintSpace: pageConstraint(400),
    });
    const flow = await layout.flow();

    expect(flow.fragmentainerCount).toBeGreaterThan(1);

    // Each rendered page should contain a clone of the fixed header
    const elements = flow.render();
    for (const el of elements) {
      document.body.appendChild(el);
      const headerClone = el.shadowRoot.querySelector(".fixed-header");
      expect(headerClone).not.toBeNull();
      el.remove();
    }
  });

  it("fixed footer positioned at bottom of each page", async () => {
    const template = document.createElement("template");
    template.innerHTML = `
      <div style="margin: 0; padding: 0;">
        <div style="position: fixed; bottom: 0; left: 0; right: 0; height: 50px; margin: 0; padding: 0;" class="fixed-footer"></div>
        <div style="height: 200px; margin: 0; padding: 0;"></div>
        <div style="height: 200px; margin: 0; padding: 0;"></div>
      </div>
    `;
    layout = new FragmentainerLayout(template.content, {
      constraintSpace: pageConstraint(400),
    });
    const flow = await layout.flow();

    expect(flow.fragmentainerCount).toBeGreaterThan(1);

    const elements = flow.render();
    for (const el of elements) {
      document.body.appendChild(el);
      const footerClone = el.shadowRoot.querySelector(".fixed-footer");
      expect(footerClone).not.toBeNull();
      expect(footerClone.style.bottom).toBe("0px");
      el.remove();
    }
  });

  it("header and footer both repeat on every page", async () => {
    const template = document.createElement("template");
    template.innerHTML = `
      <div style="margin: 0; padding: 0;">
        <div style="position: fixed; top: 0; left: 0; right: 0; height: 40px; margin: 0; padding: 0;" class="header"></div>
        <div style="position: fixed; bottom: 0; left: 0; right: 0; height: 40px; margin: 0; padding: 0;" class="footer"></div>
        <div style="height: 200px; margin: 0; padding: 0;"></div>
        <div style="height: 200px; margin: 0; padding: 0;"></div>
      </div>
    `;
    layout = new FragmentainerLayout(template.content, {
      constraintSpace: pageConstraint(400),
    });
    const flow = await layout.flow();

    // 400 - 40 - 40 = 320 available, 400 total → 2 pages
    expect(flow.fragmentainerCount).toBe(2);

    const elements = flow.render();
    for (const el of elements) {
      document.body.appendChild(el);
      expect(el.shadowRoot.querySelector(".header")).not.toBeNull();
      expect(el.shadowRoot.querySelector(".footer")).not.toBeNull();
      el.remove();
    }
  });

  it("content fits on one page when fixed elements leave enough room", async () => {
    const template = document.createElement("template");
    template.innerHTML = `
      <div style="margin: 0; padding: 0;">
        <div style="position: fixed; top: 0; left: 0; right: 0; height: 20px; margin: 0; padding: 0;"></div>
        <div style="height: 50px; margin: 0; padding: 0;"></div>
      </div>
    `;
    layout = new FragmentainerLayout(template.content, {
      constraintSpace: pageConstraint(400),
    });
    const flow = await layout.flow();

    expect(flow.fragmentainerCount).toBe(1);
  });
});
