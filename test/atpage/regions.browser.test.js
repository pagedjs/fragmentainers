import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FragmentainerLayout } from "../../src/core/fragmentainer-layout.js";
import { RegionResolver } from "../../src/regions/region-resolver.js";
import { renderFragmentTree } from "../../src/compositor/render-fragments.js";

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

describe("FragmentainerLayout with regions", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("flows content across region elements via next()", async () => {
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

    const layout = new FragmentainerLayout(content, { resolver: new RegionResolver(regions) });
    await layout.setup();

    for (const region of regions) {
      const fragment = layout.next();
      region.appendChild(renderFragmentTree(fragment, null));
    }

    // 300px of content across 3 regions of 100px each = all consumed
    // Check that regions received content
    expect(regions[0].childNodes.length).toBeGreaterThan(0);
  });

  it("stops when regions run out with content remaining", async () => {
    container.innerHTML = `
      <div id="content" style="margin:0; padding:0;">
        <div style="height: 500px; margin: 0;"></div>
      </div>
      <div class="region" style="width: 200px; height: 100px;"></div>
    `;

    const content = container.querySelector("#content");
    const regions = [...container.querySelectorAll(".region")];

    const layout = new FragmentainerLayout(content, { resolver: new RegionResolver(regions) });
    await layout.setup();

    let lastFragment;
    for (let i = 0; i < regions.length; i++) {
      lastFragment = layout.next();
    }

    // Only 1 region for 500px of content — breakToken should be non-null
    expect(lastFragment.breakToken).not.toBeNull();
  });

  it("content fits in a single region", async () => {
    container.innerHTML = `
      <div id="content" style="margin:0; padding:0;">
        <div style="height: 50px; margin: 0;"></div>
      </div>
      <div class="region" style="width: 200px; height: 200px;"></div>
    `;

    const content = container.querySelector("#content");
    const regions = [...container.querySelectorAll(".region")];

    const layout = new FragmentainerLayout(content, { resolver: new RegionResolver(regions) });
    await layout.setup();
    const fragment = layout.next();

    // Content fits in one region
    expect(fragment.breakToken).toBeNull();
    expect(fragment.blockSize).toBe(50);
  });

  it("supports variable-sized regions", async () => {
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

    const layout = new FragmentainerLayout(content, { resolver: new RegionResolver(regions) });
    await layout.setup();

    const frag1 = layout.next();
    expect(frag1.breakToken).not.toBeNull();

    const frag2 = layout.next();
    expect(frag2.breakToken).toBeNull();
  });
});
