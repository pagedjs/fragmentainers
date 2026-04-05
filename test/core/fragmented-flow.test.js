import { test, expect } from "../browser-fixture.js";

test.describe("FragmentationContext", () => {
  test("exposes fragments array", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentationContext } = await import("/src/core/fragmentation-context.js");
      const { PhysicalFragment } = await import("/src/core/fragment.js");
      const { BlockBreakToken } = await import("/src/core/tokens.js");

      function makeFragments(count) {
        const fragments = [];
        for (let i = 0; i < count; i++) {
          const node = document.createElement("div");
          const frag = new PhysicalFragment(node, 200, []);
          frag.constraints = {
            contentArea: { inlineSize: 816, blockSize: 1056 },
          };
          if (i < count - 1) {
            const bt = new BlockBreakToken(node);
            bt.consumedBlockSize = (i + 1) * 200;
            frag.breakToken = bt;
          }
          fragments.push(frag);
        }
        return fragments;
      }

      const fragments = makeFragments(3);
      const flow = new FragmentationContext(fragments, null);
      return { same: flow.fragments === fragments, length: flow.fragments.length };
    });

    expect(result.same).toBe(true);
    expect(result.length).toBe(3);
  });

  test("reports correct fragmentainerCount", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentationContext } = await import("/src/core/fragmentation-context.js");
      const { PhysicalFragment } = await import("/src/core/fragment.js");
      const { BlockBreakToken } = await import("/src/core/tokens.js");

      function makeFragments(count) {
        const fragments = [];
        for (let i = 0; i < count; i++) {
          const node = document.createElement("div");
          const frag = new PhysicalFragment(node, 200, []);
          frag.constraints = {
            contentArea: { inlineSize: 816, blockSize: 1056 },
          };
          if (i < count - 1) {
            const bt = new BlockBreakToken(node);
            bt.consumedBlockSize = (i + 1) * 200;
            frag.breakToken = bt;
          }
          fragments.push(frag);
        }
        return fragments;
      }

      const flow = new FragmentationContext(makeFragments(5), null);
      return flow.fragmentainerCount;
    });

    expect(result).toBe(5);
  });

  test("reports zero fragmentainerCount for empty array", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentationContext } = await import("/src/core/fragmentation-context.js");
      const flow = new FragmentationContext([], null);
      return flow.fragmentainerCount;
    });

    expect(result).toBe(0);
  });

  test("skips element creation when contentStyles is null", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentationContext } = await import("/src/core/fragmentation-context.js");
      const { PhysicalFragment } = await import("/src/core/fragment.js");
      const { BlockBreakToken } = await import("/src/core/tokens.js");

      function makeFragments(count) {
        const fragments = [];
        for (let i = 0; i < count; i++) {
          const node = document.createElement("div");
          const frag = new PhysicalFragment(node, 200, []);
          frag.constraints = {
            contentArea: { inlineSize: 816, blockSize: 1056 },
          };
          if (i < count - 1) {
            const bt = new BlockBreakToken(node);
            bt.consumedBlockSize = (i + 1) * 200;
            frag.breakToken = bt;
          }
          fragments.push(frag);
        }
        return fragments;
      }

      const flow = new FragmentationContext(makeFragments(3), null);
      return {
        length: flow.length,
        fragmentainerCount: flow.fragmentainerCount,
        fragmentsLength: flow.fragments.length,
      };
    });

    expect(result.length).toBe(0);
    expect(result.fragmentainerCount).toBe(3);
    expect(result.fragmentsLength).toBe(3);
  });

  test("Symbol.species returns Array", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentationContext } = await import("/src/core/fragmentation-context.js");
      const { PhysicalFragment } = await import("/src/core/fragment.js");
      const { BlockBreakToken } = await import("/src/core/tokens.js");

      function makeFragments(count) {
        const fragments = [];
        for (let i = 0; i < count; i++) {
          const node = document.createElement("div");
          const frag = new PhysicalFragment(node, 200, []);
          frag.constraints = {
            contentArea: { inlineSize: 816, blockSize: 1056 },
          };
          if (i < count - 1) {
            const bt = new BlockBreakToken(node);
            bt.consumedBlockSize = (i + 1) * 200;
            frag.breakToken = bt;
          }
          fragments.push(frag);
        }
        return fragments;
      }

      const flow = new FragmentationContext(makeFragments(2), null);
      const mapped = flow.map((el) => el?.tagName || "none");
      const isArray = Array.isArray(mapped);
      const isNotFragmentationContext = !(mapped instanceof FragmentationContext);
      return { isArray, isNotFragmentationContext };
    });

    expect(result.isArray).toBe(true);
    expect(result.isNotFragmentationContext).toBe(true);
  });
});

