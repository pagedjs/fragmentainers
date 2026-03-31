import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FragmentainerLayout } from "../src/fragmentainer-layout.js";
import "../src/dom/frag-measure.js"; // registers <fragment-container> custom element

describe("FragmentainerLayout.reflow() (browser)", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("reflow(0) after height change produces different fragment count", () => {
    container.innerHTML = `<div style="margin:0; padding:0;">
      <div id="target" style="height: 200px; margin: 0;"></div>
    </div>`;
    const el = container.firstElementChild;
    const layout = new FragmentainerLayout(el, { width: 400, height: 100 });
    const flow = layout.flow();
    const originalCount = flow.fragmentainerCount;
    expect(originalCount).toBeGreaterThanOrEqual(2);

    // Shrink the content to fit in one fragmentainer
    document.getElementById("target").style.height = "50px";

    layout.reflow(0);
    const flow2 = layout.flow();
    expect(flow2.fragmentainerCount).toBe(1);
  });

  it("reflow(0) after height increase produces more fragments", () => {
    container.innerHTML = `<div style="margin:0; padding:0;">
      <div id="target" style="height: 100px; margin: 0;"></div>
    </div>`;
    const el = container.firstElementChild;
    const layout = new FragmentainerLayout(el, { width: 400, height: 100 });
    const flow = layout.flow();
    expect(flow.fragmentainerCount).toBe(1);

    // Grow the content
    document.getElementById("target").style.height = "350px";

    layout.reflow(0);
    const flow2 = layout.flow();
    expect(flow2.fragmentainerCount).toBeGreaterThan(1);
  });

  it("reflow(1) preserves fragment 0 and re-layouts from index 1", () => {
    container.innerHTML = `<div style="margin:0; padding:0;">
      <div style="height: 100px; margin: 0;"></div>
      <div style="height: 100px; margin: 0;"></div>
      <div style="height: 100px; margin: 0;"></div>
    </div>`;
    const el = container.firstElementChild;
    const layout = new FragmentainerLayout(el, { width: 400, height: 150 });
    const flow = layout.flow();

    const frag0BlockSize = flow.fragments[0].blockSize;
    const originalCount = flow.fragmentainerCount;
    expect(originalCount).toBe(2);

    // Reflow from index 1 — fragment 0 should be untouched
    layout.reflow(1);
    const frag1 = layout.next();
    expect(frag1.blockSize).toBeGreaterThan(0);
    // Fragment 0 in the original flow should still be the same object
    expect(flow.fragments[0].blockSize).toBe(frag0BlockSize);
  });
});

describe("FragmentedFlow.reflow() (browser)", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("reflow(0) returns rendered elements", () => {
    container.innerHTML = `<div style="margin:0; padding:0;">
      <div style="height: 200px; margin: 0;"></div>
    </div>`;
    const el = container.firstElementChild;
    const layout = new FragmentainerLayout(el, { width: 400, height: 100 });
    const flow = layout.flow();
    const originalCount = flow.fragmentainerCount;

    const result = flow.reflow(0);
    expect(result.from).toBe(0);
    expect(result.removedCount).toBe(originalCount);
    expect(result.elements.length).toBe(flow.fragmentainerCount);
    expect(result.elements[0].tagName.toLowerCase()).toBe("fragment-container");
  });

  it("reflow(0) after size change updates fragments and rendered elements", () => {
    container.innerHTML = `<div style="margin:0; padding:0;">
      <div id="target" style="height: 200px; margin: 0;"></div>
    </div>`;
    const el = container.firstElementChild;
    const layout = new FragmentainerLayout(el, { width: 400, height: 100 });
    const flow = layout.flow();
    expect(flow.fragmentainerCount).toBeGreaterThanOrEqual(2);

    // Shrink content
    document.getElementById("target").style.height = "50px";

    const result = flow.reflow(0);
    expect(flow.fragmentainerCount).toBe(1);
    expect(result.elements.length).toBe(1);
  });
});

describe("FragmentContainerElement observers (browser)", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("rendered elements have correct fragmentIndex", () => {
    container.innerHTML = `<div style="margin:0; padding:0;">
      <div style="height: 200px; margin: 0;"></div>
    </div>`;
    const el = container.firstElementChild;
    const layout = new FragmentainerLayout(el, { width: 400, height: 100 });
    const flow = layout.flow();
    const result = flow.reflow(0);

    for (let i = 0; i < result.elements.length; i++) {
      expect(result.elements[i].fragmentIndex).toBe(i);
    }
  });

  it("startObserving() fires fragment-change on content mutation", async () => {
    container.innerHTML = `<div style="margin:0; padding:0;">
      <div style="height: 200px; margin: 0;"></div>
    </div>`;
    const el = container.firstElementChild;
    const layout = new FragmentainerLayout(el, { width: 400, height: 100 });
    const flow = layout.flow();
    const result = flow.reflow(0);
    const fragEl = result.elements[0];
    container.appendChild(fragEl);

    const received = [];
    fragEl.addEventListener("fragment-change", (e) => {
      received.push(e.detail);
    });

    fragEl.startObserving();

    // Wait for rAF (startObserving defers) + mutation + microtask
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        // Mutate content inside the shadow DOM wrapper
        const wrapper = fragEl.contentRoot;
        const div = document.createElement("div");
        div.style.height = "50px";
        wrapper.appendChild(div);

        // Wait for microtask coalescing
        queueMicrotask(() => {
          queueMicrotask(() => {
            resolve();
          });
        });
      });
    });

    expect(received.length).toBe(1);
    expect(received[0].index).toBe(0);
  });

  it("stopObserving() prevents further events", async () => {
    container.innerHTML = `<div style="margin:0; padding:0;">
      <div style="height: 200px; margin: 0;"></div>
    </div>`;
    const el = container.firstElementChild;
    const layout = new FragmentainerLayout(el, { width: 400, height: 100 });
    const flow = layout.flow();
    const result = flow.reflow(0);
    const fragEl = result.elements[0];
    container.appendChild(fragEl);

    const received = [];
    fragEl.addEventListener("fragment-change", (e) => {
      received.push(e.detail);
    });

    fragEl.startObserving();

    // Wait for rAF to attach observers, then stop
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        fragEl.stopObserving();

        // Mutate content
        const wrapper = fragEl.contentRoot;
        wrapper.appendChild(document.createElement("div"));

        queueMicrotask(() => {
          queueMicrotask(() => {
            resolve();
          });
        });
      });
    });

    expect(received.length).toBe(0);
  });
});
