import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FragmentedFlow } from "../../src/core/fragmented-flow.js";
import { MutationSync } from "../../src/modules/mutation-sync.js";
import { modules } from "../../src/modules/registry.js";
import "../../src/dom/content-measure.js";
import "../../src/dom/fragment-container.js";

describe("MutationSync with shared clone map", () => {
  let layout;

  afterEach(() => {
    layout?.destroy();
    FragmentedFlow.remove(syncModule);
  });

  let syncModule;

  it("populates the clone map via onClone during composition", async () => {
    syncModule = new MutationSync();
    FragmentedFlow.register(syncModule);

    const template = document.createElement("template");
    template.innerHTML = `<div style="margin:0; padding:0;">
      <div id="a" style="height: 100px; margin: 0;"></div>
      <div id="b" style="height: 100px; margin: 0;"></div>
    </div>`;

    layout = new FragmentedFlow(template.content, { width: 400, height: 150 });
    const flow = layout.flow();

    // The sync module should be able to resolve attributes on clones
    const fragEl = flow[0];
    document.body.appendChild(fragEl);
    const clone = fragEl.contentRoot.querySelector("div");
    expect(clone).not.toBeNull();

    // Set an attribute on the clone and sync it
    clone.setAttribute("class", "test");
    const mutation = {
      type: "attributes",
      attributeName: "class",
      target: clone,
    };
    const { changed } = syncModule.applyMutations([mutation]);
    expect(changed).toBe(true);
    document.body.removeChild(fragEl);
  });
});

describe("MutationSync attribute sync", () => {
  it("syncs attribute changes via clone map", () => {
    const sync = new MutationSync();
    const source = document.createElement("p");
    const clone = document.createElement("p");
    modules.trackClone(clone, source);
    clone.setAttribute("class", "highlight");

    const mutation = {
      type: "attributes",
      attributeName: "class",
      target: clone,
    };

    const { changed } = sync.applyMutations([mutation]);
    expect(changed).toBe(true);
    expect(source.getAttribute("class")).toBe("highlight");
  });

  it("skips compositor-managed attributes", () => {
    const sync = new MutationSync();
    const source = document.createElement("div");
    const clone = document.createElement("div");
    modules.trackClone(clone, source);
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
    const sync = new MutationSync();
    const source = document.createElement("div");
    source.setAttribute("class", "old");
    const clone = document.createElement("div");
    modules.trackClone(clone, source);

    const mutation = {
      type: "attributes",
      attributeName: "class",
      target: clone,
    };

    sync.applyMutations([mutation]);
    expect(source.getAttribute("class")).toBeNull();
  });

  it("ignores unmapped elements", () => {
    const sync = new MutationSync();
    const clone = document.createElement("div");
    clone.setAttribute("class", "test");

    const mutation = {
      type: "attributes",
      attributeName: "class",
      target: clone,
    };

    const { changed } = sync.applyMutations([mutation]);
    expect(changed).toBe(false);
  });
});

describe("MutationSync element removal", () => {
  it("removes source element when clone is removed", () => {
    const sync = new MutationSync();
    const sourceParent = document.createElement("div");
    const sourceP1 = document.createElement("p");
    sourceP1.textContent = "Keep";
    const sourceP2 = document.createElement("p");
    sourceP2.textContent = "Remove";
    sourceParent.appendChild(sourceP1);
    sourceParent.appendChild(sourceP2);

    const removedClone = document.createElement("p");
    modules.trackClone(removedClone, sourceP2);

    const mutation = {
      type: "childList",
      addedNodes: [],
      removedNodes: [removedClone],
      target: document.createElement("div"),
    };

    const { changed, structural } = sync.applyMutations([mutation]);
    expect(changed).toBe(true);
    expect(structural).toBe(true);
    expect(sourceParent.querySelectorAll("p").length).toBe(1);
    expect(sourceParent.firstChild.textContent).toBe("Keep");
  });
});

describe("MutationSync element addition", () => {
  it("inserts new element at correct position in source", () => {
    const sync = new MutationSync();
    const sourceDiv = document.createElement("div");
    const sourceP1 = document.createElement("p");
    sourceP1.textContent = "First";
    const sourceP2 = document.createElement("p");
    sourceP2.textContent = "Second";
    sourceDiv.appendChild(sourceP1);
    sourceDiv.appendChild(sourceP2);

    const mockParent = document.createElement("div");
    modules.trackClone(mockParent, sourceDiv);
    const cloneP1 = document.createElement("p");
    modules.trackClone(cloneP1, sourceP1);
    const cloneP2 = document.createElement("p");
    modules.trackClone(cloneP2, sourceP2);
    const newH2 = document.createElement("h2");
    newH2.textContent = "Inserted";

    mockParent.appendChild(cloneP1);
    mockParent.appendChild(newH2);
    mockParent.appendChild(cloneP2);

    const mutation = {
      type: "childList",
      addedNodes: [newH2],
      removedNodes: [],
      target: mockParent,
    };

    const { changed, structural } = sync.applyMutations([mutation]);
    expect(changed).toBe(true);
    expect(structural).toBe(true);

    expect(sourceDiv.children.length).toBe(3);
    expect(sourceDiv.children[1].tagName).toBe("H2");
    expect(sourceDiv.children[1].textContent).toBe("Inserted");
  });

  it("maps added element and descendants into clone map", () => {
    const sync = new MutationSync();
    const sourceDiv = document.createElement("div");
    const sourceP = document.createElement("p");
    sourceDiv.appendChild(sourceP);

    const mockParent = document.createElement("div");
    modules.trackClone(mockParent, sourceDiv);
    const cloneP = document.createElement("p");
    modules.trackClone(cloneP, sourceP);

    const newDiv = document.createElement("div");
    const innerSpan = document.createElement("span");
    innerSpan.textContent = "Nested";
    newDiv.appendChild(innerSpan);

    mockParent.appendChild(cloneP);
    mockParent.appendChild(newDiv);

    const mutation = {
      type: "childList",
      addedNodes: [newDiv],
      removedNodes: [],
      target: mockParent,
    };

    sync.applyMutations([mutation]);

    // Future attribute sync on the added element should work
    newDiv.setAttribute("class", "added");
    const { changed } = sync.applyMutations([{
      type: "attributes",
      attributeName: "class",
      target: newDiv,
    }]);
    expect(changed).toBe(true);
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
    layout = new FragmentedFlow(template.content, { width: 400, height: 100 });
    const flow = layout.flow();
    const fragEl = flow[0];
    document.body.appendChild(fragEl);

    fragEl.startObserving();

    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        const wrapper = fragEl.contentRoot;
        wrapper.setAttribute("data-test", "value");

        queueMicrotask(() => {
          queueMicrotask(() => {
            const records = fragEl.takeMutationRecords();
            expect(records.length).toBeGreaterThan(0);

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
    layout = new FragmentedFlow(template.content, { width: 400, height: 200, trackRefs: true });
    const flow = layout.flow();
    expect(flow.fragmentainerCount).toBe(1);

    const wrapper = layout.contentRoot.firstElementChild;
    const newDiv = document.createElement("div");
    newDiv.style.height = "200px";
    newDiv.style.margin = "0";
    wrapper.appendChild(newDiv);

    const newFlow = layout.reflow(0, { rebuild: true });
    expect(newFlow.fragmentainerCount).toBeGreaterThan(1);
  });
});
