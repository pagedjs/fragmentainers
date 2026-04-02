import { describe, it, expect, afterEach } from "vitest";
import { FragmentainerLayout } from "../../src/core/fragmentainer-layout.js";
import { ConstraintSpace } from "../../src/core/constraint-space.js";
import { FRAGMENTATION_PAGE } from "../../src/core/constants.js";

let layout;

afterEach(() => {
  layout?.destroy();
});

function pageConstraint(height = 200) {
  return new ConstraintSpace({
    availableInlineSize: 400,
    availableBlockSize: height,
    fragmentainerBlockSize: height,
    fragmentationType: FRAGMENTATION_PAGE,
  });
}

describe("Repeating table headers (browser)", () => {
  it("repeats thead in each fragment after the first", async () => {
    const template = document.createElement("template");
    template.innerHTML = `
      <table style="border-collapse: collapse; margin: 0; padding: 0;">
        <thead><tr><th style="height: 30px; margin: 0; padding: 0;">Header</th></tr></thead>
        <tbody>
          <tr><td style="height: 80px; margin: 0; padding: 0;">Row 1</td></tr>
          <tr><td style="height: 80px; margin: 0; padding: 0;">Row 2</td></tr>
          <tr><td style="height: 80px; margin: 0; padding: 0;">Row 3</td></tr>
          <tr><td style="height: 80px; margin: 0; padding: 0;">Row 4</td></tr>
        </tbody>
      </table>
    `;
    layout = new FragmentainerLayout(template.content, {
      constraintSpace: pageConstraint(200),
    });
    const flow = await layout.flow();

    expect(flow.fragmentainerCount).toBeGreaterThan(1);

    const fragments = flow.fragments;
    for (let i = 1; i < fragments.length; i++) {
      const tableFragment = fragments[i].childFragments[0];
      expect(tableFragment).toBeDefined();
      const firstChild = tableFragment.childFragments[0];
      expect(firstChild.isRepeated).toBe(true);
    }
  });

  it("does not repeat thead when table fits on one page", async () => {
    const template = document.createElement("template");
    template.innerHTML = `
      <table style="border-collapse: collapse; margin: 0; padding: 0;">
        <thead><tr><th style="height: 30px; margin: 0; padding: 0;">Header</th></tr></thead>
        <tbody>
          <tr><td style="height: 40px; margin: 0; padding: 0;">Row 1</td></tr>
        </tbody>
      </table>
    `;
    layout = new FragmentainerLayout(template.content, {
      constraintSpace: pageConstraint(200),
    });
    const flow = await layout.flow();

    expect(flow.fragmentainerCount).toBe(1);
    const tableFragment = flow.fragments[0].childFragments[0];
    for (const child of tableFragment.childFragments) {
      expect(child.isRepeated).toBe(false);
    }
  });

  it("repeated header uses measured DOM height for accurate space accounting", async () => {
    // Use cell padding to create a discrepancy between layout-computed
    // and browser-measured height. Layout computes text content only;
    // measured includes padding.
    const template = document.createElement("template");
    template.innerHTML = `
      <table style="border-collapse: collapse; margin: 0; padding: 0;">
        <thead>
          <tr><th style="font-size: 10px; line-height: 10px; padding: 8px 0; margin: 0;">Header</th></tr>
        </thead>
        <tbody>
          <tr><td style="height: 80px; margin: 0; padding: 0;">Row 1</td></tr>
          <tr><td style="height: 80px; margin: 0; padding: 0;">Row 2</td></tr>
          <tr><td style="height: 80px; margin: 0; padding: 0;">Row 3</td></tr>
        </tbody>
      </table>
    `;
    layout = new FragmentainerLayout(template.content, {
      constraintSpace: pageConstraint(200),
    });
    const flow = await layout.flow();

    expect(flow.fragmentainerCount).toBeGreaterThan(1);

    // The repeated header's blockSize should be the DOM-measured height
    // (content + padding), not just the text content height.
    const page2 = flow.fragments[1];
    const tableFragment = page2.childFragments[0];
    const repeated = tableFragment.childFragments[0];
    expect(repeated.isRepeated).toBe(true);
    // With 8px top + 8px bottom padding on a 10px line, measured ~26px.
    // Layout-only would return ~10px. Verify measured height was used.
    expect(repeated.blockSize).toBeGreaterThan(10);
  });

  it("repeated header reduces available space for body content", async () => {
    const template = document.createElement("template");
    template.innerHTML = `
      <table style="border-collapse: collapse; margin: 0; padding: 0;">
        <thead><tr><th style="height: 50px; margin: 0; padding: 0;">Header</th></tr></thead>
        <tbody>
          <tr><td style="height: 100px; margin: 0; padding: 0;">Row 1</td></tr>
          <tr><td style="height: 100px; margin: 0; padding: 0;">Row 2</td></tr>
          <tr><td style="height: 100px; margin: 0; padding: 0;">Row 3</td></tr>
        </tbody>
      </table>
    `;
    layout = new FragmentainerLayout(template.content, {
      constraintSpace: pageConstraint(200),
    });
    const flow = await layout.flow();

    const fragments = flow.fragments;
    for (let i = 1; i < fragments.length; i++) {
      const tableFragment = fragments[i].childFragments[0];
      const repeated = tableFragment.childFragments[0];
      expect(repeated.isRepeated).toBe(true);
      expect(repeated.blockSize).toBeGreaterThan(0);
    }
  });

  it("hasSeenAllChildren is correct across multi-page table with repeated header", async () => {
    const template = document.createElement("template");
    template.innerHTML = `
      <table style="border-collapse: collapse; margin: 0; padding: 0;">
        <thead><tr><th style="height: 20px; margin: 0; padding: 0;">Header</th></tr></thead>
        <tbody>
          <tr><td style="height: 60px; margin: 0; padding: 0;">Row 1</td></tr>
          <tr><td style="height: 60px; margin: 0; padding: 0;">Row 2</td></tr>
          <tr><td style="height: 60px; margin: 0; padding: 0;">Row 3</td></tr>
        </tbody>
      </table>
    `;
    layout = new FragmentainerLayout(template.content, {
      constraintSpace: pageConstraint(100),
    });
    const flow = await layout.flow();

    // Table should break across multiple pages and eventually complete
    expect(flow.fragmentainerCount).toBeGreaterThan(1);

    // Last fragment should have no break token (table completed)
    const lastFragment = flow.fragments[flow.fragments.length - 1];
    expect(lastFragment.breakToken).toBeNull();

    // Middle fragments should have break tokens (table continues)
    for (let i = 0; i < flow.fragments.length - 1; i++) {
      expect(flow.fragments[i].breakToken).not.toBeNull();
    }
  });
});

