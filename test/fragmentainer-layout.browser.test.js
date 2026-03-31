import { describe, it, expect, afterEach } from "vitest";
import { FragmentainerLayout, FragmentedFlow } from "../src/fragmentainer-layout.js";

describe("FragmentainerLayout.flow() (browser)", () => {
  let layout;

  afterEach(() => {
    layout?.destroy();
  });

  it("fragments simple content across multiple fragmentainers", () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>`;
    layout = new FragmentainerLayout(template.content, {
      width: 400, height: 100,
    });
    const flow = layout.flow();
    expect(flow).toBeInstanceOf(FragmentedFlow);
    expect(flow.fragmentainerCount).toBeGreaterThanOrEqual(2);
  });

  it("produces a single fragmentainer when content fits", () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="margin:0; padding:0;"><div style="height: 50px; margin: 0;"></div></div>`;
    layout = new FragmentainerLayout(template.content, {
      width: 400, height: 800,
    });
    const flow = layout.flow();
    expect(flow.fragmentainerCount).toBe(1);
  });

  it("fragments text content across multiple pages", () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="width: 200px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">${"word ".repeat(100)}</div>`;
    layout = new FragmentainerLayout(template.content, {
      width: 200, height: 60,
    });
    const flow = layout.flow();
    expect(flow.fragmentainerCount).toBeGreaterThan(1);
  });

  it("produces fragments with correct structure", () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>`;
    layout = new FragmentainerLayout(template.content, {
      width: 400, height: 100,
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

  it("accepts an Element and clones it into a DocumentFragment", () => {
    const container = document.createElement("div");
    container.innerHTML = `<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>`;
    document.body.appendChild(container);
    const el = container.firstElementChild;

    layout = new FragmentainerLayout(el, {
      width: 400, height: 100,
    });
    const flow = layout.flow();
    expect(flow.fragmentainerCount).toBeGreaterThanOrEqual(2);

    // Original element should still be in the DOM (was cloned, not moved)
    expect(container.firstElementChild).toBe(el);
    container.remove();
  });
});
