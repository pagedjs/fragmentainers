import { test, expect } from "../browser-fixture.js";

test.describe("Inline content layout (browser)", () => {
	test("lays out inline content that fits on one page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position: absolute; left: -9999px; top: 0;";
			document.body.appendChild(container);

			container.innerHTML =
				'<p style="width: 400px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">Hello world</p>';
			const p = container.querySelector("p");
			const root = new DOMLayoutNode(p);

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 800,
					fragmentainerBlockSize: 800,
					fragmentationType: "page",
				}),
			);

			container.remove();

			return {
				pageCount: pages.length,
				firstBreakToken: pages[0].breakToken,
			};
		});

		expect(result.pageCount).toBe(1);
		expect(result.firstBreakToken).toBe(null);
	});

	test("breaks text across multiple lines", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position: absolute; left: -9999px; top: 0;";
			document.body.appendChild(container);

			const text = Array.from({ length: 20 }, () => "word").join(" ");
			container.innerHTML = `<p style="width: 100px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">${text}</p>`;
			const p = container.querySelector("p");
			const root = new DOMLayoutNode(p);

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 100,
					availableBlockSize: 800,
					fragmentainerBlockSize: 800,
					fragmentationType: "page",
				}),
			);

			container.remove();

			return {
				pageCount: pages.length,
				childFragmentCount: pages[0].childFragments.length,
			};
		});

		expect(result.pageCount).toBe(1);
		expect(result.childFragmentCount).toBeGreaterThan(1);
	});

	test("fragments inline content across pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position: absolute; left: -9999px; top: 0;";
			document.body.appendChild(container);

			const text = Array.from({ length: 80 }, () => "word").join(" ");
			container.innerHTML = `<p style="width: 200px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">${text}</p>`;
			const p = container.querySelector("p");
			const root = new DOMLayoutNode(p);

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 200,
					availableBlockSize: 60,
					fragmentainerBlockSize: 60,
					fragmentationType: "page",
				}),
			);

			container.remove();

			return {
				pageCount: pages.length,
				firstBreakTokenTruthy: !!pages[0].breakToken,
				lastBreakToken: pages[pages.length - 1].breakToken,
			};
		});

		expect(result.pageCount).toBeGreaterThan(1);
		expect(result.firstBreakTokenTruthy).toBe(true);
		expect(result.lastBreakToken).toBe(null);
	});

	test("InlineBreakToken has content-addressed position", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { BREAK_TOKEN_INLINE } = await import("/src/fragmentation/tokens.js");

			const container = document.createElement("div");
			container.style.cssText = "position: absolute; left: -9999px; top: 0;";
			document.body.appendChild(container);

			const text = Array.from({ length: 80 }, () => "test").join(" ");
			container.innerHTML = `<p style="width: 200px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">${text}</p>`;
			const p = container.querySelector("p");
			const root = new DOMLayoutNode(p);

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 200,
					availableBlockSize: 60,
					fragmentainerBlockSize: 60,
					fragmentationType: "page",
				}),
			);

			container.remove();

			const breakToken = pages[0].breakToken;
			return {
				pageCount: pages.length,
				breakTokenTruthy: !!breakToken,
				breakTokenType: breakToken ? breakToken.type : null,
				breakTokenTextOffset: breakToken ? breakToken.textOffset : null,
				BREAK_TOKEN_INLINE,
			};
		});

		expect(result.pageCount).toBeGreaterThan(1);
		expect(result.breakTokenTruthy).toBe(true);
		expect(result.breakTokenType).toBe(result.BREAK_TOKEN_INLINE);
		expect(result.breakTokenTextOffset).toBeGreaterThan(0);
	});

	test("handles forced line break with <br>", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position: absolute; left: -9999px; top: 0;";
			document.body.appendChild(container);

			container.innerHTML =
				'<p style="width: 400px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">Line one<br>Line two<br>Line three</p>';
			const p = container.querySelector("p");
			const root = new DOMLayoutNode(p);

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 800,
					fragmentainerBlockSize: 800,
					fragmentationType: "page",
				}),
			);

			container.remove();

			return {
				pageCount: pages.length,
				childFragmentCount: pages[0].childFragments.length,
			};
		});

		expect(result.pageCount).toBe(1);
		expect(result.childFragmentCount).toBe(3);
	});

	test("varying inline size between pages changes line breaks", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position: absolute; left: -9999px; top: 0;";
			document.body.appendChild(container);

			const text = Array.from({ length: 40 }, () => "word").join(" ");
			container.innerHTML = `<p style="width: 100px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">${text}</p>`;
			const p = container.querySelector("p");
			const root = new DOMLayoutNode(p);

			const pages = createFragments(root, {
				resolve: (index) => {
					const sizes = [
						{ inlineSize: 100, blockSize: 60 },
						{ inlineSize: 400, blockSize: 400 },
					];
					const size = sizes[index] || sizes.at(-1);
					return {
						toConstraintSpace: () =>
							new ConstraintSpace({
								availableInlineSize: size.inlineSize,
								availableBlockSize: size.blockSize,
								fragmentainerBlockSize: size.blockSize,
								fragmentationType: "page",
							}),
					};
				},
			});

			container.remove();

			return {
				pageCount: pages.length,
				firstPageChildCount: pages[0].childFragments.length,
			};
		});

		expect(result.pageCount).toBeGreaterThanOrEqual(2);
		expect(result.firstPageChildCount).toBeGreaterThan(0);
	});

	test("respects explicit CSS height on an IFC element", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:400px";
			container.innerHTML = `
				<div>
					<h3 style="height:200px;margin:0;padding:0;font:16px/18px monospace">Short</h3>
				</div>
			`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 800,
					fragmentainerBlockSize: 800,
					fragmentationType: "page",
				}),
			);

			const out = {
				pageCount: pages.length,
				h3BlockSize: pages[0].childFragments[0]?.blockSize,
			};
			container.remove();
			return out;
		});

		expect(result.pageCount).toBe(1);
		expect(result.h3BlockSize).toBe(200);
	});

	test("explicit-height IFC element breaks across fragmentainers", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:400px";
			container.innerHTML = `
				<div>
					<div style="height:150px;margin:0;padding:0"></div>
					<h3 style="height:200px;margin:0;padding:0;font:16px/18px monospace">Short</h3>
					<div style="height:100px;margin:0;padding:0"></div>
				</div>
			`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 300,
					fragmentainerBlockSize: 300,
					fragmentationType: "page",
				}),
			);

			const out = {
				pageCount: pages.length,
				pageSizes: pages.map((p) => p.blockSize),
				pageChildSums: pages.map((p) =>
					p.childFragments.reduce((s, c) => s + c.blockSize, 0),
				),
			};
			container.remove();
			return out;
		});

		// 150 + 200 + 100 = 450px of box content on 300px pages → 2 pages required
		expect(result.pageCount).toBeGreaterThanOrEqual(2);
		// Total box content across all pages should sum to 450 (modulo rounding)
		const total = result.pageChildSums.reduce((s, n) => s + n, 0);
		expect(total).toBeGreaterThanOrEqual(445);
		expect(total).toBeLessThanOrEqual(455);
	});
});
