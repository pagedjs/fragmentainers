import { describe, it, expect, afterEach } from "vitest";
import { FragmentainerLayout, FragmentedFlow } from "../../src/core/fragmentainer-layout.js";
import { buildFragmentainerElement } from "../../src/compositor/fragmentainer-builder.js";
import "../../src/dom/fragment-container.js";

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

    const elements = [];
    for (let i = 0; i < fragments.length; i++) {
      elements.push(await buildFragmentainerElement(i, fragments, [size], contentStyles));
    }

    expect(elements[0].namedPage).toBe("cover");
    expect(elements[1].namedPage).toBe("chapter");
    expect(elements[2].namedPage).toBeNull();
  });
});
