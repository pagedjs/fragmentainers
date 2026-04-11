import { test, expect } from "../browser-fixture.js";

test.describe("FixedPosition.matches", () => {
	test("returns true for a position: fixed node", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { buildLayoutTree } = await import("/src/dom/index.js");
			const { FixedPosition } = await import("/src/modules/fixed-position.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="position:fixed;top:0;height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);
			const mod = new FixedPosition();
			const match = mod.claim(root.children[0]);
			container.remove();
			return match;
		});
		expect(result).toBe(true);
	});

	test("returns false for a regular block node", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { buildLayoutTree } = await import("/src/dom/index.js");
			const { FixedPosition } = await import("/src/modules/fixed-position.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);
			const mod = new FixedPosition();
			const match = mod.claim(root.children[0]);
			container.remove();
			return match;
		});
		expect(result).toBe(false);
	});
});

test.describe("FixedPosition.layout", () => {
	test("reserves block-start space for a top-anchored fixed element", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { buildLayoutTree } = await import("/src/dom/index.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/core/constants.js");
			const { FixedPosition } = await import("/src/modules/fixed-position.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="position:fixed;top:0;height:80px;margin:0;padding:0"></div>
        <div style="height:300px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800,
				fragmentainerBlockSize: 800,
				fragmentationType: FRAGMENTATION_PAGE,
			});

			const layoutChildFn = (child) => {
				return { fragment: { blockSize: child.blockSize, childFragments: [] } };
			};

			const mod = new FixedPosition();
			const res = mod.layout(root, cs, null, layoutChildFn);
			container.remove();
			return {
				reservedBlockStart: res.reservedBlockStart,
				reservedBlockEnd: res.reservedBlockEnd,
				hasAfterRender: typeof res.afterRender === "function",
			};
		});
		expect(result.reservedBlockStart).toBe(80);
		expect(result.reservedBlockEnd).toBe(0);
		expect(result.hasAfterRender).toBe(true);
	});

	test("reserves block-end space for a bottom-anchored fixed element", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { buildLayoutTree } = await import("/src/dom/index.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/core/constants.js");
			const { FixedPosition } = await import("/src/modules/fixed-position.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="position:fixed;bottom:0;height:60px;margin:0;padding:0"></div>
        <div style="height:300px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800,
				fragmentainerBlockSize: 800,
				fragmentationType: FRAGMENTATION_PAGE,
			});

			const layoutChildFn = (child) => {
				return { fragment: { blockSize: child.blockSize, childFragments: [] } };
			};

			const mod = new FixedPosition();
			const res = mod.layout(root, cs, null, layoutChildFn);
			container.remove();
			return {
				reservedBlockStart: res.reservedBlockStart,
				reservedBlockEnd: res.reservedBlockEnd,
			};
		});
		expect(result.reservedBlockStart).toBe(0);
		expect(result.reservedBlockEnd).toBe(60);
	});

	test("reserves space for both top and bottom fixed elements", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { buildLayoutTree } = await import("/src/dom/index.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/core/constants.js");
			const { FixedPosition } = await import("/src/modules/fixed-position.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="position:fixed;top:0;height:80px;margin:0;padding:0"></div>
        <div style="position:fixed;bottom:0;height:60px;margin:0;padding:0"></div>
        <div style="height:300px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800,
				fragmentainerBlockSize: 800,
				fragmentationType: FRAGMENTATION_PAGE,
			});

			const layoutChildFn = (child) => {
				return { fragment: { blockSize: child.blockSize, childFragments: [] } };
			};

			const mod = new FixedPosition();
			const res = mod.layout(root, cs, null, layoutChildFn);
			container.remove();
			return {
				reservedBlockStart: res.reservedBlockStart,
				reservedBlockEnd: res.reservedBlockEnd,
			};
		});
		expect(result.reservedBlockStart).toBe(80);
		expect(result.reservedBlockEnd).toBe(60);
	});

	test("does not reserve space for overlay fixed elements", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { buildLayoutTree } = await import("/src/dom/index.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/core/constants.js");
			const { FixedPosition } = await import("/src/modules/fixed-position.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="position:fixed;height:100px;margin:0;padding:0"></div>
        <div style="height:300px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800,
				fragmentainerBlockSize: 800,
				fragmentationType: FRAGMENTATION_PAGE,
			});

			const layoutChildFn = (child) => {
				return { fragment: { blockSize: child.blockSize, childFragments: [] } };
			};

			const mod = new FixedPosition();
			const res = mod.layout(root, cs, null, layoutChildFn);
			container.remove();
			return {
				reservedBlockStart: res.reservedBlockStart,
				reservedBlockEnd: res.reservedBlockEnd,
				hasAfterRender: typeof res.afterRender === "function",
			};
		});
		expect(result.reservedBlockStart).toBe(0);
		expect(result.reservedBlockEnd).toBe(0);
		expect(result.hasAfterRender).toBe(true);
	});

	test("returns zero reservations in column fragmentation", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { buildLayoutTree } = await import("/src/dom/index.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { FRAGMENTATION_COLUMN } = await import("/src/core/constants.js");
			const { FixedPosition } = await import("/src/modules/fixed-position.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="position:fixed;top:0;height:80px;margin:0;padding:0"></div>
        <div style="height:300px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800,
				fragmentainerBlockSize: 800,
				fragmentationType: FRAGMENTATION_COLUMN,
			});

			const layoutChildFn = (child) => {
				return { fragment: { blockSize: child.blockSize, childFragments: [] } };
			};

			const mod = new FixedPosition();
			const res = mod.layout(root, cs, null, layoutChildFn);
			container.remove();
			return {
				reservedBlockStart: res.reservedBlockStart,
				reservedBlockEnd: res.reservedBlockEnd,
				afterRenderIsNull: res.afterRender === null,
			};
		});
		expect(result.reservedBlockStart).toBe(0);
		expect(result.reservedBlockEnd).toBe(0);
		expect(result.afterRenderIsNull).toBe(true);
	});

	test("returns zero reservations when no fixed elements present", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { buildLayoutTree } = await import("/src/dom/index.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/core/constants.js");
			const { FixedPosition } = await import("/src/modules/fixed-position.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:300px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800,
				fragmentainerBlockSize: 800,
				fragmentationType: FRAGMENTATION_PAGE,
			});

			const layoutChildFn = (child) => {
				return { fragment: { blockSize: child.blockSize, childFragments: [] } };
			};

			const mod = new FixedPosition();
			const res = mod.layout(root, cs, null, layoutChildFn);
			container.remove();
			return {
				reservedBlockStart: res.reservedBlockStart,
				reservedBlockEnd: res.reservedBlockEnd,
				afterRenderIsNull: res.afterRender === null,
			};
		});
		expect(result.reservedBlockStart).toBe(0);
		expect(result.reservedBlockEnd).toBe(0);
		expect(result.afterRenderIsNull).toBe(true);
	});

	test("finds fixed elements nested inside non-fixed containers", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { buildLayoutTree } = await import("/src/dom/index.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/core/constants.js");
			const { FixedPosition } = await import("/src/modules/fixed-position.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="margin:0;padding:0">
          <div style="position:fixed;top:0;height:50px;margin:0;padding:0"></div>
          <div style="height:200px;margin:0;padding:0"></div>
        </div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800,
				fragmentainerBlockSize: 800,
				fragmentationType: FRAGMENTATION_PAGE,
			});

			const layoutChildFn = (child) => {
				return { fragment: { blockSize: child.blockSize, childFragments: [] } };
			};

			const mod = new FixedPosition();
			const res = mod.layout(root, cs, null, layoutChildFn);
			container.remove();
			return { reservedBlockStart: res.reservedBlockStart };
		});
		expect(result.reservedBlockStart).toBe(50);
	});
});

