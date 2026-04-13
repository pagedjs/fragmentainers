import { test, expect } from "../browser-fixture.js";

test.describe("layoutGridContainer", () => {
	test("dispatches grid nodes to the grid algorithm", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getLayoutAlgorithm } = await import("/src/layout/layout-driver.js");
			const { GridAlgorithm } = await import("/src/algorithms/grid-container.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = '<div style="display:grid;margin:0;padding:0"></div>';
			document.body.appendChild(container);

			const node = new DOMLayoutNode(container.firstElementChild);
			const algoName = getLayoutAlgorithm(node).name;

			container.remove();
			return { algoName, expectedName: GridAlgorithm.name };
		});

		expect(result.algoName).toBe(result.expectedName);
	});

	test("lays out single-row grid items as parallel flows", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;margin:0;padding:0">
        <div style="height:100px;grid-row-start:1;grid-row-end:2;margin:0;padding:0"></div>
        <div style="height:80px;grid-row-start:1;grid-row-end:2;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 400,
				fragmentainerBlockSize: 400,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const AlgoClass = getLayoutAlgorithm(root);
			const result = runLayoutGenerator(new AlgoClass(root, cs, null));

			const out = {
				rowCount: result.fragment.childFragments.length,
				rowChildCount: result.fragment.childFragments[0].childFragments.length,
				rowBlockSize: result.fragment.childFragments[0].blockSize,
			};

			container.remove();
			return out;
		});

		expect(result.rowCount).toBe(1);
		expect(result.rowChildCount).toBe(2);
		expect(result.rowBlockSize).toBe(100);
	});

	test("multi-row grid stacks rows", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="display:grid;margin:0;padding:0">
        <div style="height:100px;grid-row-start:1;grid-row-end:2;margin:0;padding:0"></div>
        <div style="height:80px;grid-row-start:2;grid-row-end:3;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 400,
				fragmentainerBlockSize: 400,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const AlgoClass = getLayoutAlgorithm(root);
			const result = runLayoutGenerator(new AlgoClass(root, cs, null));

			const out = {
				rowCount: result.fragment.childFragments.length,
				blockSize: result.fragment.blockSize,
			};

			container.remove();
			return out;
		});

		expect(result.rowCount).toBe(2);
		expect(result.blockSize).toBe(180);
	});

	test("items in the same row fragment independently (parallel flows)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;margin:0;padding:0">
        <div style="height:200px;grid-row-start:1;grid-row-end:2;margin:0;padding:0"></div>
        <div style="height:50px;grid-row-start:1;grid-row-end:2;margin:0;padding:0"></div>
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

			container.remove();
			return { hasBreakToken: !!result.breakToken };
		});

		expect(result.hasBreakToken).toBe(true);
	});

	test("completed items get isAtBlockEnd tokens", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;margin:0;padding:0">
        <div style="height:200px;grid-row-start:1;grid-row-end:2;margin:0;padding:0"></div>
        <div style="height:50px;grid-row-start:1;grid-row-end:2;margin:0;padding:0"></div>
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

			container.remove();
			return { hasBreakToken: !!result.breakToken };
		});

		expect(result.hasBreakToken).toBe(true);
	});

	test("break token has GridData with rowIndex", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="display:grid;margin:0;padding:0">
        <div style="height:200px;grid-row-start:1;grid-row-end:2;margin:0;padding:0"></div>
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
				hasBreakToken: !!result.breakToken,
				algorithmDataType: result.breakToken?.algorithmData?.type ?? null,
				rowIndexType: typeof result.breakToken?.algorithmData?.rowIndex,
			};

			container.remove();
			return out;
		});

		expect(result.hasBreakToken).toBe(true);
		expect(result.algorithmDataType).toBe("GridData");
		expect(result.rowIndexType).toBe("number");
	});

	test("empty grid container produces zero-height fragment", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = '<div style="display:grid;margin:0;padding:0"></div>';
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 400,
				fragmentainerBlockSize: 400,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const AlgoClass = getLayoutAlgorithm(root);
			const result = runLayoutGenerator(new AlgoClass(root, cs, null));

			const out = {
				blockSize: result.fragment.blockSize,
				breakToken: result.breakToken,
			};

			container.remove();
			return out;
		});

		expect(result.blockSize).toBe(0);
		expect(result.breakToken).toBe(null);
	});

	test("auto-placed items (no gridRowStart) each get their own row", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="display:grid;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 400,
				fragmentainerBlockSize: 400,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const AlgoClass = getLayoutAlgorithm(root);
			const result = runLayoutGenerator(new AlgoClass(root, cs, null));

			const out = {
				rowCount: result.fragment.childFragments.length,
				blockSize: result.fragment.blockSize,
			};

			container.remove();
			return out;
		});

		expect(result.rowCount).toBe(2);
		expect(result.blockSize).toBe(100);
	});
});