test.describe("FragmentedFlow iterator", () => {
  test("iterates fragments when content overflows", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
      await import("/src/dom/fragment-container.js");

      const template = document.createElement("template");
      template.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:300px;margin:0;padding:0"></div>
        <div style="height:300px;margin:0;padding:0"></div>
      </div>`;

      const layout = new FragmentedFlow(template.content, { width: 600, height: 400 });
      const flow = layout.flow();
      const fragments = flow.fragments;

      const r = {
        lengthGte2: fragments.length >= 2,
        firstBlockSizeGt0: fragments[0].blockSize > 0,
        firstBreakTokenNotNull: fragments[0].breakToken !== null,
      };
      layout.destroy();
      return r;
    });

    expect(result.lengthGte2).toBe(true);
    expect(result.firstBlockSizeGt0).toBe(true);
    expect(result.firstBreakTokenNotNull).toBe(true);
  });

  test("last fragment has null breakToken", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
      await import("/src/dom/fragment-container.js");

      const template = document.createElement("template");
      template.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:300px;margin:0;padding:0"></div>
        <div style="height:300px;margin:0;padding:0"></div>
      </div>`;

      const layout = new FragmentedFlow(template.content, { width: 600, height: 400 });
      const flow = layout.flow();
      const fragments = flow.fragments;
      const last = fragments[fragments.length - 1];
      const r = { lastBreakTokenNull: last.breakToken === null };
      layout.destroy();
      return r;
    });

    expect(result.lastBreakTokenNull).toBe(true);
  });

  test("for-of loop collects all elements", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
      await import("/src/dom/fragment-container.js");

      const template = document.createElement("template");
      template.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
      </div>`;

      const layout = new FragmentedFlow(template.content, { width: 600, height: 300 });
      const elements = [];
      for (const el of layout) {
        elements.push(el.tagName);
      }
      layout.destroy();
      return { lengthGte2: elements.length >= 2 };
    });

    expect(result.lengthGte2).toBe(true);
  });

  test("next() returns done:true after exhaustion", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
      await import("/src/dom/fragment-container.js");

      const template = document.createElement("template");
      template.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;

      const layout = new FragmentedFlow(template.content, { width: 600, height: 300 });
      const r1 = layout.next();
      const r1Done = r1.done;
      const r1HasValue = r1.value !== undefined;

      const r2 = layout.next();
      const r2Done = r2.done;
      const r2ValueUndefined = r2.value === undefined;

      layout.destroy();
      return { r1Done, r1HasValue, r2Done, r2ValueUndefined };
    });

    expect(result.r1Done).toBe(false);
    expect(result.r1HasValue).toBe(true);
    expect(result.r2Done).toBe(true);
    expect(result.r2ValueUndefined).toBe(true);
  });

  test("stopping early via break leaves content unfinished", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
      await import("/src/dom/fragment-container.js");

      const template = document.createElement("template");
      template.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
      </div>`;

      const layout = new FragmentedFlow(template.content, { width: 600, height: 250 });
      const r = layout.next();
      // Don't call destroy — layout was only partially consumed (no flow() call)
      return { done: r.done };
    });

    expect(result.done).toBe(false);
  });
});