test.describe("fixed position integration with createFragments", () => {
	test("fixed header reduces available space for content", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { buildLayoutTree } = await import("/src/dom/index.js");
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/core/constants.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="position:fixed;top:0;height:100px;margin:0;padding:0"></div>
        <div style="height:700px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800 - 100,
				fragmentainerBlockSize: 800,
				blockOffsetInFragmentainer: 100,
				fragmentationType: FRAGMENTATION_PAGE,
			});
			const fragments = createFragments(root, cs);
			container.remove();
			return { len: fragments.length, blockSize: fragments[0].blockSize };
		});
		expect(result.len).toBe(1);
		expect(result.blockSize).toBe(700);
	});

	test("fixed header causes content to overflow into second page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { buildLayoutTree } = await import("/src/dom/index.js");
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/core/constants.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="position:fixed;top:0;height:200px;margin:0;padding:0"></div>
        <div style="height:700px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = buildLayoutTree(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800 - 200,
				fragmentainerBlockSize: 800,
				blockOffsetInFragmentainer: 200,
				fragmentationType: FRAGMENTATION_PAGE,
			});
			const fragments = createFragments(root, cs);
			container.remove();
			return { len: fragments.length };
		});
		expect(result.len).toBe(2);
	});
});

test.describe("position: fixed in paged media (browser)", () => {
	test("fixed header reduces available page space", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/core/constants.js");

			const template = document.createElement("template");
			template.innerHTML = `
        <div style="margin: 0; padding: 0;">
          <div style="position: fixed; top: 0; left: 0; right: 0; height: 50px; margin: 0; padding: 0;"></div>
          <div style="height: 180px; margin: 0; padding: 0;"></div>
          <div style="height: 180px; margin: 0; padding: 0;"></div>
        </div>
      `;
			const layout = new FragmentedFlow(template.content, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 400,
					fragmentainerBlockSize: 400,
					fragmentationType: FRAGMENTATION_PAGE,
				}),
			});
			const flow = layout.flow();
			const count = flow.fragmentainerCount;
			layout.destroy();
			return { count };
		});
		expect(result.count).toBe(2);
	});

	test("fixed header repeats in rendered output on every page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/core/constants.js");

			const template = document.createElement("template");
			template.innerHTML = `
        <div style="margin: 0; padding: 0;">
          <div style="position: fixed; top: 0; left: 0; right: 0; height: 50px; margin: 0; padding: 0;" class="fixed-header"></div>
          <div style="height: 200px; margin: 0; padding: 0;"></div>
          <div style="height: 200px; margin: 0; padding: 0;"></div>
        </div>
      `;
			const layout = new FragmentedFlow(template.content, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 400,
					fragmentainerBlockSize: 400,
					fragmentationType: FRAGMENTATION_PAGE,
				}),
			});
			const flow = layout.flow();
			const count = flow.fragmentainerCount;

			const allHaveHeader = [];
			const elements = [...flow];
			for (const el of elements) {
				document.body.appendChild(el);
				const headerClone = el.shadowRoot.querySelector(".fixed-header");
				allHaveHeader.push(headerClone !== null);
				el.remove();
			}

			layout.destroy();
			return { count, allHaveHeader };
		});
		expect(result.count).toBeGreaterThan(1);
		for (const has of result.allHaveHeader) {
			expect(has).toBe(true);
		}
	});

	test("fixed footer positioned at bottom of each page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/core/constants.js");

			const template = document.createElement("template");
			template.innerHTML = `
        <div style="margin: 0; padding: 0;">
          <div style="position: fixed; bottom: 0; left: 0; right: 0; height: 50px; margin: 0; padding: 0;" class="fixed-footer"></div>
          <div style="height: 200px; margin: 0; padding: 0;"></div>
          <div style="height: 200px; margin: 0; padding: 0;"></div>
        </div>
      `;
			const layout = new FragmentedFlow(template.content, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 400,
					fragmentainerBlockSize: 400,
					fragmentationType: FRAGMENTATION_PAGE,
				}),
			});
			const flow = layout.flow();
			const count = flow.fragmentainerCount;

			const footerData = [];
			const elements = [...flow];
			for (const el of elements) {
				document.body.appendChild(el);
				const footerClone = el.shadowRoot.querySelector(".fixed-footer");
				footerData.push({
					exists: footerClone !== null,
					bottom: footerClone ? footerClone.style.bottom : null,
				});
				el.remove();
			}

			layout.destroy();
			return { count, footerData };
		});
		expect(result.count).toBeGreaterThan(1);
		for (const fd of result.footerData) {
			expect(fd.exists).toBe(true);
			expect(fd.bottom).toBe("0px");
		}
	});

	test("header and footer both repeat on every page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/core/constants.js");

			const template = document.createElement("template");
			template.innerHTML = `
        <div style="margin: 0; padding: 0;">
          <div style="position: fixed; top: 0; left: 0; right: 0; height: 40px; margin: 0; padding: 0;" class="header"></div>
          <div style="position: fixed; bottom: 0; left: 0; right: 0; height: 40px; margin: 0; padding: 0;" class="footer"></div>
          <div style="height: 200px; margin: 0; padding: 0;"></div>
          <div style="height: 200px; margin: 0; padding: 0;"></div>
        </div>
      `;
			const layout = new FragmentedFlow(template.content, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 400,
					fragmentainerBlockSize: 400,
					fragmentationType: FRAGMENTATION_PAGE,
				}),
			});
			const flow = layout.flow();
			const count = flow.fragmentainerCount;

			const pageData = [];
			const elements = [...flow];
			for (const el of elements) {
				document.body.appendChild(el);
				pageData.push({
					hasHeader: el.shadowRoot.querySelector(".header") !== null,
					hasFooter: el.shadowRoot.querySelector(".footer") !== null,
				});
				el.remove();
			}

			layout.destroy();
			return { count, pageData };
		});
		expect(result.count).toBe(2);
		for (const pd of result.pageData) {
			expect(pd.hasHeader).toBe(true);
			expect(pd.hasFooter).toBe(true);
		}
	});

	test("content fits on one page when fixed elements leave enough room", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/core/constants.js");

			const template = document.createElement("template");
			template.innerHTML = `
        <div style="margin: 0; padding: 0;">
          <div style="position: fixed; top: 0; left: 0; right: 0; height: 20px; margin: 0; padding: 0;"></div>
          <div style="height: 50px; margin: 0; padding: 0;"></div>
        </div>
      `;
			const layout = new FragmentedFlow(template.content, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 400,
					fragmentainerBlockSize: 400,
					fragmentationType: FRAGMENTATION_PAGE,
				}),
			});
			const flow = layout.flow();
			const count = flow.fragmentainerCount;
			layout.destroy();
			return { count };
		});
		expect(result.count).toBe(1);
	});
});
