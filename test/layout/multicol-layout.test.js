import { test, expect } from "../browser-fixture.js";

test.describe("layoutMulticolContainer", () => {
	test("dispatches multicol nodes to the multicol algorithm", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getLayoutAlgorithm } = await import("/src/core/layout-request.js");
			const { layoutMulticolContainer } = await import("/src/layout/multicol-container.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = '<div style="column-count:2;column-gap:0;margin:0;padding:0"></div>';
			document.body.appendChild(container);

			const node = buildLayoutTree(container.firstElementChild);
			const algoName = getLayoutAlgorithm(node).name;

			container.remove();
			return { algoName, expectedName: layoutMulticolContainer.name };
		});

		expect(result.algoName).toBe(result.expectedName);
	});

	test("does not dispatch non-multicol nodes to multicol", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getLayoutAlgorithm } = await import("/src/core/layout-request.js");
			const { layoutMulticolContainer } = await import("/src/layout/multicol-container.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = '<div style="margin:0;padding:0"></div>';
			document.body.appendChild(container);

			const node = buildLayoutTree(container.firstElementChild);
			const algoName = getLayoutAlgorithm(node).name;

			container.remove();
			return { algoName, multicolName: layoutMulticolContainer.name };
		});

		expect(result.algoName).not.toBe(result.multicolName);
	});

	test("lays out content across 2 columns", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="column-count:2;column-gap:0;margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 100,
				fragmentainerBlockSize: 100,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const result = runLayoutGenerator(getLayoutAlgorithm(root), root, cs, null);

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
				await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="column-count:2;column-gap:0;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 200,
				fragmentainerBlockSize: 200,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const result = runLayoutGenerator(getLayoutAlgorithm(root), root, cs, null);

			container.remove();
			return { columnCount: result.fragment.childFragments.length };
		});

		expect(result.columnCount).toBe(1);
	});

	test("content flows across 3 columns", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="column-count:3;column-gap:0;margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 100,
				fragmentainerBlockSize: 100,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const result = runLayoutGenerator(getLayoutAlgorithm(root), root, cs, null);

			container.remove();
			return { columnCount: result.fragment.childFragments.length };
		});

		expect(result.columnCount).toBe(3);
	});

	test("respects column-fill: auto - stops at column count", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="column-count:2;column-gap:0;column-fill:auto;margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 100,
				fragmentainerBlockSize: 100,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const result = runLayoutGenerator(getLayoutAlgorithm(root), root, cs, null);

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

	test("resolves column width correctly with gap", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:620px";
			container.innerHTML = `<div style="column-count:2;column-gap:20px;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 620,
				availableBlockSize: 200,
				fragmentainerBlockSize: 200,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const result = runLayoutGenerator(getLayoutAlgorithm(root), root, cs, null);

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
				await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:640px";
			container.innerHTML = `<div style="column-count:3;column-gap:10px;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 640,
				availableBlockSize: 200,
				fragmentainerBlockSize: 200,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const result = runLayoutGenerator(getLayoutAlgorithm(root), root, cs, null);

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
				await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="column-count:3;column-gap:0;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
        <div style="height:50px;break-before:column;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 200,
				fragmentainerBlockSize: 200,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const result = runLayoutGenerator(getLayoutAlgorithm(root), root, cs, null);

			container.remove();
			return { columnCount: result.fragment.childFragments.length };
		});

		expect(result.columnCount).toBe(2);
	});

	test("emits break token with kMulticolData when nested in outer context", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator } = await import("/src/core/layout-request.js");
			const { layoutMulticolContainer } = await import("/src/layout/multicol-container.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="column-count:2;column-gap:0;column-fill:auto;margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 100,
				fragmentainerBlockSize: 100,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "page",
			});
			const result = runLayoutGenerator(layoutMulticolContainer, root, cs, null);

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
				await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="column-count:2;column-gap:0;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 200,
				fragmentainerBlockSize: 200,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const result = runLayoutGenerator(getLayoutAlgorithm(root), root, cs, null);

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
				await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { buildLayoutTree } = await import("/src/dom/index.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:800px";
			container.innerHTML = `<div style="column-count:2;column-gap:0;margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = buildLayoutTree(container.firstElementChild);
			const cs = new ConstraintSpace({
				availableInlineSize: 800,
				availableBlockSize: 200,
				fragmentainerBlockSize: 200,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "none",
			});
			const result = runLayoutGenerator(getLayoutAlgorithm(root), root, cs, null);

			container.remove();
			return { inlineSize: result.fragment.inlineSize };
		});

		expect(result.inlineSize).toBe(800);
	});
});
