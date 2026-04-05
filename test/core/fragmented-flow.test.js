import { describe, it, expect, afterEach } from "vitest";
import { PhysicalFragment } from "../../src/core/fragment.js";
import { BlockBreakToken } from "../../src/core/tokens.js";
import { ConstraintSpace } from "../../src/core/constraint-space.js";
import { blockNode } from "../fixtures/nodes.js";
import { FragmentedFlow } from "../../src/core/fragmented-flow.js";
import { FragmentationContext } from "../../src/core/fragmentation-context.js";
import "../../src/dom/fragment-container.js";

describe("FragmentationContext", () => {
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
    const flow = new FragmentationContext(fragments, null);
    expect(flow.fragments).toBe(fragments);
  });

  it("reports correct fragmentainerCount", () => {
    const flow = new FragmentationContext(makeFragments(5), null);
    expect(flow.fragmentainerCount).toBe(5);
  });

  it("reports zero fragmentainerCount for empty array", () => {
    const flow = new FragmentationContext([], null);
    expect(flow.fragmentainerCount).toBe(0);
  });

  it("skips element creation when contentStyles is null", () => {
    const flow = new FragmentationContext(makeFragments(3), null);
    expect(flow.length).toBe(0);
    expect(flow.fragmentainerCount).toBe(3);
    expect(flow.fragments.length).toBe(3);
  });

  it("Symbol.species returns Array", () => {
    const flow = new FragmentationContext(makeFragments(2), null);
    const mapped = flow.map((el) => el.tagName);
    expect(mapped).toBeInstanceOf(Array);
    expect(mapped).not.toBeInstanceOf(FragmentationContext);
  });
});

describe("FragmentedFlow iterator (mock nodes)", () => {
  // These tests use mock nodes with a ConstraintSpace directly to
  // avoid needing document.styleSheets / real DOM measurement.

  it("iterates fragments when content overflows", () => {
    const root = blockNode({
      children: [blockNode({ blockSize: 300 }), blockNode({ blockSize: 300 })],
    });

    const cs = new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 400,
      fragmentainerBlockSize: 400,
      fragmentationType: "column",
    });

    const layout = new FragmentedFlow(root, { constraintSpace: cs });
    const flow = layout.flow();
    const fragments = flow.fragments;

    expect(fragments.length).toBeGreaterThanOrEqual(2);
    expect(fragments[0].blockSize).toBeGreaterThan(0);
    expect(fragments[0].breakToken).not.toBeNull();
  });

  it("last fragment has null breakToken", () => {
    const root = blockNode({
      children: [blockNode({ blockSize: 300 }), blockNode({ blockSize: 300 })],
    });

    const cs = new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 400,
      fragmentainerBlockSize: 400,
      fragmentationType: "column",
    });

    const layout = new FragmentedFlow(root, { constraintSpace: cs });
    const flow = layout.flow();
    const fragments = flow.fragments;
    const last = fragments[fragments.length - 1];
    expect(last.breakToken).toBeNull();
  });

  it("for-of loop collects all elements", () => {
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

    const layout = new FragmentedFlow(root, { constraintSpace: cs });
    const elements = [];
    for (const el of layout) {
      elements.push(el);
    }

    expect(elements.length).toBeGreaterThanOrEqual(2);
  });

  it("next() returns done:true after exhaustion", () => {
    const root = blockNode({
      children: [blockNode({ blockSize: 100 })],
    });

    const cs = new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 300,
      fragmentainerBlockSize: 300,
      fragmentationType: "column",
    });

    const layout = new FragmentedFlow(root, { constraintSpace: cs });
    const r1 = layout.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toBeDefined();

    const r2 = layout.next();
    expect(r2.done).toBe(true);
    expect(r2.value).toBeUndefined();
  });

  it("stopping early via break leaves content unfinished", () => {
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

    const layout = new FragmentedFlow(root, { constraintSpace: cs });
    // Only consume one fragmentainer (simulating one region)
    const r = layout.next();
    expect(r.done).toBe(false);
    // Caller stops here — content overflows, which is expected for regions
  });
});

