import { test, expect } from "../browser-fixture.js";

test.describe("Phase 4: Monolithic content", () => {
	test("pushes a monolithic element to the next page when it does not fit", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
        <img style="height:300px;width:100px;display:block;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

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
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <img style="height:500px;width:100px;display:block;margin:0;padding:0">
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

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
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <img style="height:500px;width:100px;display:block;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

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
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:200px;overflow-y:scroll;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 150,
					fragmentainerBlockSize: 150,
					fragmentationType: "page",
				}),
			);

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
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <img style="height:100px;width:100px;display:block;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

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

	test("a monolithic element with block children is not fragmented", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			// overflow:hidden + explicit height ⇒ monolithic. It has two block
			// children summing to 300px; they must NOT be fragmented across pages.
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="overflow:hidden;height:300px;margin:0;padding:0">
          <div style="height:150px;margin:0;padding:0"></div>
          <div style="height:150px;margin:0;padding:0"></div>
        </div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

			const monoP0 = pages[0].childFragments[0];
			const out = {
				pageCount: pages.length,
				p0MonoChildFragments: monoP0.childFragments.length,
				p0MonoBlockSize: monoP0.blockSize,
				p1MonoBlockSize: pages[1]?.childFragments[0]?.blockSize ?? null,
			};
			container.remove();
			return out;
		});

		// The monolithic node is sliced as a unit (200px then 100px), never
		// descended into — so it has no child fragments of its own.
		expect(result.p0MonoChildFragments).toBe(0);
		expect(result.p0MonoBlockSize).toBe(200);
		expect(result.pageCount).toBe(2);
		expect(result.p1MonoBlockSize).toBe(100);
	});

	test("sliced monolithic element clips each fragment to its blockSize", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");

			const frag = document.createDocumentFragment();
			const root = document.createElement("div");
			root.innerHTML =
				'<div id="tall" style="height:500px;overflow:hidden;background:#f00">tall content</div>';
			frag.appendChild(root);

			const { ConstraintSpace, FRAGMENTATION_PAGE } =
				await import("/src/fragmentation/constraint-space.js");
			// Slicing a monolithic box is the paged-media last resort (CSS
			// Fragmentation §4.4); column fragmentation overflows instead.
			const flow = new Fragmenter(frag, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 300,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: FRAGMENTATION_PAGE,
				}),
			});
			const pages = [];
			for (const el of flow) {
				pages.push(el);
				if (pages.length >= 5) break;
			}

			const probe = (p) => {
				const tall = p.querySelector("#tall");
				if (!tall) return null;
				const wrapper = tall.parentElement;
				return {
					wrapperTag: wrapper?.tagName,
					wrapperHeight: wrapper?.style.height,
					wrapperOverflow: wrapper?.style.overflow,
					tallMarginTop: tall.style.marginTop,
				};
			};

			const out = {
				pageCount: pages.length,
				page1: probe(pages[0]),
				page2: probe(pages[1]),
				page3: probe(pages[2]),
			};

			flow.destroy();
			return out;
		});

		expect(result.pageCount).toBeGreaterThanOrEqual(3);
		expect(result.page1.wrapperTag).toBe("DIV");
		expect(result.page1.wrapperOverflow).toBe("hidden");
		expect(result.page1.wrapperHeight).toMatch(/^\d/);
		expect(result.page1.tallMarginTop).toBe("");

		expect(result.page2.wrapperOverflow).toBe("hidden");
		expect(result.page2.tallMarginTop).toMatch(/^-\d/);

		expect(result.page3.wrapperOverflow).toBe("hidden");
		expect(result.page3.tallMarginTop).toMatch(/^-\d/);
	});
});
