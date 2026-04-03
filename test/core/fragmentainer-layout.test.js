import { describe, it, expect, afterEach } from "vitest";
import { PhysicalFragment } from "../../src/core/fragment.js";
import { BlockBreakToken } from "../../src/core/tokens.js";
import { ConstraintSpace } from "../../src/core/constraint-space.js";
import { blockNode } from "../fixtures/nodes.js";
import { getFragmentainerSize } from "../../src/compositor/fragmentainer-builder.js";
import { FragmentainerLayout, FragmentedFlow } from "../../src/core/fragmentainer-layout.js";
import "../../src/dom/fragment-container.js";

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

describe("FragmentainerLayout.flow() (browser)", () => {
  let layout;

  afterEach(() => {
    layout?.destroy();
  });

  it("fragments simple content across multiple fragmentainers", async () => {
    const template = document.createElement("template");
    template.innerHTML = "<div style=\"margin:0; padding:0;\"><div style=\"height: 200px; margin: 0;\"></div></div>";
    layout = new FragmentainerLayout(template.content, {
      width: 400, height: 100,
    });
    const flow = await layout.flow();
    expect(flow).toBeInstanceOf(FragmentedFlow);
    expect(flow.fragmentainerCount).toBeGreaterThanOrEqual(2);
  });

  it("produces a single fragmentainer when content fits", async () => {
    const template = document.createElement("template");
    template.innerHTML = "<div style=\"margin:0; padding:0;\"><div style=\"height: 50px; margin: 0;\"></div></div>";
    layout = new FragmentainerLayout(template.content, {
      width: 400, height: 800,
    });
    const flow = await layout.flow();
    expect(flow.fragmentainerCount).toBe(1);
  });

  it("fragments text content across multiple pages", async () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="width: 200px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">${"word ".repeat(100)}</div>`;
    layout = new FragmentainerLayout(template.content, {
      width: 200, height: 60,
    });
    const flow = await layout.flow();
    expect(flow.fragmentainerCount).toBeGreaterThan(1);
  });

  it("produces fragments with correct structure", async () => {
    const template = document.createElement("template");
    template.innerHTML = "<div style=\"margin:0; padding:0;\"><div style=\"height: 200px; margin: 0;\"></div></div>";
    layout = new FragmentainerLayout(template.content, {
      width: 400, height: 100,
    });
    const flow = await layout.flow();
    const fragments = flow.fragments;

    expect(fragments.length).toBeGreaterThanOrEqual(2);

    // First fragment should have childFragments and positive blockSize
    const first = fragments[0];
    expect(first.childFragments).toBeDefined();
    expect(first.blockSize).toBeGreaterThan(0);

    // First fragment should carry a breakToken (content overflows)
    expect(first.breakToken).not.toBeNull();

    // Last fragment should have no breakToken (content is complete)
    const last = fragments[fragments.length - 1];
    expect(last.breakToken).toBeNull();
  });

  it("adds loading=lazy to images with width and height", async () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="margin:0; padding:0;">
      <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="100" height="100">
      <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="200" height="150">
    </div>`;
    layout = new FragmentainerLayout(template.content, {
      width: 400, height: 800,
    });
    const root = layout.contentRoot;
    const imgs = root.querySelectorAll("img");
    for (const img of imgs) {
      expect(img.getAttribute("loading")).toBe("lazy");
    }
  });

  it("does not add loading=lazy to images missing width or height", async () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="margin:0; padding:0;">
      <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="100">
      <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" height="100">
      <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
    </div>`;
    layout = new FragmentainerLayout(template.content, {
      width: 400, height: 800,
    });
    const root = layout.contentRoot;
    const imgs = root.querySelectorAll("img");
    for (const img of imgs) {
      expect(img.hasAttribute("loading")).toBe(false);
    }
  });

  it("does not wait for lazy-loaded images during setup", async () => {
    const template = document.createElement("template");
    // Use a broken src that would hang if waited on; dimensions trigger lazy
    template.innerHTML = `<div style="margin:0; padding:0;">
      <img src="http://192.0.2.1/hang.png" width="100" height="100">
      <div style="height: 50px; margin: 0;"></div>
    </div>`;
    layout = new FragmentainerLayout(template.content, {
      width: 400, height: 800,
    });
    // flow() should complete quickly — it must not wait for the lazy image
    const flow = await layout.flow();
    expect(flow.fragmentainerCount).toBeGreaterThanOrEqual(1);
  });

  it("accepts an Element and clones it into a DocumentFragment", async () => {
    const container = document.createElement("div");
    container.innerHTML = "<div style=\"margin:0; padding:0;\"><div style=\"height: 200px; margin: 0;\"></div></div>";
    document.body.appendChild(container);
    const el = container.firstElementChild;

    layout = new FragmentainerLayout(el, {
      width: 400, height: 100,
    });
    const flow = await layout.flow();
    expect(flow.fragmentainerCount).toBeGreaterThanOrEqual(2);

    // Original element should still be in the DOM (was cloned, not moved)
    expect(container.firstElementChild).toBe(el);
    container.remove();
  });

});

describe("namedPage property", () => {
  it("fragment-container has a namedPage property", () => {
    const el = document.createElement("fragment-container");
    expect(el.namedPage).toBeNull();
    el.namedPage = "chapter";
    expect(el.namedPage).toBe("chapter");
    el.namedPage = null;
    expect(el.namedPage).toBeNull();
  });

  it("sets namedPage property from fragment constraints", async () => {
    const size = { inlineSize: 400, blockSize: 800 };
    const contentStyles = { sheets: [], nthDescriptors: [], sourceRefs: null, refMap: null };
    const fragments = [
      { node: null, blockSize: 0, childFragments: [], breakToken: null, isBlank: false,
        constraints: { contentArea: size, namedPage: "cover" }, counterState: null },
      { node: null, blockSize: 0, childFragments: [], breakToken: null, isBlank: false,
        constraints: { contentArea: size, namedPage: "chapter" }, counterState: null },
      { node: null, blockSize: 0, childFragments: [], breakToken: null, isBlank: false,
        constraints: { contentArea: size, namedPage: null }, counterState: null },
    ];

    const flow = new FragmentedFlow(fragments, contentStyles);
    const elements = [];
    for (let i = 0; i < fragments.length; i++) {
      elements.push(flow.renderFragmentainer(i));
    }

    expect(elements[0].namedPage).toBe("cover");
    expect(elements[1].namedPage).toBe("chapter");
    expect(elements[2].namedPage).toBeNull();
  });
});