describe("FragmentedFlow.flow() (browser)", () => {
  let layout;

  afterEach(() => {
    layout?.destroy();
  });

  it("fragments simple content across multiple fragmentainers", async () => {
    const template = document.createElement("template");
    template.innerHTML =
      '<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>';
    layout = new FragmentedFlow(template.content, {
      width: 400,
      height: 100,
    });
    const flow = layout.flow();
    expect(flow).toBeInstanceOf(FragmentationContext);
    expect(flow.fragmentainerCount).toBeGreaterThanOrEqual(2);
    expect(flow.length).toBe(flow.fragmentainerCount);
  });

  it("flow() with start/stop creates a subset of elements", async () => {
    const template = document.createElement("template");
    template.innerHTML =
      '<div style="margin:0; padding:0;"><div style="height: 400px; margin: 0;"></div></div>';
    layout = new FragmentedFlow(template.content, {
      width: 400,
      height: 100,
    });
    const flow = layout.flow({ start: 1, stop: 3 });
    expect(flow.fragmentainerCount).toBeGreaterThanOrEqual(4);
    expect(flow.length).toBe(2);
    expect(flow[0].fragmentIndex).toBe(1);
    expect(flow[1].fragmentIndex).toBe(2);
  });

  it("is directly iterable as an array of elements", async () => {
    const template = document.createElement("template");
    template.innerHTML =
      '<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>';
    layout = new FragmentedFlow(template.content, {
      width: 400,
      height: 100,
    });
    const flow = layout.flow();
    expect(flow.length).toBeGreaterThanOrEqual(2);
    for (const el of flow) {
      expect(el.tagName.toLowerCase()).toBe("fragment-container");
    }
  });

  it("supports index access", async () => {
    const template = document.createElement("template");
    template.innerHTML =
      '<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>';
    layout = new FragmentedFlow(template.content, {
      width: 400,
      height: 100,
    });
    const flow = layout.flow();
    expect(flow[0].tagName.toLowerCase()).toBe("fragment-container");
    expect(flow[0].fragmentIndex).toBe(0);
  });

  it("produces a single fragmentainer when content fits", async () => {
    const template = document.createElement("template");
    template.innerHTML =
      '<div style="margin:0; padding:0;"><div style="height: 50px; margin: 0;"></div></div>';
    layout = new FragmentedFlow(template.content, {
      width: 400,
      height: 800,
    });
    const flow = layout.flow();
    expect(flow.fragmentainerCount).toBe(1);
  });

  it("fragments text content across multiple pages", async () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="width: 200px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">${"word ".repeat(100)}</div>`;
    layout = new FragmentedFlow(template.content, {
      width: 200,
      height: 60,
    });
    const flow = layout.flow();
    expect(flow.fragmentainerCount).toBeGreaterThan(1);
  });

  it("produces fragments with correct structure", async () => {
    const template = document.createElement("template");
    template.innerHTML =
      '<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>';
    layout = new FragmentedFlow(template.content, {
      width: 400,
      height: 100,
    });
    const flow = layout.flow();
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
    layout = new FragmentedFlow(template.content, {
      width: 400,
      height: 800,
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
    layout = new FragmentedFlow(template.content, {
      width: 400,
      height: 800,
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
    layout = new FragmentedFlow(template.content, {
      width: 400,
      height: 800,
    });
    // flow() should complete quickly — it must not wait for the lazy image
    const flow = layout.flow();
    expect(flow.fragmentainerCount).toBeGreaterThanOrEqual(1);
  });

  it("accepts an Element and clones it into a DocumentFragment", async () => {
    const container = document.createElement("div");
    container.innerHTML =
      '<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>';
    document.body.appendChild(container);
    const el = container.firstElementChild;

    layout = new FragmentedFlow(el, {
      width: 400,
      height: 100,
    });
    const flow = layout.flow();
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
    const contentStyles = {
      sheets: [],
      nthDescriptors: [],
      sourceRefs: null,
      refMap: null,
    };
    const fragments = [
      {
        node: null,
        blockSize: 0,
        childFragments: [],
        breakToken: null,
        isBlank: false,
        constraints: { contentArea: size, namedPage: "cover" },
        counterState: null,
      },
      {
        node: null,
        blockSize: 0,
        childFragments: [],
        breakToken: null,
        isBlank: false,
        constraints: { contentArea: size, namedPage: "chapter" },
        counterState: null,
      },
      {
        node: null,
        blockSize: 0,
        childFragments: [],
        breakToken: null,
        isBlank: false,
        constraints: { contentArea: size, namedPage: null },
        counterState: null,
      },
    ];

    const flow = new FragmentationContext(fragments, contentStyles);
    const elements = [];
    for (let i = 0; i < fragments.length; i++) {
      elements.push(flow.createFragmentainer(i));
    }

    expect(elements[0].namedPage).toBe("cover");
    expect(elements[1].namedPage).toBe("chapter");
    expect(elements[2].namedPage).toBeNull();
  });
});
