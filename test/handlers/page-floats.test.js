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

			const layoutChildFn = (child) => {
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
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { PageFloat } = await import("/src/handlers/page-float.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;--float:top;--float-reference:page;margin:0;padding:0"></div>
        <div style="height:700px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800,
				fragmentainerBlockSize: 800,
				fragmentationType: FRAGMENTATION_PAGE,
			});

			// Without the handler the float stays in normal flow: 100 + 700 = 800.
			const noModFragments = createFragments(new DOMLayoutNode(container.firstElementChild), cs);

			// With it the float is pulled out and reserves 100, leaving 700.
			Fragmenter.handlers.push(PageFloat);
			const fragments = createFragments(new DOMLayoutNode(container.firstElementChild), cs);
			Fragmenter.handlers.splice(Fragmenter.handlers.indexOf(PageFloat), 1);

			container.remove();
			return {
				noModLen: noModFragments.length,
				noModBlockSize: noModFragments[0].blockSize,
				len: fragments.length,
				blockSize: fragments[0].blockSize,
			};
		});
		expect(result.noModLen).toBe(1);
		expect(result.noModBlockSize).toBe(800);
		expect(result.len).toBe(1);
		expect(result.blockSize).toBe(700);
	});

	test("float causes content to overflow into second page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { PageFloat } = await import("/src/handlers/page-float.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:200px;--float:top;--float-reference:page;margin:0;padding:0"></div>
        <div style="height:700px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800,
				fragmentainerBlockSize: 800,
				fragmentationType: FRAGMENTATION_PAGE,
			});

			Fragmenter.handlers.push(PageFloat);
			const fragments = createFragments(new DOMLayoutNode(container.firstElementChild), cs);
			Fragmenter.handlers.splice(Fragmenter.handlers.indexOf(PageFloat), 1);

			container.remove();
			return { len: fragments.length };
		});
		expect(result.len).toBe(2);
	});

	test("no handlers produces same results as before", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
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

test.describe("Fragmenter.handlers catalog", () => {
	test("a pushed handler is instantiated by flows constructed afterwards only", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { PageFloat } = await import("/src/handlers/page-float.js");

			const before = new Fragmenter(document.createDocumentFragment(), { width: 100, height: 100 });
			Fragmenter.handlers.push(PageFloat);
			const after = new Fragmenter(document.createDocumentFragment(), { width: 100, height: 100 });
			Fragmenter.handlers.splice(Fragmenter.handlers.indexOf(PageFloat), 1);

			const res = {
				beforeHas: before.handlers.classes.includes(PageFloat),
				afterHas: after.handlers.classes.includes(PageFloat),
				catalogRestored: !Fragmenter.handlers.includes(PageFloat),
			};
			before.destroy();
			after.destroy();
			return res;
		});
		expect(result.beforeHas).toBe(false);
		expect(result.afterHas).toBe(true);
		expect(result.catalogRestored).toBe(true);
	});

	test("resolution dedupes, keeps order, and lets a subclass override its base in place", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { resolveHandlerClasses } = await import("/src/handlers/registry.js");
			const { LayoutHandler } = await import("/src/handlers/handler.js");

			class A extends LayoutHandler {}
			class B extends LayoutHandler {}
			class C extends LayoutHandler {}
			class B2 extends B {}

			const resolved = resolveHandlerClasses([A, B, C, A, B2]);
			let rejected = false;
			try {
				resolveHandlerClasses([A, class NotAHandler {}]);
			} catch {
				rejected = true;
			}
			return { names: resolved.map((c) => c.name), rejected };
		});
		expect(result.names).toEqual(["A", "B2", "C"]);
		expect(result.rejected).toBe(true);
	});

	test("two flows get distinct handler instances and destroying one leaves the other intact", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { PseudoElements } = await import("/src/handlers/pseudo-elements.js");

			const make = () => {
				const template = document.createElement("template");
				template.innerHTML = "<p>one</p><p>two</p>";
				return new Fragmenter(template.content, { width: 200, height: 50 });
			};
			const a = make();
			const b = make();
			a.next();
			b.next();
			const ia = a.handlers.get(PseudoElements);
			const ib = b.handlers.get(PseudoElements);
			a.destroy();
			const res = {
				bothExist: ia !== null && ib !== null,
				distinct: ia !== ib,
				bStillHas: b.handlers.get(PseudoElements) === ib,
				aCleared: a.handlers.get(PseudoElements) === null,
			};
			b.destroy();
			return res;
		});
		expect(result.bothExist).toBe(true);
		expect(result.distinct).toBe(true);
		expect(result.bStillHas).toBe(true);
		expect(result.aCleared).toBe(true);
	});
});
