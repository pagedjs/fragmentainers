import { describe, it, expect, afterEach } from "vitest";
import { FragmentainerLayout } from "../../src/core/fragmentainer-layout.js";
import { ConstraintSpace } from "../../src/core/constraint-space.js";
import { FRAGMENTATION_PAGE } from "../../src/core/constants.js";

let layout;

afterEach(() => {
  layout?.destroy();
});

function pageConstraint(height = 400) {
  return new ConstraintSpace({
    availableInlineSize: 400,
    availableBlockSize: height,
    fragmentainerBlockSize: height,
    fragmentationType: FRAGMENTATION_PAGE,
  });
}

// Use empty divs (no text content) so they go through the block-container
// leaf path which respects explicit CSS height, rather than being
// classified as inline formatting contexts.

describe("position: fixed in paged media (browser)", () => {
  it("fixed header reduces available page space", async () => {
    const template = document.createElement("template");
    template.innerHTML = `
      <div style="margin: 0; padding: 0;">
        <div style="position: fixed; top: 0; left: 0; right: 0; height: 50px; margin: 0; padding: 0;"></div>
        <div style="height: 180px; margin: 0; padding: 0;"></div>
        <div style="height: 180px; margin: 0; padding: 0;"></div>
      </div>
    `;
    layout = new FragmentainerLayout(template.content, {
      constraintSpace: pageConstraint(400),
    });
    const flow = await layout.flow();

    // Without fixed handling: 180 + 180 = 360 fits in 400 → 1 page
    // With fixed handling: 400 - 50 = 350 available, 360 > 350 → 2 pages
    expect(flow.fragmentainerCount).toBe(2);
  });

  it("fixed header repeats in rendered output on every page", async () => {
    const template = document.createElement("template");
    template.innerHTML = `
      <div style="margin: 0; padding: 0;">
        <div style="position: fixed; top: 0; left: 0; right: 0; height: 50px; margin: 0; padding: 0;" class="fixed-header"></div>
        <div style="height: 200px; margin: 0; padding: 0;"></div>
        <div style="height: 200px; margin: 0; padding: 0;"></div>
      </div>
    `;
    layout = new FragmentainerLayout(template.content, {
      constraintSpace: pageConstraint(400),
    });
    const flow = await layout.flow();

    expect(flow.fragmentainerCount).toBeGreaterThan(1);

    // Each rendered page should contain a clone of the fixed header
    const elements = flow.render();
    for (const el of elements) {
      document.body.appendChild(el);
      const headerClone = el.shadowRoot.querySelector(".fixed-header");
      expect(headerClone).not.toBeNull();
      el.remove();
    }
  });

  it("fixed footer positioned at bottom of each page", async () => {
    const template = document.createElement("template");
    template.innerHTML = `
      <div style="margin: 0; padding: 0;">
        <div style="position: fixed; bottom: 0; left: 0; right: 0; height: 50px; margin: 0; padding: 0;" class="fixed-footer"></div>
        <div style="height: 200px; margin: 0; padding: 0;"></div>
        <div style="height: 200px; margin: 0; padding: 0;"></div>
      </div>
    `;
    layout = new FragmentainerLayout(template.content, {
      constraintSpace: pageConstraint(400),
    });
    const flow = await layout.flow();

    expect(flow.fragmentainerCount).toBeGreaterThan(1);

    const elements = flow.render();
    for (const el of elements) {
      document.body.appendChild(el);
      const footerClone = el.shadowRoot.querySelector(".fixed-footer");
      expect(footerClone).not.toBeNull();
      expect(footerClone.style.bottom).toBe("0px");
      el.remove();
    }
  });

  it("header and footer both repeat on every page", async () => {
    const template = document.createElement("template");
    template.innerHTML = `
      <div style="margin: 0; padding: 0;">
        <div style="position: fixed; top: 0; left: 0; right: 0; height: 40px; margin: 0; padding: 0;" class="header"></div>
        <div style="position: fixed; bottom: 0; left: 0; right: 0; height: 40px; margin: 0; padding: 0;" class="footer"></div>
        <div style="height: 200px; margin: 0; padding: 0;"></div>
        <div style="height: 200px; margin: 0; padding: 0;"></div>
      </div>
    `;
    layout = new FragmentainerLayout(template.content, {
      constraintSpace: pageConstraint(400),
    });
    const flow = await layout.flow();

    // 400 - 40 - 40 = 320 available, 400 total → 2 pages
    expect(flow.fragmentainerCount).toBe(2);

    const elements = flow.render();
    for (const el of elements) {
      document.body.appendChild(el);
      expect(el.shadowRoot.querySelector(".header")).not.toBeNull();
      expect(el.shadowRoot.querySelector(".footer")).not.toBeNull();
      el.remove();
    }
  });

  it("content fits on one page when fixed elements leave enough room", async () => {
    const template = document.createElement("template");
    template.innerHTML = `
      <div style="margin: 0; padding: 0;">
        <div style="position: fixed; top: 0; left: 0; right: 0; height: 20px; margin: 0; padding: 0;"></div>
        <div style="height: 50px; margin: 0; padding: 0;"></div>
      </div>
    `;
    layout = new FragmentainerLayout(template.content, {
      constraintSpace: pageConstraint(400),
    });
    const flow = await layout.flow();

    expect(flow.fragmentainerCount).toBe(1);
  });
});
