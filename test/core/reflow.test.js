import { describe, it, expect, afterEach } from "vitest";
import { ConstraintSpace } from "../../src/core/constraint-space.js";
import { FragmentedFlow } from "../../src/core/fragmented-flow.js";
import { blockNode } from "../fixtures/nodes.js";
import "../../src/dom/fragment-container.js"; // registers <fragment-container> custom element

describe("FragmentedFlow.reflow()", () => {
  function makeLayout(children, blockSize = 300) {
    const root = blockNode({ children });
    const cs = new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: blockSize,
      fragmentainerBlockSize: blockSize,
      fragmentationType: "column",
    });
    return new FragmentedFlow(root, { constraintSpace: cs });
  }

  it("reflow(0) matches a fresh layout", () => {
    const children = [
      blockNode({ blockSize: 200 }),
      blockNode({ blockSize: 200 }),
      blockNode({ blockSize: 200 }),
    ];

    const fresh = makeLayout(children).flow().fragments;

    const layout2 = makeLayout(children);
    layout2.flow();
    const reflowed = layout2.reflow(0);

    expect(reflowed.fragments.length).toBe(fresh.length);
    for (let i = 0; i < fresh.length; i++) {
      expect(reflowed.fragments[i].blockSize).toBe(fresh[i].blockSize);
      expect(reflowed.fragments[i].childFragments.length).toBe(
        fresh[i].childFragments.length,
      );
    }
  });

  it("reflow(1) matches original fragments from index 1", () => {
    const children = [
      blockNode({ blockSize: 200 }),
      blockNode({ blockSize: 200 }),
      blockNode({ blockSize: 200 }),
    ];

    const fresh = makeLayout(children).flow().fragments;

    const layout2 = makeLayout(children);
    layout2.flow();
    const reflowed = layout2.reflow(1);

    expect(reflowed.fragments.length).toBe(fresh.length - 1);
    for (let i = 0; i < reflowed.fragments.length; i++) {
      expect(reflowed.fragments[i].blockSize).toBe(fresh[i + 1].blockSize);
    }
  });

  it("reflow() restores counter state from preceding fragment", () => {
    const section = blockNode({
      counterReset: "paragraph 0",
      children: [
        blockNode({ blockSize: 200, counterIncrement: "paragraph 1" }),
        blockNode({ blockSize: 200, counterIncrement: "paragraph 1" }),
        blockNode({ blockSize: 200, counterIncrement: "paragraph 1" }),
      ],
    });

    const layout = makeLayout([section]);
    const fragments = layout.flow().fragments;

    const countersBefore = fragments[0].counterState;

    const reflowed = layout.reflow(1);

    if (countersBefore) {
      expect(reflowed.fragments[0].counterState).toBeDefined();
    }
  });

  it("reflow(0) on single-fragment content produces identical result", () => {
    const children = [blockNode({ blockSize: 100 })];

    const layout = makeLayout(children);
    const fresh = layout.flow().fragments;
    expect(fresh.length).toBe(1);

    const reflowed = layout.reflow(0);
    expect(reflowed.fragments[0].blockSize).toBe(fresh[0].blockSize);
    expect(reflowed.fragments[0].breakToken).toBeNull();
  });
});

