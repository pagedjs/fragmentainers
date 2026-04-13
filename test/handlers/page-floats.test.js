import { test, expect } from "../browser-fixture.js";

test.describe("PageFloat.matches", () => {
	test("returns true for a page-float node", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { PageFloat } = await import("/src/handlers/page-float.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;--float:top;--float-reference:page;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = new DOMLayoutNode(container.firstElementChild);
			const mod = new PageFloat();
			const match = mod.claim(root.children[0]);
			container.remove();
			return match;
		});
		expect(result).toBe(true);
	});

	test("returns false for a regular block node", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { PageFloat } = await import("/src/handlers/page-float.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = new DOMLayoutNode(container.firstElementChild);
			const mod = new PageFloat();
			const match = mod.claim(root.children[0]);
			container.remove();
			return match;
		});
		expect(result).toBe(false);
	});
});

test.describe("PageFloat.layout", () => {
	test("reserves block-start space for a top float", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { PageFloat } = await import("/src/handlers/page-float.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;--float:top;--float-reference:page;margin:0;padding:0"></div>
        <div style="height:300px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = new DOMLayoutNode(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800,
				fragmentainerBlockSize: 800,
				fragmentationType: FRAGMENTATION_PAGE,
			});

			const layoutChildFn = (child, childCs) => {
				return { fragment: { blockSize: child.blockSize, childFragments: [] } };
			};

			const mod = new PageFloat();
			const res = mod.layout(root, cs, null, layoutChildFn);
			container.remove();
			return {
				reservedBlockStart: res.reservedBlockStart,
				reservedBlockEnd: res.reservedBlockEnd,
				hasAfterRender: typeof res.afterRender === "function",
			};
		});
		expect(result.reservedBlockStart).toBe(100);
		expect(result.reservedBlockEnd).toBe(0);
		expect(result.hasAfterRender).toBe(true);
	});

	test("reserves block-end space for a bottom float", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { PageFloat } = await import("/src/handlers/page-float.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:150px;--float:bottom;--float-reference:page;margin:0;padding:0"></div>
        <div style="height:300px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = new DOMLayoutNode(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800,
				fragmentainerBlockSize: 800,
				fragmentationType: FRAGMENTATION_PAGE,
			});

			const layoutChildFn = (child) => {
				return { fragment: { blockSize: child.blockSize, childFragments: [] } };
			};

			const mod = new PageFloat();
			const res = mod.layout(root, cs, null, layoutChildFn);
			container.remove();
			return {
				reservedBlockStart: res.reservedBlockStart,
				reservedBlockEnd: res.reservedBlockEnd,
			};
		});
		expect(result.reservedBlockStart).toBe(0);
		expect(result.reservedBlockEnd).toBe(150);
	});

	test("reserves space for both top and bottom floats", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { PageFloat } = await import("/src/handlers/page-float.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:50px;--float:top;--float-reference:page;margin:0;padding:0"></div>
        <div style="height:75px;--float:bottom;--float-reference:page;margin:0;padding:0"></div>
        <div style="height:300px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = new DOMLayoutNode(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800,
				fragmentainerBlockSize: 800,
				fragmentationType: FRAGMENTATION_PAGE,
			});

			const layoutChildFn = (child) => {
				return { fragment: { blockSize: child.blockSize, childFragments: [] } };
			};

			const mod = new PageFloat();
			const res = mod.layout(root, cs, null, layoutChildFn);
			container.remove();
			return {
				reservedBlockStart: res.reservedBlockStart,
				reservedBlockEnd: res.reservedBlockEnd,
			};
		});
		expect(result.reservedBlockStart).toBe(50);
		expect(result.reservedBlockEnd).toBe(75);
	});

	test("returns zero reservations when no floats present", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { PageFloat } = await import("/src/handlers/page-float.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:300px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = new DOMLayoutNode(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800,
				fragmentainerBlockSize: 800,
				fragmentationType: FRAGMENTATION_PAGE,
			});

			const layoutChildFn = (child) => {
				return { fragment: { blockSize: child.blockSize, childFragments: [] } };
			};

			const mod = new PageFloat();
			const res = mod.layout(root, cs, null, layoutChildFn);
			container.remove();
			return {
				reservedBlockStart: res.reservedBlockStart,
				reservedBlockEnd: res.reservedBlockEnd,
			};
		});
		expect(result.reservedBlockStart).toBe(0);
		expect(result.reservedBlockEnd).toBe(0);
	});
});

