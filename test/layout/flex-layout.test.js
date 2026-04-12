import { test, expect } from "../browser-fixture.js";

test.describe("layoutFlexContainer", () => {
	test("dispatches flex nodes to the flex algorithm", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getLayoutAlgorithm } = await import("/src/layout/layout-request.js");
			const { layoutFlexContainer } = await import("/src/algorithms/flex-container.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = '<div style="display:flex;margin:0;padding:0"></div>';
			document.body.appendChild(container);

			const node = new DOMLayoutNode(container.firstElementChild);
			const algoName = getLayoutAlgorithm(node).name;

			container.remove();
			return { algoName, expectedName: layoutFlexContainer.name };
		});

		expect(result.algoName).toBe(result.expectedName);
	});

	test("lays out single-line row flex items as parallel flows", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-request.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="display:flex;margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:80px;margin:0;padding:0"></div>
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
			const result = runLayoutGenerator(getLayoutAlgorithm(root), root, cs, null);

			const out = {
				childCount: result.fragment.childFragments.length,
				lineChildCount: result.fragment.childFragments[0].childFragments.length,
				lineBlockSize: result.fragment.childFragments[0].blockSize,
			};

			container.remove();
			return out;
		});

		// One flex line containing both items
		expect(result.childCount).toBe(1);
		expect(result.lineChildCount).toBe(2);
		// Tallest item (100) drives line height
		expect(result.lineBlockSize).toBe(100);
	});

	test("items fragment independently (parallel flows)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-request.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="display:flex;margin:0;padding:0">
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:50px;margin:0;padding:0"></div>
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
			const result = runLayoutGenerator(getLayoutAlgorithm(root), root, cs, null);

			const line = result.fragment.childFragments[0];
			const out = {
				lineBlockSize: line.blockSize,
				hasBreakToken: !!result.breakToken,
			};

			container.remove();
			return out;
		});

		expect(result.lineBlockSize).toBe(100);
		expect(result.hasBreakToken).toBe(true);
	});

	test("completed items get isAtBlockEnd tokens", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-request.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="display:flex;margin:0;padding:0">
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:50px;margin:0;padding:0"></div>
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
			const result = runLayoutGenerator(getLayoutAlgorithm(root), root, cs, null);

			const lineToken = result.breakToken.childBreakTokens[0];
			const itemTokens = lineToken.childBreakTokens;
			const completedCount = itemTokens.filter((t) => t.isAtBlockEnd).length;
			const brokeCount = itemTokens.filter((t) => !t.isAtBlockEnd).length;

			container.remove();
			return {
				hasLineToken: !!lineToken,
				completedCount,
				brokeCount,
			};
		});

		expect(result.hasLineToken).toBe(true);
		expect(result.completedCount).toBe(1);
		expect(result.brokeCount).toBe(1);
	});

	test("break token has kFlexData", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-request.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="display:flex;margin:0;padding:0">
        <div style="height:200px;margin:0;padding:0"></div>
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
			const result = runLayoutGenerator(getLayoutAlgorithm(root), root, cs, null);

			const out = {
				hasBreakToken: !!result.breakToken,
				algorithmDataType: result.breakToken?.algorithmData?.type ?? null,
			};

			container.remove();
			return out;
		});

		expect(result.hasBreakToken).toBe(true);
		expect(result.algorithmDataType).toBe("FlexData");
	});

	test("column flex uses flow thread (sequential fragmentation)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-request.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="display:flex;flex-direction:column;margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
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
			const result = runLayoutGenerator(getLayoutAlgorithm(root), root, cs, null);

			const out = {
				blockSize: result.fragment.blockSize,
				breakToken: result.breakToken,
			};

			container.remove();
			return out;
		});

		expect(result.blockSize).toBe(200);
		expect(result.breakToken).toBe(null);
	});

	test("column flex fragments across pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-request.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="display:flex;flex-direction:column;margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 150,
				fragmentainerBlockSize: 150,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "page",
			});
			const result = runLayoutGenerator(getLayoutAlgorithm(root), root, cs, null);

			const out = {
				hasBreakToken: !!result.breakToken,
				algorithmDataType: result.breakToken?.algorithmData?.type ?? null,
			};

			container.remove();
			return out;
		});

		expect(result.hasBreakToken).toBe(true);
		expect(result.algorithmDataType).toBe("FlexData");
	});

	test("empty flex container produces zero-height fragment", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-request.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = '<div style="display:flex;margin:0;padding:0"></div>';
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 400,
				fragmentainerBlockSize: 400,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const result = runLayoutGenerator(getLayoutAlgorithm(root), root, cs, null);

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

	test("does not infinitely recurse (flow thread pattern for column)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-request.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="display:flex;flex-direction:column;margin:0;padding:0">
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
			const result = runLayoutGenerator(getLayoutAlgorithm(root), root, cs, null);

			container.remove();
			return { hasFragment: !!result.fragment };
		});

		expect(result.hasFragment).toBe(true);
	});
});