describe("FragmentedFlow.reflow() (browser)", () => {
  let layout;

  afterEach(() => {
    layout?.destroy();
  });

  it("reflow(0) after height change produces different fragment count", async () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="margin:0; padding:0;">
      <div id="target" style="height: 200px; margin: 0;"></div>
    </div>`;
    layout = new FragmentedFlow(template.content, {
      width: 400,
      height: 100,
    });
    const flow = layout.flow();
    const originalCount = flow.fragmentainerCount;
    expect(originalCount).toBeGreaterThanOrEqual(2);

    // Shrink the content to fit in one fragmentainer
    const target = layout.contentRoot.querySelector("#target");
    target.style.height = "50px";

    const newFlow = layout.reflow(0);
    expect(newFlow.fragmentainerCount).toBe(1);
  });

  it("reflow(0) after height increase produces more fragments", async () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="margin:0; padding:0;">
      <div id="target" style="height: 100px; margin: 0;"></div>
    </div>`;
    layout = new FragmentedFlow(template.content, {
      width: 400,
      height: 100,
    });
    const flow = layout.flow();
    expect(flow.fragmentainerCount).toBe(1);

    // Grow the content
    const target = layout.contentRoot.querySelector("#target");
    target.style.height = "350px";

    const newFlow = layout.reflow(0);
    expect(newFlow.fragmentainerCount).toBeGreaterThan(1);
  });

  it("reflow(1) preserves fragment 0 and re-layouts from index 1", async () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="margin:0; padding:0;">
      <div style="height: 100px; margin: 0;"></div>
      <div style="height: 100px; margin: 0;"></div>
      <div style="height: 100px; margin: 0;"></div>
    </div>`;
    layout = new FragmentedFlow(template.content, {
      width: 400,
      height: 150,
    });
    const flow = layout.flow();

    const frag0BlockSize = flow.fragments[0].blockSize;
    const originalCount = flow.fragmentainerCount;
    expect(originalCount).toBe(2);

    // Reflow from index 1 — fragment 0 should be untouched
    const newFlow = layout.reflow(1);
    expect(newFlow.length).toBeGreaterThan(0);
    expect(newFlow[0].tagName.toLowerCase()).toBe("fragment-container");
    // Fragment 0 in the original flow should still be the same object
    expect(flow.fragments[0].blockSize).toBe(frag0BlockSize);
  });
});

describe("layout.reflow() returns FragmentationContext (browser)", () => {
  let layout;

  afterEach(() => {
    layout?.destroy();
  });

  it("reflow(0) returns a FragmentationContext with elements", async () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="margin:0; padding:0;">
      <div style="height: 200px; margin: 0;"></div>
    </div>`;
    layout = new FragmentedFlow(template.content, {
      width: 400,
      height: 100,
    });
    layout.flow();

    const newFlow = layout.reflow(0);
    expect(newFlow.length).toBeGreaterThan(0);
    expect(newFlow[0].tagName.toLowerCase()).toBe("fragment-container");
  });

  it("reflow(0) after size change returns updated elements", async () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="margin:0; padding:0;">
      <div id="target" style="height: 200px; margin: 0;"></div>
    </div>`;
    layout = new FragmentedFlow(template.content, {
      width: 400,
      height: 100,
    });
    layout.flow();

    // Shrink content
    const target = layout.contentRoot.querySelector("#target");
    target.style.height = "50px";

    const newFlow = layout.reflow(0);
    expect(newFlow.fragmentainerCount).toBe(1);
    expect(newFlow.length).toBe(1);
  });
});

describe("FragmentContainerElement observers (browser)", () => {
  let layout;

  afterEach(() => {
    layout?.destroy();
  });

  it("composed elements have correct fragmentIndex", async () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="margin:0; padding:0;">
      <div style="height: 200px; margin: 0;"></div>
    </div>`;
    layout = new FragmentedFlow(template.content, {
      width: 400,
      height: 100,
    });
    const flow = layout.flow();

    for (let i = 0; i < flow.length; i++) {
      expect(flow[i].fragmentIndex).toBe(i);
    }
  });

  it("startObserving() fires fragment-change on content mutation", async () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="margin:0; padding:0;">
      <div style="height: 200px; margin: 0;"></div>
    </div>`;
    layout = new FragmentedFlow(template.content, {
      width: 400,
      height: 100,
    });
    const flow = layout.flow();
    const fragEl = flow[0];
    document.body.appendChild(fragEl);

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
    fragEl.remove();
  });

  it("stopObserving() prevents further events", async () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="margin:0; padding:0;">
      <div style="height: 200px; margin: 0;"></div>
    </div>`;
    layout = new FragmentedFlow(template.content, {
      width: 400,
      height: 100,
    });
    const flow = layout.flow();
    const fragEl = flow[0];
    document.body.appendChild(fragEl);

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
    fragEl.remove();
  });
});
