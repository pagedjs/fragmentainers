import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FragmentainerLayout, FragmentedFlow } from "../src/fragmentainer-layout.js";

describe("FragmentainerLayout.flow() (browser)", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("fragments simple content across multiple fragmentainers", () => {
    container.innerHTML = `<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>`;
    const el = container.firstElementChild;
    const layout = new FragmentainerLayout(el, {
      width: 400, height: 100,
    });
    const flow = layout.flow();
    expect(flow).toBeInstanceOf(FragmentedFlow);
    expect(flow.fragmentainerCount).toBeGreaterThanOrEqual(2);
  });

  it("produces a single fragmentainer when content fits", () => {
    container.innerHTML = `<div style="margin:0; padding:0;"><div style="height: 50px; margin: 0;"></div></div>`;
    const el = container.firstElementChild;
    const layout = new FragmentainerLayout(el, {
      width: 400, height: 800,
    });
    const flow = layout.flow();
    expect(flow.fragmentainerCount).toBe(1);
  });

  it("fragments text content across multiple pages", () => {
    container.innerHTML = `<div style="width: 200px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">${"word ".repeat(100)}</div>`;
    const el = container.firstElementChild;
    const layout = new FragmentainerLayout(el, {
      width: 200, height: 60,
    });
    const flow = layout.flow();
    expect(flow.fragmentainerCount).toBeGreaterThan(1);
  });

  it("produces fragments with correct structure", () => {
    container.innerHTML = `<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>`;
    const el = container.firstElementChild;
    const layout = new FragmentainerLayout(el, {
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
});
