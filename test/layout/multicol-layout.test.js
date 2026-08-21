import { test, expect } from "../browser-fixture.js";

test.describe("layoutMulticolContainer", () => {
	test("dispatches multicol nodes to the multicol algorithm", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getLayoutAlgorithm } = await import("/src/layout/layout-driver.js");
			const { MulticolAlgorithm } = await import("/src/algorithms/multicol-container.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = '<div style="column-count:2;column-gap:0;margin:0;padding:0"></div>';
			document.body.appendChild(container);

			const node = new DOMLayoutNode(container.firstElementChild);
			const algoName = getLayoutAlgorithm(node).name;

			container.remove();
			return { algoName, expectedName: MulticolAlgorithm.name };
		});

		expect(result.algoName).toBe(result.expectedName);
	});

	test("does not dispatch non-multicol nodes to multicol", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getLayoutAlgorithm } = await import("/src/layout/layout-driver.js");
			const { MulticolAlgorithm } = await import("/src/algorithms/multicol-container.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = '<div style="margin:0;padding:0"></div>';
			document.body.appendChild(container);

			const node = new DOMLayoutNode(container.firstElementChild);
			const algoName = getLayoutAlgorithm(node).name;

			container.remove();
			return { algoName, multicolName: MulticolAlgorithm.name };
		});

		expect(result.algoName).not.toBe(result.multicolName);
	});

	test("lays out content across 2 columns", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="column-count:2;column-gap:0;margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 100,
				fragmentainerBlockSize: 100,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const AlgoClass = getLayoutAlgorithm(root);
			const result = runLayoutGenerator(new AlgoClass(root, cs, null));

			const out = {
				columnCount: result.fragment.childFragments.length,
				multicolColumnCount: result.fragment.multicolData.columnCount,
				multicolColumnWidth: result.fragment.multicolData.columnWidth,
			};

			container.remove();
			return out;
		});

		expect(result.columnCount).toBe(2);
		expect(result.multicolColumnCount).toBe(2);
		expect(result.multicolColumnWidth).toBe(300);
	});

	test("all content fits in one column when column height is large", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="column-count:2;column-gap:0;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 200,
				fragmentainerBlockSize: 200,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const AlgoClass = getLayoutAlgorithm(root);
			const result = runLayoutGenerator(new AlgoClass(root, cs, null));

			container.remove();
			return { columnCount: result.fragment.childFragments.length };
		});

		expect(result.columnCount).toBe(1);
	});

	test("content flows across 3 columns", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="column-count:3;column-gap:0;margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 100,
				fragmentainerBlockSize: 100,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const AlgoClass = getLayoutAlgorithm(root);
			const result = runLayoutGenerator(new AlgoClass(root, cs, null));

			container.remove();
			return { columnCount: result.fragment.childFragments.length };
		});

		expect(result.columnCount).toBe(3);
	});

	test("respects column-fill: auto - stops at column count", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="column-count:2;column-gap:0;column-fill:auto;margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 100,
				fragmentainerBlockSize: 100,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const AlgoClass = getLayoutAlgorithm(root);
			const result = runLayoutGenerator(new AlgoClass(root, cs, null));

			const out = {
				columnCount: result.fragment.childFragments.length,
				breakToken: result.breakToken,
			};

			container.remove();
			return out;
		});

		expect(result.columnCount).toBe(2);
		expect(result.breakToken).toBe(null);
	});

	test("column-fill: balance also caps at column count and breaks overflow", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			// Default column-fill is balance: 3 columns' worth of content but only
			// 2 columns of 100px — the third must overflow to the next fragmentainer.
			container.innerHTML = `<div style="column-count:2;column-gap:0;margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 100,
				fragmentainerBlockSize: 100,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "page",
			});
			const AlgoClass = getLayoutAlgorithm(root);
			const result = runLayoutGenerator(new AlgoClass(root, cs, null));

			const out = {
				columnCount: result.fragment.childFragments.length,
				hasBreakToken: result.breakToken !== null,
			};
			container.remove();
			return out;
		});

		expect(result.columnCount).toBe(2);
		expect(result.hasBreakToken).toBe(true);
	});

	test("continues overflow columns onto the next fragmentainer (no content loss)", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const cell = '<div style="height:100px;margin:0;padding:0"></div>';
			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:200px";
			// Six 100px children in 2 columns of 200px: four fit on page 1
			// (2 columns × 2 children), the remaining two continue on page 2.
			container.innerHTML = `<div style="column-count:2;column-gap:0;margin:0;padding:0">${cell.repeat(6)}</div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 200,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					blockOffsetInFragmentainer: 0,
					fragmentationType: "page",
				}),
			);

			const out = {
				pageCount: pages.length,
				colCounts: pages.map((p) => p.childFragments.length),
			};
			container.remove();
			return out;
		});

		// 2 columns on page 1, the overflow column on page 2 — all six children placed.
		expect(result.pageCount).toBe(2);
		expect(result.colCounts).toEqual([2, 1]);
	});

	test("sizes a short multicol to its tallest column, not the full height", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			// 60px of content in a column box with 200px available — the multicol
			// should occupy 60px, not consume the whole 200px.
			container.innerHTML = `<div style="column-count:2;column-gap:0;margin:0;padding:0">
        <div style="height:30px;margin:0;padding:0"></div>
        <div style="height:30px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 200,
				fragmentainerBlockSize: 200,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const AlgoClass = getLayoutAlgorithm(root);
			const result = runLayoutGenerator(new AlgoClass(root, cs, null));

			const out = { blockSize: result.fragment.blockSize };
			container.remove();
			return out;
		});

		expect(result.blockSize).toBe(60);
	});

	test("resolves column width correctly with gap", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:620px";
			container.innerHTML = `<div style="column-count:2;column-gap:20px;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 620,
				availableBlockSize: 200,
				fragmentainerBlockSize: 200,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const AlgoClass = getLayoutAlgorithm(root);
			const result = runLayoutGenerator(new AlgoClass(root, cs, null));

			const out = {
				columnWidth: result.fragment.multicolData.columnWidth,
				columnGap: result.fragment.multicolData.columnGap,
			};

			container.remove();
			return out;
		});

		expect(result.columnWidth).toBe(300);
		expect(result.columnGap).toBe(20);
	});

	test("sets multicolData on the fragment", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:640px";
			container.innerHTML = `<div style="column-count:3;column-gap:10px;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 640,
				availableBlockSize: 200,
				fragmentainerBlockSize: 200,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const AlgoClass = getLayoutAlgorithm(root);
			const result = runLayoutGenerator(new AlgoClass(root, cs, null));

			const out = {
				hasMulticolData: !!result.fragment.multicolData,
				columnCount: result.fragment.multicolData.columnCount,
				columnGap: result.fragment.multicolData.columnGap,
			};

			container.remove();
			return out;
		});

		expect(result.hasMulticolData).toBe(true);
		expect(result.columnCount).toBe(3);
		expect(result.columnGap).toBe(10);
	});

	test("break-before: column forces a column break", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="column-count:3;column-gap:0;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
        <div style="height:50px;break-before:column;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 200,
				fragmentainerBlockSize: 200,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const AlgoClass = getLayoutAlgorithm(root);
			const result = runLayoutGenerator(new AlgoClass(root, cs, null));

			container.remove();
			return { columnCount: result.fragment.childFragments.length };
		});

		expect(result.columnCount).toBe(2);
	});

	test("emits break token with kMulticolData when nested in outer context", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator } = await import("/src/layout/layout-driver.js");
			const { MulticolAlgorithm } = await import("/src/algorithms/multicol-container.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="column-count:2;column-gap:0;column-fill:auto;margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 100,
				fragmentainerBlockSize: 100,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "page",
			});
			const result = runLayoutGenerator(new MulticolAlgorithm(root, cs, null));

			const out = {
				hasBreakToken: !!result.breakToken,
				algorithmDataType: result.breakToken?.algorithmData?.type ?? null,
				columnCount: result.breakToken?.algorithmData?.columnCount ?? null,
				columnWidth: result.breakToken?.algorithmData?.columnWidth ?? null,
			};

			container.remove();
			return out;
		});

		expect(result.hasBreakToken).toBe(true);
		expect(result.algorithmDataType).toBe("MulticolData");
		expect(result.columnCount).toBe(2);
		expect(result.columnWidth).toBe(300);
	});

	test("does not infinitely recurse (flow thread pattern)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="column-count:2;column-gap:0;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 200,
				fragmentainerBlockSize: 200,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const AlgoClass = getLayoutAlgorithm(root);
			const result = runLayoutGenerator(new AlgoClass(root, cs, null));

			const out = {
				hasFragment: !!result.fragment,
				columnCount: result.fragment.childFragments.length,
			};

			container.remove();
			return out;
		});

		expect(result.hasFragment).toBe(true);
		expect(result.columnCount).toBe(1);
	});

	test("fragment inlineSize matches container", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:800px";
			container.innerHTML = `<div style="column-count:2;column-gap:0;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 800,
				availableBlockSize: 200,
				fragmentainerBlockSize: 200,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const AlgoClass = getLayoutAlgorithm(root);
			const result = runLayoutGenerator(new AlgoClass(root, cs, null));

			container.remove();
			return { inlineSize: result.fragment.inlineSize };
		});

		expect(result.inlineSize).toBe(800);
	});
});
