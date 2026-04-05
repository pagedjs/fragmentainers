import { test, expect } from "../browser-fixture.js";

test.describe("Phase 7: Break scoring & two-pass layout", () => {
	test("respects break-after: avoid by choosing an earlier break", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="break-after:avoid;height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

			const r = {
				length: pages.length,
				p0Children: pages[0].childFragments.length,
				p0BlockSize: pages[0].blockSize,
				p1Children: pages[1].childFragments.length,
			};
			container.remove();
			return r;
		});

		expect(result.length).toBe(2);
		expect(result.p0Children).toBe(1);
		expect(result.p0BlockSize).toBe(100);
		expect(result.p1Children).toBe(2);
	});

	test("respects break-before: avoid on the next sibling", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="break-before:avoid;height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

			const r = {
				length: pages.length,
				p0Children: pages[0].childFragments.length,
				p0BlockSize: pages[0].blockSize,
				p1Children: pages[1].childFragments.length,
			};
			container.remove();
			return r;
		});

		expect(result.length).toBe(2);
		expect(result.p0Children).toBe(1);
		expect(result.p0BlockSize).toBe(100);
		expect(result.p1Children).toBe(2);
	});

	test("break-inside: avoid on parent degrades all interior breaks", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
        <div style="break-inside:avoid;margin:0;padding:0">
          <div style="height:100px;margin:0;padding:0"></div>
          <div style="height:100px;margin:0;padding:0"></div>
        </div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 120,
					fragmentainerBlockSize: 120,
					fragmentationType: "page",
				}),
			);

			const r = { length: pages.length };
			container.remove();
			return r;
		});

		expect(result.length >= 2).toBeTruthy();
	});

	test("falls back to normal break when no better alternative exists", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="break-after:avoid;height:100px;margin:0;padding:0"></div>
        <div style="break-after:avoid;height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

			const r = {
				length: pages.length,
				p0ChildrenGte1: pages[0].childFragments.length >= 1,
			};
			container.remove();
			return r;
		});

		expect(result.length).toBe(2);
		expect(result.p0ChildrenGte1).toBeTruthy();
	});

	test("perfect break is not overridden by two-pass", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

			const r = {
				length: pages.length,
				p0Children: pages[0].childFragments.length,
			};
			container.remove();
			return r;
		});

		expect(result.length).toBe(2);
		expect(result.p0Children).toBe(2);
	});
});