test.describe("FragmentedFlow.flow() (browser)", () => {
  test("fragments simple content across multiple fragmentainers", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
      const { FragmentationContext } = await import("/src/core/fragmentation-context.js");
      await import("/src/dom/fragment-container.js");

      const template = document.createElement("template");
      template.innerHTML =
        '<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>';
      const layout = new FragmentedFlow(template.content, {
        width: 400,
        height: 100,
      });
      const flow = layout.flow();
      const r = {
        isFragmentationContext: flow instanceof FragmentationContext,
        fragmentainerCountGte2: flow.fragmentainerCount >= 2,
        lengthMatchesCount: flow.length === flow.fragmentainerCount,
      };
      layout.destroy();
      return r;
    });

    expect(result.isFragmentationContext).toBe(true);
    expect(result.fragmentainerCountGte2).toBe(true);
    expect(result.lengthMatchesCount).toBe(true);
  });

  test("flow() with start/stop creates a subset of elements", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
      await import("/src/dom/fragment-container.js");

      const template = document.createElement("template");
      template.innerHTML =
        '<div style="margin:0; padding:0;"><div style="height: 400px; margin: 0;"></div></div>';
      const layout = new FragmentedFlow(template.content, {
        width: 400,
        height: 100,
      });
      const flow = layout.flow({ start: 1, stop: 3 });
      const r = {
        fragmentainerCountGte4: flow.fragmentainerCount >= 4,
        length: flow.length,
        firstIndex: flow[0].fragmentIndex,
        secondIndex: flow[1].fragmentIndex,
      };
      layout.destroy();
      return r;
    });

    expect(result.fragmentainerCountGte4).toBe(true);
    expect(result.length).toBe(2);
    expect(result.firstIndex).toBe(1);
    expect(result.secondIndex).toBe(2);
  });

  test("is directly iterable as an array of elements", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
      await import("/src/dom/fragment-container.js");

      const template = document.createElement("template");
      template.innerHTML =
        '<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>';
      const layout = new FragmentedFlow(template.content, {
        width: 400,
        height: 100,
      });
      const flow = layout.flow();
      const tags = [];
      for (const el of flow) {
        tags.push(el.tagName.toLowerCase());
      }
      layout.destroy();
      return { lengthGte2: flow.length >= 2, tags };
    });

    expect(result.lengthGte2).toBe(true);
    for (const tag of result.tags) {
      expect(tag).toBe("fragment-container");
    }
  });

  test("supports index access", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
      await import("/src/dom/fragment-container.js");

      const template = document.createElement("template");
      template.innerHTML =
        '<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>';
      const layout = new FragmentedFlow(template.content, {
        width: 400,
        height: 100,
      });
      const flow = layout.flow();
      const r = {
        tagName: flow[0].tagName.toLowerCase(),
        fragmentIndex: flow[0].fragmentIndex,
      };
      layout.destroy();
      return r;
    });

    expect(result.tagName).toBe("fragment-container");
    expect(result.fragmentIndex).toBe(0);
  });

  test("produces a single fragmentainer when content fits", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
      await import("/src/dom/fragment-container.js");

      const template = document.createElement("template");
      template.innerHTML =
        '<div style="margin:0; padding:0;"><div style="height: 50px; margin: 0;"></div></div>';
      const layout = new FragmentedFlow(template.content, {
        width: 400,
        height: 800,
      });
      const flow = layout.flow();
      const r = { fragmentainerCount: flow.fragmentainerCount };
      layout.destroy();
      return r;
    });

    expect(result.fragmentainerCount).toBe(1);
  });

  test("fragments text content across multiple pages", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
      await import("/src/dom/fragment-container.js");

      const template = document.createElement("template");
      template.innerHTML = `<div style="width: 200px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">${"word ".repeat(100)}</div>`;
      const layout = new FragmentedFlow(template.content, {
        width: 200,
        height: 60,
      });
      const flow = layout.flow();
      const r = { fragmentainerCountGt1: flow.fragmentainerCount > 1 };
      layout.destroy();
      return r;
    });

    expect(result.fragmentainerCountGt1).toBe(true);
  });

  test("produces fragments with correct structure", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
      await import("/src/dom/fragment-container.js");

      const template = document.createElement("template");
      template.innerHTML =
        '<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>';
      const layout = new FragmentedFlow(template.content, {
        width: 400,
        height: 100,
      });
      const flow = layout.flow();
      const fragments = flow.fragments;

      const first = fragments[0];
      const last = fragments[fragments.length - 1];
      const r = {
        lengthGte2: fragments.length >= 2,
        firstHasChildFragments: first.childFragments !== undefined,
        firstBlockSizeGt0: first.blockSize > 0,
        firstBreakTokenNotNull: first.breakToken !== null,
        lastBreakTokenNull: last.breakToken === null,
      };
      layout.destroy();
      return r;
    });

    expect(result.lengthGte2).toBe(true);
    expect(result.firstHasChildFragments).toBe(true);
    expect(result.firstBlockSizeGt0).toBe(true);
    expect(result.firstBreakTokenNotNull).toBe(true);
    expect(result.lastBreakTokenNull).toBe(true);
  });

  test("adds loading=lazy to images with width and height", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
      await import("/src/dom/fragment-container.js");

      const template = document.createElement("template");
      template.innerHTML = `<div style="margin:0; padding:0;">
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="100" height="100">
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="200" height="150">
      </div>`;
      const layout = new FragmentedFlow(template.content, {
        width: 400,
        height: 800,
      });
      const root = layout.contentRoot;
      const imgs = root.querySelectorAll("img");
      const loadingAttrs = Array.from(imgs).map((img) => img.getAttribute("loading"));
      layout.destroy();
      return { loadingAttrs };
    });

    for (const attr of result.loadingAttrs) {
      expect(attr).toBe("lazy");
    }
  });

  test("does not add loading=lazy to images missing width or height", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
      await import("/src/dom/fragment-container.js");

      const template = document.createElement("template");
      template.innerHTML = `<div style="margin:0; padding:0;">
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="100">
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" height="100">
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
      </div>`;
      const layout = new FragmentedFlow(template.content, {
        width: 400,
        height: 800,
      });
      const root = layout.contentRoot;
      const imgs = root.querySelectorAll("img");
      const hasLoading = Array.from(imgs).map((img) => img.hasAttribute("loading"));
      layout.destroy();
      return { hasLoading };
    });

    for (const has of result.hasLoading) {
      expect(has).toBe(false);
    }
  });

  test("does not wait for lazy-loaded images during setup", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
      await import("/src/dom/fragment-container.js");

      const template = document.createElement("template");
      template.innerHTML = `<div style="margin:0; padding:0;">
        <img src="http://192.0.2.1/hang.png" width="100" height="100">
        <div style="height: 50px; margin: 0;"></div>
      </div>`;
      const layout = new FragmentedFlow(template.content, {
        width: 400,
        height: 800,
      });
      const flow = layout.flow();
      const r = { fragmentainerCountGte1: flow.fragmentainerCount >= 1 };
      layout.destroy();
      return r;
    });

    expect(result.fragmentainerCountGte1).toBe(true);
  });

  test("accepts an Element and clones it into a DocumentFragment", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
      await import("/src/dom/fragment-container.js");

      const container = document.createElement("div");
      container.innerHTML =
        '<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>';
      document.body.appendChild(container);
      const el = container.firstElementChild;

      const layout = new FragmentedFlow(el, {
        width: 400,
        height: 100,
      });
      const flow = layout.flow();
      const fragmentainerCountGte2 = flow.fragmentainerCount >= 2;
      const originalStillInDom = container.firstElementChild === el;

      layout.destroy();
      container.remove();
      return { fragmentainerCountGte2, originalStillInDom };
    });

    expect(result.fragmentainerCountGte2).toBe(true);
    expect(result.originalStillInDom).toBe(true);
  });
});

