import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FragmentainerLayout } from "../../src/core/fragmentainer-layout.js";
import { MutationSync } from "../../src/dom/mutation-sync.js";
import "../../src/dom/content-measure.js";
import "../../src/dom/fragment-container.js";

/** Inject an HTML string into a content-measure element. */
function injectHTML(measurer, html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  return measurer.injectFragment(t.content);
}

describe("ContentMeasureElement ref assignment", () => {
  let measurer;

  beforeEach(() => {
    measurer = document.createElement("content-measure");
    measurer.trackRefs = true;
    document.body.appendChild(measurer);
  });

  afterEach(() => {
    measurer.remove();
  });

  it("tracks all elements in refMap and sourceRefs", () => {
    injectHTML(measurer, "<div><p>Hello</p><p>World</p></div>");
    // refMap tracks all 3 elements (div + 2 p's)
    expect(measurer.refMap.size).toBe(3);
    expect(measurer.refMap.get("0").tagName).toBe("DIV");
    expect(measurer.refMap.get("1").tagName).toBe("P");
    expect(measurer.refMap.get("2").tagName).toBe("P");

    // sourceRefs maps source elements to their ref strings
    const div = measurer.refMap.get("0");
    expect(measurer.sourceRefs.get(div)).toBe("0");
  });

  it("does not set data-ref attributes on source elements", () => {
    injectHTML(measurer, "<div><p>Hello</p></div>");
    const els = measurer.contentRoot.querySelectorAll("[data-ref]");
    expect(els.length).toBe(0);
  });

  it("assignRef() increments counter and adds to maps", () => {
    injectHTML(measurer, "<div></div>");
    const existingCount = measurer.refMap.size;

    const newEl = document.createElement("p");
    measurer.contentRoot.firstElementChild.appendChild(newEl);
    const ref = measurer.assignRef(newEl);

    expect(ref).toBe(String(existingCount));
    expect(measurer.refMap.get(ref)).toBe(newEl);
    expect(measurer.sourceRefs.get(newEl)).toBe(ref);
  });

  it("removeRef() cleans up both maps", () => {
    injectHTML(measurer, "<div><p>Test</p></div>");
    const el = measurer.refMap.get("1");
    expect(measurer.refMap.has("1")).toBe(true);
    expect(measurer.sourceRefs.get(el)).toBe("1");

    measurer.removeRef("1");
    expect(measurer.refMap.has("1")).toBe(false);
    expect(measurer.sourceRefs.has(el)).toBe(false);
  });
});

