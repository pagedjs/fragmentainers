import { test, expect } from "../browser-fixture.js";

test.describe("Phase 2: Block layout (single fragmentainer)", () => {
  test("lays out a single leaf node", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { runLayoutGenerator } = await import("/src/core/layout-request.js");
      const { layoutBlockContainer } = await import("/src/layout/block-container.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      container.innerHTML = "<div style=\"height:50px;margin:0;padding:0\"></div>";
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);
      const space = new ConstraintSpace({
        availableInlineSize: 600,
        availableBlockSize: 800,
        fragmentainerBlockSize: 800,
        fragmentationType: "page",
      });

      const result = runLayoutGenerator(layoutBlockContainer, root, space, null);
      const out = {
        blockSize: result.fragment.blockSize,
        breakToken: result.breakToken,
      };

      container.remove();
      return out;
    });

    expect(result.blockSize).toBe(50);
    expect(result.breakToken).toBe(null);
  });

  test("lays out a root with block children that all fit", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createFragments } = await import("/src/core/layout-request.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      container.innerHTML = `
        <div style="margin:0;padding:0">
          <div style="height:100px;margin:0;padding:0"></div>
          <div style="height:150px;margin:0;padding:0"></div>
          <div style="height:50px;margin:0;padding:0"></div>
        </div>
      `;
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);
      const pages = createFragments(root, new ConstraintSpace({
        availableInlineSize: 600,
        availableBlockSize: 800,
        fragmentainerBlockSize: 800,
        fragmentationType: "page",
      }));

      const out = {
        length: pages.length,
        blockSize: pages[0].blockSize,
        childCount: pages[0].childFragments.length,
        breakToken: pages[0].breakToken,
      };

      container.remove();
      return out;
    });

    expect(result.length).toBe(1);
    expect(result.blockSize).toBe(300);
    expect(result.childCount).toBe(3);
    expect(result.breakToken).toBe(null);
  });

  test("lays out nested block containers", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createFragments } = await import("/src/core/layout-request.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      container.innerHTML = `
        <div style="margin:0;padding:0">
          <div style="margin:0;padding:0">
            <div style="height:50px;margin:0;padding:0"></div>
            <div style="height:75px;margin:0;padding:0"></div>
          </div>
          <div style="height:100px;margin:0;padding:0"></div>
        </div>
      `;
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);
      const pages = createFragments(root, new ConstraintSpace({
        availableInlineSize: 600,
        availableBlockSize: 800,
        fragmentainerBlockSize: 800,
        fragmentationType: "page",
      }));

      const out = {
        length: pages.length,
        blockSize: pages[0].blockSize,
        childCount: pages[0].childFragments.length,
        outerBlockSize: pages[0].childFragments[0].blockSize,
        outerChildCount: pages[0].childFragments[0].childFragments.length,
      };

      container.remove();
      return out;
    });

    expect(result.length).toBe(1);
    expect(result.blockSize).toBe(225);
    expect(result.childCount).toBe(2);
    expect(result.outerBlockSize).toBe(125);
    expect(result.outerChildCount).toBe(2);
  });

  test("sets inlineSize on fragments", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createFragments } = await import("/src/core/layout-request.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      container.innerHTML = `
        <div style="margin:0;padding:0">
          <div style="height:50px;margin:0;padding:0"></div>
        </div>
      `;
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);
      const pages = createFragments(root, new ConstraintSpace({
        availableInlineSize: 600,
        availableBlockSize: 800,
        fragmentainerBlockSize: 800,
        fragmentationType: "page",
      }));

      const out = { inlineSize: pages[0].inlineSize };

      container.remove();
      return out;
    });

    expect(result.inlineSize).toBe(600);
  });
});

test.describe("Phase 3: Block fragmentation across fragmentainers", () => {
  test("splits content across 2 pages", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createFragments } = await import("/src/core/layout-request.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      container.innerHTML = `
        <div style="margin:0;padding:0">
          <div style="height:100px;margin:0;padding:0"></div>
          <div style="height:100px;margin:0;padding:0"></div>
          <div style="height:100px;margin:0;padding:0"></div>
        </div>
      `;
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);
      const pages = createFragments(root, new ConstraintSpace({
        availableInlineSize: 600,
        availableBlockSize: 200,
        fragmentainerBlockSize: 200,
        fragmentationType: "page",
      }));

      const out = {
        length: pages.length,
        p0blockSize: pages[0].blockSize,
        p0childCount: pages[0].childFragments.length,
        p0hasBreakToken: pages[0].breakToken !== null,
        p1blockSize: pages[1].blockSize,
        p1childCount: pages[1].childFragments.length,
        p1breakToken: pages[1].breakToken,
      };

      container.remove();
      return out;
    });

    expect(result.length).toBe(2);
    expect(result.p0blockSize).toBe(200);
    expect(result.p0childCount).toBe(2);
    expect(result.p0hasBreakToken).toBe(true);
    expect(result.p1blockSize).toBe(100);
    expect(result.p1childCount).toBe(1);
    expect(result.p1breakToken).toBe(null);
  });

  test("splits content across 3 pages", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createFragments } = await import("/src/core/layout-request.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      let children = "";
      for (let i = 0; i < 5; i++) {
        children += "<div style=\"height:100px;margin:0;padding:0\"></div>";
      }
      container.innerHTML = `<div style="margin:0;padding:0">${children}</div>`;
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);
      const pages = createFragments(root, new ConstraintSpace({
        availableInlineSize: 600,
        availableBlockSize: 200,
        fragmentainerBlockSize: 200,
        fragmentationType: "page",
      }));

      const out = {
        length: pages.length,
        p0childCount: pages[0].childFragments.length,
        p1childCount: pages[1].childFragments.length,
        p2childCount: pages[2].childFragments.length,
      };

      container.remove();
      return out;
    });

    expect(result.length).toBe(3);
    expect(result.p0childCount).toBe(2);
    expect(result.p1childCount).toBe(2);
    expect(result.p2childCount).toBe(1);
  });

  test("break token has correct consumedBlockSize and sequenceNumber", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createFragments } = await import("/src/core/layout-request.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      container.innerHTML = `
        <div style="margin:0;padding:0">
          <div style="height:100px;margin:0;padding:0"></div>
          <div style="height:100px;margin:0;padding:0"></div>
          <div style="height:100px;margin:0;padding:0"></div>
        </div>
      `;
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);
      const pages = createFragments(root, new ConstraintSpace({
        availableInlineSize: 600,
        availableBlockSize: 200,
        fragmentainerBlockSize: 200,
        fragmentationType: "page",
      }));

      const bt = pages[0].breakToken;
      const out = {
        consumedBlockSize: bt.consumedBlockSize,
        sequenceNumber: bt.sequenceNumber,
      };

      container.remove();
      return out;
    });

    expect(result.consumedBlockSize).toBe(200);
    expect(result.sequenceNumber).toBe(0);
  });

  test("handles nested container breaking mid-child", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createFragments } = await import("/src/core/layout-request.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      container.innerHTML = `
        <div style="margin:0;padding:0">
          <div style="height:50px;margin:0;padding:0"></div>
          <div style="margin:0;padding:0">
            <div style="height:100px;margin:0;padding:0"></div>
            <div style="height:100px;margin:0;padding:0"></div>
          </div>
        </div>
      `;
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);
      const pages = createFragments(root, new ConstraintSpace({
        availableInlineSize: 600,
        availableBlockSize: 120,
        fragmentainerBlockSize: 120,
        fragmentationType: "page",
      }));

      const rootBT = pages[0].breakToken;
      const out = {
        length: pages.length,
        hasRootBT: rootBT !== null && rootBT !== undefined,
        childBreakTokenCount: rootBT ? rootBT.childBreakTokens.length : 0,
      };

      container.remove();
      return out;
    });

    expect(result.length).toBe(3);
    expect(result.hasRootBT).toBe(true);
    expect(result.childBreakTokenCount).toBe(1);
  });

  test("handles the exact-fill edge case (createBreakBefore)", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createFragments } = await import("/src/core/layout-request.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      container.innerHTML = `
        <div style="margin:0;padding:0">
          <div style="height:100px;margin:0;padding:0"></div>
          <div style="height:100px;margin:0;padding:0"></div>
          <div style="height:50px;margin:0;padding:0"></div>
        </div>
      `;
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);
      const pages = createFragments(root, new ConstraintSpace({
        availableInlineSize: 600,
        availableBlockSize: 200,
        fragmentainerBlockSize: 200,
        fragmentationType: "page",
      }));

      const bt = pages[0].breakToken;
      const out = {
        length: pages.length,
        hasBT: bt !== null && bt !== undefined,
        childBreakTokenCount: bt ? bt.childBreakTokens.length : 0,
        isBreakBefore: bt ? bt.childBreakTokens[0].isBreakBefore : false,
        p1blockSize: pages[1].blockSize,
        p1childCount: pages[1].childFragments.length,
      };

      container.remove();
      return out;
    });

    expect(result.length).toBe(2);
    expect(result.hasBT).toBe(true);
    expect(result.childBreakTokenCount).toBe(1);
    expect(result.isBreakBefore).toBe(true);
    expect(result.p1blockSize).toBe(50);
    expect(result.p1childCount).toBe(1);
  });

  test("uses varying fragmentainer sizes", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createFragments } = await import("/src/core/layout-request.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      container.innerHTML = `
        <div style="margin:0;padding:0">
          <div style="height:100px;margin:0;padding:0"></div>
          <div style="height:100px;margin:0;padding:0"></div>
          <div style="height:100px;margin:0;padding:0"></div>
        </div>
      `;
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);

      const sizes = [
        { inlineSize: 600, blockSize: 150 },
        { inlineSize: 600, blockSize: 250 },
      ];

      const pages = createFragments(root, {
        resolve: (index) => {
          const size = sizes[index] || sizes[sizes.length - 1];
          return {
            toConstraintSpace: () => new ConstraintSpace({
              availableInlineSize: size.inlineSize,
              availableBlockSize: size.blockSize,
              fragmentainerBlockSize: size.blockSize,
              fragmentationType: "page",
            }),
          };
        },
      });

      const out = {
        length: pages.length,
        p0childCount: pages[0].childFragments.length,
        p1childCount: pages[1].childFragments.length,
      };

      container.remove();
      return out;
    });

    expect(result.length).toBe(2);
    expect(result.p0childCount).toBe(2);
    expect(result.p1childCount).toBe(2);
  });

  test("last fragmentainer size is reused for subsequent pages", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createFragments } = await import("/src/core/layout-request.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      let children = "";
      for (let i = 0; i < 6; i++) {
        children += "<div style=\"height:100px;margin:0;padding:0\"></div>";
      }
      container.innerHTML = `<div style="margin:0;padding:0">${children}</div>`;
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);
      const pages = createFragments(root, new ConstraintSpace({
        availableInlineSize: 600,
        availableBlockSize: 200,
        fragmentainerBlockSize: 200,
        fragmentationType: "page",
      }));

      const out = { length: pages.length };

      container.remove();
      return out;
    });

    expect(result.length).toBe(3);
  });
});

test.describe("box-decoration-break: clone layout", () => {
  test("includes containerBoxStart in continuation fragment blockOffset", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createFragments } = await import("/src/core/layout-request.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      container.innerHTML = `
        <div style="padding:10px 0;margin:0;box-decoration-break:clone">
          <div style="height:250px;margin:0;padding:0"></div>
        </div>
      `;
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);
      const fragments = createFragments(root, new ConstraintSpace({
        availableInlineSize: 600,
        availableBlockSize: 200,
        fragmentainerBlockSize: 200,
        fragmentationType: "page",
      }));

      const out = {
        length: fragments.length,
        f1blockSize: fragments[1].blockSize,
      };

      container.remove();
      return out;
    });

    expect(result.length).toBe(2);
    expect(result.f1blockSize).toBe(90);
  });

  test("includes containerBoxEnd on non-final fragments with clone", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createFragments } = await import("/src/core/layout-request.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      container.innerHTML = `
        <div style="padding:10px 0;margin:0;box-decoration-break:clone">
          <div style="height:250px;margin:0;padding:0"></div>
        </div>
      `;
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);
      const fragments = createFragments(root, new ConstraintSpace({
        availableInlineSize: 600,
        availableBlockSize: 200,
        fragmentainerBlockSize: 200,
        fragmentationType: "page",
      }));

      const out = {
        length: fragments.length,
        f0blockSize: fragments[0].blockSize,
      };

      container.remove();
      return out;
    });

    expect(result.length).toBe(2);
    expect(result.f0blockSize).toBe(200);
  });

  test("slice mode does NOT include containerBoxStart on continuation", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createFragments } = await import("/src/core/layout-request.js");
      const { ConstraintSpace } = await import("/src/core/constraint-space.js");
      const { buildLayoutTree } = await import("/src/dom/index.js");

      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:-9999px;width:600px";
      container.innerHTML = `
        <div style="padding:10px 0;margin:0;box-decoration-break:slice">
          <div style="height:250px;margin:0;padding:0"></div>
        </div>
      `;
      document.body.appendChild(container);

      const root = buildLayoutTree(container.firstElementChild);
      const fragments = createFragments(root, new ConstraintSpace({
        availableInlineSize: 600,
        availableBlockSize: 200,
        fragmentainerBlockSize: 200,
        fragmentationType: "page",
      }));

      const out = {
        length: fragments.length,
        f0blockSize: fragments[0].blockSize,
        f1blockSize: fragments[1].blockSize,
      };

      container.remove();
      return out;
    });

    expect(result.length).toBe(2);
    expect(result.f0blockSize).toBe(190);
    expect(result.f1blockSize).toBe(80);
  });
});