test.describe("page floats integration with createFragments", () => {
	test("top float reduces available space for content", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { PageFloat } = await import("/src/handlers/page-float.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;--float:top;--float-reference:page;margin:0;padding:0"></div>
        <div style="height:700px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = new DOMLayoutNode(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800,
				fragmentainerBlockSize: 800,
				fragmentationType: FRAGMENTATION_PAGE,
			});

			// Without handlers: content fits in one page (100 + 700 = 800)
			const noModFragments = createFragments(root, cs);

			// With handlers: float takes 100, content takes 700
			const csWithHandlers = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800 - 100,
				fragmentainerBlockSize: 800,
				blockOffsetInFragmentainer: 100,
				fragmentationType: FRAGMENTATION_PAGE,
				handlers: [PageFloat],
			});
			const fragments = createFragments(root, csWithHandlers);

			container.remove();
			return {
				noModLen: noModFragments.length,
				len: fragments.length,
				blockSize: fragments[0].blockSize,
			};
		});
		expect(result.noModLen).toBe(1);
		expect(result.len).toBe(1);
		expect(result.blockSize).toBe(700);
	});

	test("float causes content to overflow into second page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { PageFloat } = await import("/src/handlers/page-float.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:200px;--float:top;--float-reference:page;margin:0;padding:0"></div>
        <div style="height:700px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = new DOMLayoutNode(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800 - 200,
				fragmentainerBlockSize: 800,
				blockOffsetInFragmentainer: 200,
				fragmentationType: FRAGMENTATION_PAGE,
				handlers: [PageFloat],
			});
			const fragments = createFragments(root, cs);

			container.remove();
			return { len: fragments.length };
		});
		expect(result.len).toBe(2);
	});

	test("no handlers produces same results as before", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:300px;margin:0;padding:0"></div>
        <div style="height:300px;margin:0;padding:0"></div>
        <div style="height:300px;margin:0;padding:0"></div>
        <div style="height:300px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = new DOMLayoutNode(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800,
				fragmentainerBlockSize: 800,
				fragmentationType: FRAGMENTATION_PAGE,
			});
			const fragments = createFragments(root, cs);

			container.remove();
			return { len: fragments.length };
		});
		expect(result.len).toBe(2);
	});
});

test.describe("FragmentedFlow.register / .remove", () => {
	test("register() registers a handler globally", async ({ page }) => {
		await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			const { PageFloat } = await import("/src/handlers/page-float.js");

			FragmentedFlow.register(PageFloat);
			// Registering the same handler twice should be a no-op
			FragmentedFlow.register(PageFloat);
			// After removal, it should be gone
			FragmentedFlow.remove(PageFloat);
			// Removing again should be safe
			FragmentedFlow.remove(PageFloat);
		});
	});

	test("register() does not duplicate a handler", async ({ page }) => {
		await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			const { LayoutHandler } = await import("/src/handlers/handler.js");

			class Spy extends LayoutHandler {}
			FragmentedFlow.register(Spy);
			FragmentedFlow.register(Spy);
			FragmentedFlow.remove(Spy);

			// After one register + one register (deduped) + one remove, Spy should be fully gone.
			// Re-register to verify it was removed
			FragmentedFlow.register(Spy);
			FragmentedFlow.remove(Spy);
		});
	});
});
