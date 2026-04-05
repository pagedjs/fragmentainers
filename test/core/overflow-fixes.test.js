import { test, expect } from "../browser-fixture.js";

test.describe("Overflow fixes: margin truncation at breaks", () => {
	test("trailing margin is truncated when a child breaks", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const words = Array.from({ length: 100 }, () => "word").join(" ");
			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:200px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <p style="width:200px;font:16px monospace;line-height:20px;margin:0 0 16px 0;padding:0">${words}</p>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 200,
					availableBlockSize: 100,
					fragmentainerBlockSize: 100,
					fragmentationType: "page",
				}),
			);

			const r = {
				length: pages.length,
				p0BlockSize: pages[0].blockSize,
			};
			container.remove();
			return r;
		});

		expect(result.length > 1).toBeTruthy();
		expect(result.p0BlockSize <= 100).toBeTruthy();
	});

	test("trailing margin is truncated when next sibling is pushed", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:200px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:90px;margin:0 0 20px 0;padding:0"></div>
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 200,
					availableBlockSize: 100,
					fragmentainerBlockSize: 100,
					fragmentationType: "page",
				}),
			);

			const r = { p0BlockSize: pages[0].blockSize };
			container.remove();
			return r;
		});

		expect(result.p0BlockSize <= 100).toBeTruthy();
	});

	test("trailing margin is included when all children fit", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:200px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:30px;margin:0 0 10px 0;padding:0"></div>
        <div style="height:30px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 200,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

			const r = {
				length: pages.length,
				p0BlockSize: pages[0].blockSize,
			};
			container.remove();
			return r;
		});

		expect(result.length).toBe(1);
		expect(result.p0BlockSize >= 70).toBeTruthy();
	});
});

test.describe("Overflow fixes: availableBlockSize propagation", () => {
	test("inline content respects parent padding reservation", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const words = Array.from({ length: 200 }, () => "word").join(" ");
			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:200px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="padding:0 0 20px 0;margin:0">
          <p style="width:200px;font:16px monospace;line-height:20px;margin:0;padding:0">${words}</p>
        </div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 200,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

			const r = { p0BlockSize: pages[0].blockSize };
			container.remove();
			return r;
		});

		expect(result.p0BlockSize <= 200).toBeTruthy();
	});

	test("leaf node respects parent padding reservation", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:200px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="padding:0 0 20px 0;margin:0">
          <div style="height:300px;margin:0;padding:0"></div>
        </div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 200,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

			const r = { p0BlockSize: pages[0].blockSize };
			container.remove();
			return r;
		});

		expect(result.p0BlockSize <= 200).toBeTruthy();
	});
});

test.describe("Overflow fixes: insufficient space for inline content", () => {
	test("inline content defers to next page when less than one line fits", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const words = Array.from({ length: 50 }, () => "word").join(" ");
			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:200px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:90px;margin:0;padding:0"></div>
        <p style="width:200px;font:16px monospace;line-height:20px;margin:0;padding:0">${words}</p>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 200,
					availableBlockSize: 100,
					fragmentainerBlockSize: 100,
					fragmentationType: "page",
				}),
			);

			const r = {
				p0BlockSize: pages[0].blockSize,
				length: pages.length,
			};
			container.remove();
			return r;
		});

		expect(result.p0BlockSize <= 100).toBeTruthy();
		expect(result.length >= 2).toBeTruthy();
	});

	test("inline content still places one line at top of empty page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const words = Array.from({ length: 50 }, () => "word").join(" ");
			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:200px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <p style="width:200px;font:16px monospace;line-height:20px;margin:0;padding:0">${words}</p>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 200,
					availableBlockSize: 15,
					fragmentainerBlockSize: 15,
					fragmentationType: "page",
				}),
			);

			const r = {
				length: pages.length,
				p0BlockSize: pages[0].blockSize,
			};
			container.remove();
			return r;
		});

		expect(result.length > 1).toBeTruthy();
		expect(result.p0BlockSize >= 20).toBeTruthy();
	});

	test("margin collapsing works between siblings", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:200px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:40px;margin:0 0 20px 0;padding:0"></div>
        <div style="height:40px;margin:15px 0 0 0;padding:0"></div>
        <div style="height:40px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 200,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

			const r = {
				length: pages.length,
				p0BlockSize: pages[0].blockSize,
			};
			container.remove();
			return r;
		});

		expect(result.length).toBe(1);
		expect(result.p0BlockSize).toBe(140);
	});

	test("parent padding is included in fragment blockSize", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:200px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="padding:10px 0;margin:0">
          <div style="height:50px;margin:0;padding:0"></div>
        </div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 200,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

			const r = {
				length: pages.length,
				p0Child0BlockSize: pages[0].childFragments[0].blockSize,
			};
			container.remove();
			return r;
		});

		expect(result.length).toBe(1);
		expect(result.p0Child0BlockSize).toBe(70);
	});
});