describe("Refs in composed fragments", () => {
  let layout;

  afterEach(() => {
    layout?.destroy();
  });

  it("composed clones carry the same data-ref as source", async () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="margin:0; padding:0;">
      <div id="a" style="height: 100px; margin: 0;"></div>
      <div id="b" style="height: 100px; margin: 0;"></div>
    </div>`;

    layout = new FragmentainerLayout(template.content, { width: 400, height: 150, trackRefs: true });
    const flow = await layout.flow();

    // Check that clones in composed containers have data-ref
    for (const fragEl of flow) {
      document.body.appendChild(fragEl);
      const refsInClone = fragEl.contentRoot.querySelectorAll("[data-ref]");
      expect(refsInClone.length).toBeGreaterThan(0);
      document.body.removeChild(fragEl);
    }
  });
});

describe("MutationSync attribute sync", () => {
  let measurer;

  beforeEach(() => {
    measurer = document.createElement("content-measure");
    measurer.trackRefs = true;
    document.body.appendChild(measurer);
  });

  afterEach(() => {
    measurer.remove();
  });

  it("syncs attribute changes to source", () => {
    injectHTML(measurer, "<div><p>Hello</p></div>");
    const sync = new MutationSync(
      measurer.refMap,
      measurer.contentRoot,
      (el) => measurer.assignRef(el),
      (ref) => measurer.removeRef(ref),
    );

    // Simulate a mutation record for an attribute change
    const sourceP = measurer.refMap.get("1");
    expect(sourceP.getAttribute("class")).toBeNull();

    // Create a mock clone element with the same data-ref
    const clone = document.createElement("p");
    clone.setAttribute("data-ref", "1");
    clone.setAttribute("class", "highlight");

    const mutation = {
      type: "attributes",
      attributeName: "class",
      target: clone,
    };

    const { changed } = sync.applyMutations([mutation]);
    expect(changed).toBe(true);
    expect(sourceP.getAttribute("class")).toBe("highlight");
  });

  it("skips compositor-managed attributes", () => {
    injectHTML(measurer, "<div></div>");
    const sync = new MutationSync(
      measurer.refMap, measurer.contentRoot,
      (el) => measurer.assignRef(el),
      (ref) => measurer.removeRef(ref),
    );

    const clone = document.createElement("div");
    clone.setAttribute("data-ref", "0");
    clone.setAttribute("data-split-from", "");

    const mutation = {
      type: "attributes",
      attributeName: "data-split-from",
      target: clone,
    };

    const { changed } = sync.applyMutations([mutation]);
    expect(changed).toBe(false);
  });

  it("removes attribute from source when removed from clone", () => {
    injectHTML(measurer, "<div class=\"old\"></div>");
    const source = measurer.refMap.get("0");
    expect(source.getAttribute("class")).toBe("old");

    const sync = new MutationSync(
      measurer.refMap, measurer.contentRoot,
      (el) => measurer.assignRef(el),
      (ref) => measurer.removeRef(ref),
    );

    // Clone with attribute removed
    const clone = document.createElement("div");
    clone.setAttribute("data-ref", "0");
    // No class attribute on clone

    const mutation = {
      type: "attributes",
      attributeName: "class",
      target: clone,
    };

    sync.applyMutations([mutation]);
    expect(source.getAttribute("class")).toBeNull();
  });
});

describe("MutationSync element removal", () => {
  let measurer;

  beforeEach(() => {
    measurer = document.createElement("content-measure");
    measurer.trackRefs = true;
    document.body.appendChild(measurer);
  });

  afterEach(() => {
    measurer.remove();
  });

  it("removes source element when clone is removed", () => {
    injectHTML(measurer, "<div><p>Keep</p><p>Remove</p></div>");
    const sync = new MutationSync(
      measurer.refMap, measurer.contentRoot,
      (el) => measurer.assignRef(el),
      (ref) => measurer.removeRef(ref),
    );

    const removedP = document.createElement("p");
    removedP.setAttribute("data-ref", "2"); // the second <p>

    const mutation = {
      type: "childList",
      addedNodes: [],
      removedNodes: [removedP],
      target: document.createElement("div"),
    };

    const { changed, structural } = sync.applyMutations([mutation]);
    expect(changed).toBe(true);
    expect(structural).toBe(true);
    expect(measurer.refMap.has("2")).toBe(false);
    // Source should now have only 1 <p>
    expect(measurer.contentRoot.querySelectorAll("p").length).toBe(1);
  });
});

describe("MutationSync element addition", () => {
  let measurer;

  beforeEach(() => {
    measurer = document.createElement("content-measure");
    measurer.trackRefs = true;
    document.body.appendChild(measurer);
  });

  afterEach(() => {
    measurer.remove();
  });

  it("inserts new element at correct position in source", () => {
    injectHTML(measurer, "<div><p>First</p><p>Second</p></div>");
    const sync = new MutationSync(
      measurer.refMap, measurer.contentRoot,
      (el) => measurer.assignRef(el),
      (ref) => measurer.removeRef(ref),
    );

    // Simulate: new <h2> added between the two <p> elements in a clone
    const newH2 = document.createElement("h2");
    newH2.textContent = "Inserted";

    // Build a mock parent with siblings to simulate the clone DOM
    const mockParent = document.createElement("div");
    mockParent.setAttribute("data-ref", "0");
    const p1 = document.createElement("p");
    p1.setAttribute("data-ref", "1");
    const p2 = document.createElement("p");
    p2.setAttribute("data-ref", "2");
    mockParent.appendChild(p1);
    mockParent.appendChild(newH2);
    mockParent.appendChild(p2);

    const mutation = {
      type: "childList",
      addedNodes: [newH2],
      removedNodes: [],
      target: mockParent,
    };

    const { changed, structural } = sync.applyMutations([mutation]);
    expect(changed).toBe(true);
    expect(structural).toBe(true);

    // Source should now have 3 children in the div
    const sourceDiv = measurer.refMap.get("0");
    expect(sourceDiv.children.length).toBe(3);
    expect(sourceDiv.children[1].tagName).toBe("H2");
    // New element is tracked in sourceRefs (no data-ref attribute on source)
    expect(measurer.sourceRefs.has(sourceDiv.children[1])).toBe(true);
  });

  it("assigns data-ref to added element and its descendants", () => {
    injectHTML(measurer, "<div><p>Existing</p></div>");
    const sync = new MutationSync(
      measurer.refMap, measurer.contentRoot,
      (el) => measurer.assignRef(el),
      (ref) => measurer.removeRef(ref),
    );

    const newDiv = document.createElement("div");
    const innerSpan = document.createElement("span");
    innerSpan.textContent = "Nested";
    newDiv.appendChild(innerSpan);

    const mockParent = document.createElement("div");
    mockParent.setAttribute("data-ref", "0");
    const existingP = document.createElement("p");
    existingP.setAttribute("data-ref", "1");
    mockParent.appendChild(existingP);
    mockParent.appendChild(newDiv);

    const mutation = {
      type: "childList",
      addedNodes: [newDiv],
      removedNodes: [],
      target: mockParent,
    };

    sync.applyMutations([mutation]);

    // Both the added div and its span child should be tracked in sourceRefs
    const sourceDiv = measurer.refMap.get("0");
    const addedDiv = sourceDiv.children[1];
    expect(measurer.sourceRefs.has(addedDiv)).toBe(true);
    expect(measurer.sourceRefs.has(addedDiv.querySelector("span"))).toBe(true);
  });
});

describe("FragmentContainerElement.takeMutationRecords()", () => {
  let layout;

  afterEach(() => {
    layout?.destroy();
  });

  it("returns buffered mutations and clears the buffer", async () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="margin:0; padding:0;">
      <div style="height: 200px; margin: 0;"></div>
    </div>`;
    layout = new FragmentainerLayout(template.content, { width: 400, height: 100, trackRefs: true });
    const flow = await layout.flow();
    const fragEl = flow[0];
    document.body.appendChild(fragEl);

    fragEl.startObserving();

    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        // Mutate content inside the fragment
        const wrapper = fragEl.contentRoot;
        wrapper.setAttribute("data-test", "value");

        // Wait for observer to fire
        queueMicrotask(() => {
          queueMicrotask(() => {
            const records = fragEl.takeMutationRecords();
            expect(records.length).toBeGreaterThan(0);

            // Second call should be empty
            const records2 = fragEl.takeMutationRecords();
            expect(records2.length).toBe(0);
            fragEl.remove();
            resolve();
          });
        });
      });
    });
  });
});

describe("reflow with rebuild", () => {
  let layout;

  afterEach(() => {
    layout?.destroy();
  });

  it("reflow(0, { rebuild: true }) picks up structural changes", async () => {
    const template = document.createElement("template");
    template.innerHTML = `<div style="margin:0; padding:0;">
      <div style="height: 100px; margin: 0;"></div>
    </div>`;
    layout = new FragmentainerLayout(template.content, { width: 400, height: 200, trackRefs: true });
    const flow = await layout.flow();
    expect(flow.fragmentainerCount).toBe(1);

    // Add a new element to the source DOM (via detached content root)
    const wrapper = layout.contentRoot.firstElementChild;
    const newDiv = document.createElement("div");
    newDiv.style.height = "200px";
    newDiv.style.margin = "0";
    wrapper.appendChild(newDiv);

    // Reflow with rebuild to pick up the structural change
    const newFlow = await layout.reflow(0, { rebuild: true });
    expect(newFlow.fragmentainerCount).toBeGreaterThan(1);
  });
});
