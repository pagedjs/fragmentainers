import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FragmentedFlow } from "../../src/core/fragmented-flow.js";
import { RegionResolver } from "../../src/regions/region-resolver.js";

describe("RegionResolver", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("resolves dimensions from region elements", () => {
    container.innerHTML = `
      <div class="region" style="width: 300px; height: 200px;"></div>
      <div class="region" style="width: 400px; height: 150px;"></div>
    `;
    const regions = [...container.querySelectorAll(".region")];
    const resolver = new RegionResolver(regions);

    const c0 = resolver.resolve(0);
    expect(c0.contentArea.inlineSize).toBe(300);
    expect(c0.contentArea.blockSize).toBe(200);
    expect(c0.element).toBe(regions[0]);

    const c1 = resolver.resolve(1);
    expect(c1.contentArea.inlineSize).toBe(400);
    expect(c1.contentArea.blockSize).toBe(150);
    expect(c1.element).toBe(regions[1]);
  });

  it("toConstraintSpace produces region fragmentation type", () => {
    container.innerHTML = "<div style=\"width: 300px; height: 200px;\"></div>";
    const resolver = new RegionResolver([container.firstElementChild]);

    const cs = resolver.resolve(0).toConstraintSpace();
    expect(cs.fragmentationType).toBe("region");
    expect(cs.availableInlineSize).toBe(300);
    expect(cs.availableBlockSize).toBe(200);
  });
});

describe("FragmentedFlow with regions", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("flows content across region elements via iterator", () => {
    // Content: tall block that won't fit in one region
    container.innerHTML = `
      <div id="content" style="margin:0; padding:0;">
        <div style="height: 300px; margin: 0;"></div>
      </div>
      <div class="region" style="width: 200px; height: 100px;"></div>
      <div class="region" style="width: 200px; height: 100px;"></div>
      <div class="region" style="width: 200px; height: 100px;"></div>
    `;

    const content = container.querySelector("#content");
    const regions = [...container.querySelectorAll(".region")];

    const layout = new FragmentedFlow(content, { resolver: new RegionResolver(regions) });
    let i = 0;
    for (const el of layout) {
      if (i >= regions.length) break;
      regions[i].appendChild(el);
      i++;
    }

    // 300px of content across 3 regions of 100px each = all consumed
    // Check that regions received content
    expect(regions[0].childNodes.length).toBeGreaterThan(0);
  });

  it("stops when regions run out with content remaining", () => {
    container.innerHTML = `
      <div id="content" style="margin:0; padding:0;">
        <div style="height: 500px; margin: 0;"></div>
      </div>
      <div class="region" style="width: 200px; height: 100px;"></div>
    `;

    const content = container.querySelector("#content");
    const regions = [...container.querySelectorAll(".region")];

    const layout = new FragmentedFlow(content, { resolver: new RegionResolver(regions) });
    let result;
    for (let i = 0; i < regions.length; i++) {
      result = layout.next();
    }

    // Only 1 region for 500px of content — iterator should not be done
    expect(result.done).toBe(false);
  });

  it("content fits in a single region", () => {
    container.innerHTML = `
      <div id="content" style="margin:0; padding:0;">
        <div style="height: 50px; margin: 0;"></div>
      </div>
      <div class="region" style="width: 200px; height: 200px;"></div>
    `;

    const content = container.querySelector("#content");
    const regions = [...container.querySelectorAll(".region")];

    const layout = new FragmentedFlow(content, { resolver: new RegionResolver(regions) });
    const result = layout.next();

    // Content fits in one region — iterator should be done
    expect(result.done).toBe(false);
    expect(result.value).toBeDefined();
    // Next call should be done
    const result2 = layout.next();
    expect(result2.done).toBe(true);
  });

  it("supports variable-sized regions", () => {
    container.innerHTML = `
      <div id="content" style="margin:0; padding:0;">
        <div style="height: 80px; margin: 0;"></div>
        <div style="height: 80px; margin: 0;"></div>
      </div>
      <div class="region" style="width: 300px; height: 100px;"></div>
      <div class="region" style="width: 400px; height: 100px;"></div>
    `;

    const content = container.querySelector("#content");
    const regions = [...container.querySelectorAll(".region")];

    const layout = new FragmentedFlow(content, { resolver: new RegionResolver(regions) });
    const r1 = layout.next();
    expect(r1.done).toBe(false);

    const r2 = layout.next();
    expect(r2.done).toBe(false);

    // All content placed — next should be done
    const r3 = layout.next();
    expect(r3.done).toBe(true);
  });
});
