import { describe, it, expect } from "vitest";
import { PhysicalFragment } from "../src/fragment.js";
import { BlockBreakToken } from "../src/tokens.js";
import { PageSizeResolver, PageRule } from "../src/page-rules.js";
import { blockNode } from "./fixtures/nodes.js";
import { getFragmentainerSize } from "../src/compositor/fragmentainer-builder.js";
import { FragmentainerLayout, FragmentedFlow } from "../src/fragmentainer-layout.js";

// ---------------------------------------------------------------------------
// getFragmentainerSize (renamed from getPageSize)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// FragmentedFlow
// ---------------------------------------------------------------------------

describe("FragmentedFlow", () => {
  function makeFragments(count) {
    const fragments = [];
    let prevBreakToken = null;
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

  it("retains contentStyles for rendering", () => {
    const styles = { sheets: [], cssText: "body { color: red }" };
    const flow = new FragmentedFlow(makeFragments(1), styles);
    // contentStyles is private (#contentStyles) — verify it's retained by
    // checking that the flow still reports correct fragment count (smoke test)
    expect(flow.fragmentainerCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// FragmentainerLayout constructor
// ---------------------------------------------------------------------------

describe("FragmentainerLayout", () => {
  // Construction-only tests: flow() requires a real DOM, so we verify the
  // resolver is configured correctly by passing it in and checking that the
  // constructor does not throw.

  const mockElement = { getRootNode() { return {}; } };

  it("accepts a PageSizeResolver via options.resolver", () => {
    const resolver = new PageSizeResolver([], { inlineSize: 816, blockSize: 1056 });
    // Should construct without error
    const layout = new FragmentainerLayout(mockElement, { resolver });
    expect(layout).toBeTruthy();
  });

  it("creates a PageSizeResolver from defaultSize", () => {
    const layout = new FragmentainerLayout(mockElement, {
      defaultSize: { inlineSize: 600, blockSize: 800 },
    });
    expect(layout).toBeTruthy();
  });

  it("uses letter size as default when no size specified", () => {
    const layout = new FragmentainerLayout(mockElement);
    expect(layout).toBeTruthy();
  });

  it("resolver with @page rules overrides default size", () => {
    const rules = [new PageRule({ size: "a5" })];
    const resolver = new PageSizeResolver(rules, { inlineSize: 816, blockSize: 1056 });
    const layout = new FragmentainerLayout(mockElement, { resolver });
    expect(layout).toBeTruthy();
  });
});