describe("break-inside: avoid push for tables (browser)", () => {
  it("pushes a break-inside:avoid table when it does not fit at page bottom", async () => {
    const template = document.createElement("template");
    template.innerHTML = `
      <div style="margin: 0; padding: 0;">
        <div style="height: 160px; margin: 0; padding: 0;">Filler</div>
        <table style="break-inside: avoid; border-collapse: collapse; margin: 0; padding: 0;">
          <tr><td style="height: 60px; margin: 0; padding: 0;">Row 1</td></tr>
          <tr><td style="height: 60px; margin: 0; padding: 0;">Row 2</td></tr>
        </table>
      </div>
    `;
    layout = new FragmentainerLayout(template.content, {
      constraintSpace: pageConstraint(200),
    });
    const flow = await layout.flow();

    expect(flow.fragmentainerCount).toBe(2);

    // Page 1: only the filler div, table pushed
    const page1 = flow.fragments[0];
    expect(page1.childFragments[0].childFragments.length).toBe(1);

    // Page 2: the table appears here
    const page2 = flow.fragments[1];
    const wrapper = page2.childFragments[0];
    const tableFragment = wrapper.childFragments[0];
    expect(tableFragment.node.isTable).toBe(true);
  });

  it("does not push when break-inside:avoid table fits in remaining space", async () => {
    const template = document.createElement("template");
    template.innerHTML = `
      <div style="margin: 0; padding: 0;">
        <div style="height: 50px; margin: 0; padding: 0;">Filler</div>
        <table style="break-inside: avoid; border-collapse: collapse; margin: 0; padding: 0;">
          <tr><td style="height: 40px; margin: 0; padding: 0;">Row 1</td></tr>
        </table>
      </div>
    `;
    layout = new FragmentainerLayout(template.content, {
      constraintSpace: pageConstraint(200),
    });
    const flow = await layout.flow();

    // Should fit on one page
    expect(flow.fragmentainerCount).toBe(1);
  });
});
