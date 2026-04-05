import { test, expect } from "../browser-fixture.js";

test.describe("Phase 8: Forced breaks", () => {
	test("break-before: page forces a page break", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
        <div style="height:50px;break-before:page;margin:0;padding:0"></div>
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 1000,
					fragmentainerBlockSize: 1000,
					fragmentationType: "page",
				}),
			);

			const res = {
				pageCount: pages.length,
				page0ChildCount: pages[0].childFragments.length,
				page0BlockSize: pages[0].blockSize,
				page0HasBreakToken: !!pages[0].breakToken,
				page0IsForcedBreak: pages[0].breakToken?.childBreakTokens?.[0]?.isForcedBreak ?? false,
				page1ChildCount: pages[1].childFragments.length,
				page1BlockSize: pages[1].blockSize,
			};

			container.remove();
			return res;
		});

		expect(result.pageCount).toBe(2);
		expect(result.page0ChildCount).toBe(1);
		expect(result.page0BlockSize).toBe(50);
		expect(result.page0HasBreakToken).toBe(true);
		expect(result.page0IsForcedBreak).toBe(true);
		expect(result.page1ChildCount).toBe(2);
		expect(result.page1BlockSize).toBe(100);
	});

	test("break-before: column forces a break", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
        <div style="height:50px;break-before:column;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 1000,
					fragmentainerBlockSize: 1000,
					fragmentationType: "page",
				}),
			);

			const res = { pageCount: pages.length };
			container.remove();
			return res;
		});

		expect(result.pageCount).toBe(2);
	});

	test("break-before: page forces a break (always equivalent)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
        <div style="height:50px;break-before:page;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 1000,
					fragmentainerBlockSize: 1000,
					fragmentationType: "page",
				}),
			);

			const res = { pageCount: pages.length };
			container.remove();
			return res;
		});

		expect(result.pageCount).toBe(2);
	});

	test("break-after: page forces a break after the element", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:50px;break-after:page;margin:0;padding:0"></div>
        <div style="height:50px;margin:0;padding:0"></div>
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 1000,
					fragmentainerBlockSize: 1000,
					fragmentationType: "page",
				}),
			);

			const res = {
				pageCount: pages.length,
				page0ChildCount: pages[0].childFragments.length,
				page0BlockSize: pages[0].blockSize,
				page1ChildCount: pages[1].childFragments.length,
			};

			container.remove();
			return res;
		});

		expect(result.pageCount).toBe(2);
		expect(result.page0ChildCount).toBe(1);
		expect(result.page0BlockSize).toBe(50);
		expect(result.page1ChildCount).toBe(2);
	});

	test("break-before on first child does nothing (already at top)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:50px;break-before:page;margin:0;padding:0"></div>
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 1000,
					fragmentainerBlockSize: 1000,
					fragmentationType: "page",
				}),
			);

			const res = {
				pageCount: pages.length,
				page0ChildCount: pages[0].childFragments.length,
			};

			container.remove();
			return res;
		});

		expect(result.pageCount).toBe(1);
		expect(result.page0ChildCount).toBe(2);
	});

	test("break-after on last child does nothing", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
        <div style="height:50px;break-after:page;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 1000,
					fragmentainerBlockSize: 1000,
					fragmentationType: "page",
				}),
			);

			const res = { pageCount: pages.length };
			container.remove();
			return res;
		});

		expect(result.pageCount).toBe(1);
	});

	test("multiple forced breaks produce multiple pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
        <div style="height:50px;break-before:page;margin:0;padding:0"></div>
        <div style="height:50px;break-before:page;margin:0;padding:0"></div>
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 1000,
					fragmentainerBlockSize: 1000,
					fragmentationType: "page",
				}),
			);

			const res = {
				pageCount: pages.length,
				page0ChildCount: pages[0].childFragments.length,
				page1ChildCount: pages[1].childFragments.length,
				page2ChildCount: pages[2].childFragments.length,
			};

			container.remove();
			return res;
		});

		expect(result.pageCount).toBe(3);
		expect(result.page0ChildCount).toBe(1);
		expect(result.page1ChildCount).toBe(1);
		expect(result.page2ChildCount).toBe(2);
	});

	test("break-before: avoid does not force a break", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
        <div style="height:50px;break-before:avoid;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 1000,
					fragmentainerBlockSize: 1000,
					fragmentationType: "page",
				}),
			);

			const res = { pageCount: pages.length };
			container.remove();
			return res;
		});

		expect(result.pageCount).toBe(1);
	});
});
