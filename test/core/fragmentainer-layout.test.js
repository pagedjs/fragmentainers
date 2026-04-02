import { describe, it, expect } from "vitest";
import { PhysicalFragment } from "../../src/core/fragment.js";
import { BlockBreakToken } from "../../src/core/tokens.js";
import { ConstraintSpace } from "../../src/core/constraint-space.js";
import { blockNode } from "../fixtures/nodes.js";
import { getFragmentainerSize } from "../../src/compositor/fragmentainer-builder.js";
import { FragmentainerLayout, FragmentedFlow } from "../../src/core/fragmentainer-layout.js";

describe("getFragmentainerSize", () => {
  const sizes = [
    { inlineSize: 600, blockSize: 800 },
    { inlineSize: 800, blockSize: 600 },
  ];

  it("returns the size at the given index", () => {
    expect(getFragmentainerSize(sizes, 0)).toEqual({ inlineSize: 600, blockSize: 800 });
    expect(getFragmentainerSize(sizes, 1)).toEqual({ inlineSize: 800, blockSize: 600 });
  });

  it("returns the last size for indices beyond the array", () => {
    expect(getFragmentainerSize(sizes, 2)).toEqual({ inlineSize: 800, blockSize: 600 });
    expect(getFragmentainerSize(sizes, 99)).toEqual({ inlineSize: 800, blockSize: 600 });
  });

  it("works with a single-element array", () => {
    const single = [{ inlineSize: 500, blockSize: 700 }];
    expect(getFragmentainerSize(single, 0)).toEqual({ inlineSize: 500, blockSize: 700 });
    expect(getFragmentainerSize(single, 5)).toEqual({ inlineSize: 500, blockSize: 700 });
  });

  it("prefers fragment constraints over sizes array", () => {
    const fragments = [
      Object.assign(new PhysicalFragment(blockNode(), 100), {
        constraints: {
          contentArea: { inlineSize: 700, blockSize: 900 },
        },
      }),
    ];
    const fallback = [{ inlineSize: 600, blockSize: 800 }];
    expect(getFragmentainerSize(fallback, 0, fragments)).toEqual({ inlineSize: 700, blockSize: 900 });
  });
});

describe("FragmentedFlow", () => {
  function makeFragments(count) {
    const fragments = [];
    for (let i = 0; i < count; i++) {
      const node = blockNode({ debugName: `frag-${i}` });
      const frag = new PhysicalFragment(node, 200, []);
      frag.constraints = {
        contentArea: { inlineSize: 816, blockSize: 1056 },
      };
      if (i < count - 1) {
        const bt = new BlockBreakToken(node);
        bt.consumedBlockSize = (i + 1) * 200;
        frag.breakToken = bt;
      }
      fragments.push(frag);
    }
    return fragments;
  }

  it("exposes fragments array", () => {
    const fragments = makeFragments(3);
    const flow = new FragmentedFlow(fragments, null);
    expect(flow.fragments).toBe(fragments);
  });

  it("reports correct fragmentainerCount", () => {
    const flow = new FragmentedFlow(makeFragments(5), null);
    expect(flow.fragmentainerCount).toBe(5);
  });

  it("reports zero fragmentainerCount for empty array", () => {
    const flow = new FragmentedFlow([], null);
    expect(flow.fragmentainerCount).toBe(0);
  });

});

describe("FragmentainerLayout.next()", () => {
  // next() needs a real-ish element with getRootNode and children for
  // buildLayoutTree. We use a minimal mock that satisfies DOMLayoutNode.
  // These tests use a ConstraintSpace directly to avoid needing document.styleSheets.

  it("returns a fragment with breakToken when content overflows", async () => {
    const root = blockNode({
      children: [
        blockNode({ blockSize: 300 }),
        blockNode({ blockSize: 300 }),
      ],
    });

    const cs = new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 400,
      fragmentainerBlockSize: 400,
      fragmentationType: "column",
    });

    const layout = new FragmentainerLayout(root, { constraintSpace: cs });
    await layout.setup();
    const frag1 = layout.next();

    expect(frag1).toBeDefined();
    expect(frag1.blockSize).toBeGreaterThan(0);
    expect(frag1.breakToken).not.toBeNull();
  });

  it("returns null breakToken on the last fragment", async () => {
    const root = blockNode({
      children: [
        blockNode({ blockSize: 300 }),
        blockNode({ blockSize: 300 }),
      ],
    });

    const cs = new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 400,
      fragmentainerBlockSize: 400,
      fragmentationType: "column",
    });

    const layout = new FragmentainerLayout(root, { constraintSpace: cs });
    await layout.setup();
    const frag1 = layout.next();
    expect(frag1.breakToken).not.toBeNull();

    const frag2 = layout.next();
    expect(frag2.breakToken).toBeNull();
  });

  it("next() loop collects all fragments", async () => {
    const root = blockNode({
      children: [
        blockNode({ blockSize: 200 }),
        blockNode({ blockSize: 200 }),
        blockNode({ blockSize: 200 }),
      ],
    });

    const cs = new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 300,
      fragmentainerBlockSize: 300,
      fragmentationType: "column",
    });

    const layout = new FragmentainerLayout(root, { constraintSpace: cs });
    await layout.setup();
    const fragments = [];
    let frag;
    do {
      frag = layout.next();
      fragments.push(frag);
    } while (frag.breakToken !== null);

    expect(fragments.length).toBeGreaterThanOrEqual(2);
    expect(fragments[fragments.length - 1].breakToken).toBeNull();
  });

  it("stopping early leaves breakToken non-null", async () => {
    const root = blockNode({
      children: [
        blockNode({ blockSize: 200 }),
        blockNode({ blockSize: 200 }),
        blockNode({ blockSize: 200 }),
      ],
    });

    const cs = new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 250,
      fragmentainerBlockSize: 250,
      fragmentationType: "column",
    });

    const layout = new FragmentainerLayout(root, { constraintSpace: cs });
    await layout.setup();
    // Only consume one fragmentainer (simulating one region)
    const frag = layout.next();
    expect(frag.breakToken).not.toBeNull();
    // Caller stops here — content overflows, which is expected for regions
  });
});