test.describe("namedPage property", () => {
  test("fragment-container has a namedPage property", async ({ page }) => {
    const result = await page.evaluate(async () => {
      await import("/src/dom/fragment-container.js");

      const el = document.createElement("fragment-container");
      const initialNull = el.namedPage === null;
      el.namedPage = "chapter";
      const afterSet = el.namedPage;
      el.namedPage = null;
      const afterReset = el.namedPage;
      return { initialNull, afterSet, afterReset };
    });

    expect(result.initialNull).toBe(true);
    expect(result.afterSet).toBe("chapter");
    expect(result.afterReset).toBeNull();
  });

  test("sets namedPage property from fragment constraints", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FragmentationContext } = await import("/src/core/fragmentation-context.js");
      await import("/src/dom/fragment-container.js");

      const size = { inlineSize: 400, blockSize: 800 };
      const contentStyles = {
        sheets: [],
        nthDescriptors: [],
        sourceRefs: null,
        refMap: null,
      };
      const fragments = [
        {
          node: null,
          blockSize: 0,
          childFragments: [],
          breakToken: null,
          isBlank: false,
          constraints: { contentArea: size, namedPage: "cover" },
          counterState: null,
        },
        {
          node: null,
          blockSize: 0,
          childFragments: [],
          breakToken: null,
          isBlank: false,
          constraints: { contentArea: size, namedPage: "chapter" },
          counterState: null,
        },
        {
          node: null,
          blockSize: 0,
          childFragments: [],
          breakToken: null,
          isBlank: false,
          constraints: { contentArea: size, namedPage: null },
          counterState: null,
        },
      ];

      const flow = new FragmentationContext(fragments, contentStyles);
      const namedPages = [];
      for (let i = 0; i < fragments.length; i++) {
        const el = flow.createFragmentainer(i);
        namedPages.push(el.namedPage);
      }
      return { namedPages };
    });

    expect(result.namedPages[0]).toBe("cover");
    expect(result.namedPages[1]).toBe("chapter");
    expect(result.namedPages[2]).toBeNull();
  });
});
