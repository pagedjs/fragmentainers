import { test, expect } from "../browser-fixture.js";

test.describe("Phase 4: Monolithic content", () => {
  test("pushes a monolithic element to the next page when it does not fit", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createFragments } = await import("/src/core/layout-request.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
        <img style="height:300px;width:100px;display:block;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);
      const pages = createFragments(root, new ConstraintSpace({
        availableInlineSize: 600,
        availableBlockSize: 200,
        fragmentainerBlockSize: 200,
        fragmentationType: "page",
      }));

      const out = {
        p0ChildCount: pages[0].childFragments.length,
        p0BlockSize: pages[0].blockSize,
        p0HasBreakToken: !!pages[0].breakToken,
        p0BreakBefore: pages[0].breakToken?.childBreakTokens[0]?.isBreakBefore ?? false,
        p1ChildCount: pages[1].childFragments.length,
        p1Child0BlockSize: pages[1].childFragments[0].blockSize,
        pagesAtLeast3: pages.length >= 3,
      };

      container.remove();
      return out;
    });

    // Page 1: just the div (img pushed)
    expect(result.p0ChildCount).toBe(1);
    expect(result.p0BlockSize).toBe(50);
    expect(result.p0HasBreakToken).toBe(true);
    expect(result.p0BreakBefore).toBe(true);

    // Page 2: img sliced to 200px (last resort: monolithic exceeds page)
    expect(result.p1ChildCount).toBe(1);
    expect(result.p1Child0BlockSize).toBe(200);

    // Page 3: remaining 100px of img + after (50px)
    expect(result.pagesAtLeast3).toBe(true);
  });

  test("slices monolithic at page boundary when it exceeds the page", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createFragments } = await import("/src/core/layout-request.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      container.innerHTML = `<div style="margin:0;padding:0">
        <img style="height:500px;width:100px;display:block;margin:0;padding:0">
      </div>`;
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);
      const pages = createFragments(root, new ConstraintSpace({
        availableInlineSize: 600,
        availableBlockSize: 200,
        fragmentainerBlockSize: 200,
        fragmentationType: "page",
      }));

      const out = {
        pageCount: pages.length,
        p0Child0BlockSize: pages[0].childFragments[0].blockSize,
        p1Child0BlockSize: pages[1].childFragments[0].blockSize,
        p2Child0BlockSize: pages[2].childFragments[0].blockSize,
      };

      container.remove();
      return out;
    });

    expect(result.pageCount).toBe(3);
    expect(result.p0Child0BlockSize).toBe(200);
    expect(result.p1Child0BlockSize).toBe(200);
    expect(result.p2Child0BlockSize).toBe(100);
  });

  test("monolithic elements produce break tokens when sliced in page mode", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createFragments } = await import("/src/core/layout-request.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      container.innerHTML = `<div style="margin:0;padding:0">
        <img style="height:500px;width:100px;display:block;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);
      const pages = createFragments(root, new ConstraintSpace({
        availableInlineSize: 600,
        availableBlockSize: 200,
        fragmentainerBlockSize: 200,
        fragmentationType: "page",
      }));

      const out = {
        p0Child0HasBreakToken: !!pages[0].childFragments[0].breakToken,
        p0Child0ConsumedBlockSize: pages[0].childFragments[0].breakToken?.consumedBlockSize ?? null,
      };

      container.remove();
      return out;
    });

    expect(result.p0Child0HasBreakToken).toBe(true);
    expect(result.p0Child0ConsumedBlockSize).toBe(200);
  });

  test("pushes scrollable monolithic then slices if exceeds page", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createFragments } = await import("/src/core/layout-request.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:200px;overflow-y:scroll;margin:0;padding:0"></div>
      </div>`;
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);
      const pages = createFragments(root, new ConstraintSpace({
        availableInlineSize: 600,
        availableBlockSize: 150,
        fragmentainerBlockSize: 150,
        fragmentationType: "page",
      }));

      const out = {
        p0ChildCount: pages[0].childFragments.length,
        p1Child0BlockSize: pages[1].childFragments[0].blockSize,
        pagesAtLeast3: pages.length >= 3,
      };

      container.remove();
      return out;
    });

    expect(result.p0ChildCount).toBe(1); // just header
    expect(result.p1Child0BlockSize).toBe(150); // scroller sliced
    expect(result.pagesAtLeast3).toBe(true); // remaining scroller on page 3
  });

  test("monolithic element that fits is placed normally", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createFragments } = await import("/src/core/layout-request.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      container.innerHTML = `<div style="margin:0;padding:0">
        <img style="height:100px;width:100px;display:block;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);
      const pages = createFragments(root, new ConstraintSpace({
        availableInlineSize: 600,
        availableBlockSize: 200,
        fragmentainerBlockSize: 200,
        fragmentationType: "page",
      }));

      const out = {
        pageCount: pages.length,
        p0ChildCount: pages[0].childFragments.length,
      };

      container.remove();
      return out;
    });

    expect(result.pageCount).toBe(1);
    expect(result.p0ChildCount).toBe(2);
  });
});
