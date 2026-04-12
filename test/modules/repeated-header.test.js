import { test, expect } from "../browser-fixture.js";

test.describe("RepeatedTableHeader.beforeChildren", () => {
	test("returns layout request for thead on table continuation", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { RepeatedTableHeader } = await import("/src/modules/repeated-header.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `
        <table style="border-collapse:collapse;margin:0;padding:0">
          <thead><tr><td style="height:40px;margin:0;padding:0">Header</td></tr></thead>
          <tbody><tr><td style="height:100px;margin:0;padding:0">Row</td></tr></tbody>
        </table>`;
			document.body.appendChild(container);
			const tableNode = new DOMLayoutNode(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 300,
				fragmentainerBlockSize: 300,
				fragmentationType: FRAGMENTATION_PAGE,
			});

			const breakToken = new BlockBreakToken(tableNode);
			const mod = new RepeatedTableHeader();
			const res = mod.beforeChildren(tableNode, cs, breakToken);

			container.remove();
			return {
				notNull: res !== null,
				isRepeated: res ? res.isRepeated : null,
				nodeIsThead: res ? res.node.isTableHeaderGroup : null,
			};
		});
		expect(result.notNull).toBe(true);
		expect(result.isRepeated).toBe(true);
		expect(result.nodeIsThead).toBe(true);
	});

	test("returns null when there is no break token", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { RepeatedTableHeader } = await import("/src/modules/repeated-header.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `
        <table style="border-collapse:collapse;margin:0;padding:0">
          <thead><tr><td style="height:40px;margin:0;padding:0">Header</td></tr></thead>
          <tbody><tr><td style="height:100px;margin:0;padding:0">Row</td></tr></tbody>
        </table>`;
			document.body.appendChild(container);
			const tableNode = new DOMLayoutNode(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 300,
				fragmentainerBlockSize: 300,
				fragmentationType: FRAGMENTATION_PAGE,
			});

			const mod = new RepeatedTableHeader();
			const res = mod.beforeChildren(tableNode, cs, null);
			container.remove();
			return { isNull: res === null };
		});
		expect(result.isNull).toBe(true);
	});

	test("returns null for non-table nodes", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { RepeatedTableHeader } = await import("/src/modules/repeated-header.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = new DOMLayoutNode(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 300,
				fragmentainerBlockSize: 300,
				fragmentationType: FRAGMENTATION_PAGE,
			});

			const breakToken = new BlockBreakToken(root, 0, 100, []);
			const mod = new RepeatedTableHeader();
			const res = mod.beforeChildren(root, cs, breakToken);
			container.remove();
			return { isNull: res === null };
		});
		expect(result.isNull).toBe(true);
	});

	test("returns null in column fragmentation mode", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { FRAGMENTATION_COLUMN } = await import("/src/fragmentation/constraint-space.js");
			const { RepeatedTableHeader } = await import("/src/modules/repeated-header.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `
        <table style="border-collapse:collapse;margin:0;padding:0">
          <thead><tr><td style="height:40px;margin:0;padding:0">Header</td></tr></thead>
          <tbody><tr><td style="height:100px;margin:0;padding:0">Row</td></tr></tbody>
        </table>`;
			document.body.appendChild(container);
			const tableNode = new DOMLayoutNode(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 300,
				fragmentainerBlockSize: 300,
				fragmentationType: FRAGMENTATION_COLUMN,
			});

			const breakToken = new BlockBreakToken(tableNode);
			const mod = new RepeatedTableHeader();
			const res = mod.beforeChildren(tableNode, cs, breakToken);
			container.remove();
			return { isNull: res === null };
		});
		expect(result.isNull).toBe(true);
	});

	test("returns null when thead has an active break token", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { RepeatedTableHeader } = await import("/src/modules/repeated-header.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `
        <table style="border-collapse:collapse;margin:0;padding:0">
          <thead><tr><td style="height:40px;margin:0;padding:0">Header</td></tr></thead>
          <tbody><tr><td style="height:100px;margin:0;padding:0">Row</td></tr></tbody>
        </table>`;
			document.body.appendChild(container);
			const tableNode = new DOMLayoutNode(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 300,
				fragmentainerBlockSize: 300,
				fragmentationType: FRAGMENTATION_PAGE,
			});

			const thead = tableNode.children.find((c) => c.isTableHeaderGroup);
			const theadBT = new BlockBreakToken(thead);
			const breakToken = new BlockBreakToken(tableNode);
			breakToken.childBreakTokens = [theadBT];

			const mod = new RepeatedTableHeader();
			const res = mod.beforeChildren(tableNode, cs, breakToken);
			container.remove();
			return { isNull: res === null };
		});
		expect(result.isNull).toBe(true);
	});

	test("returns null when table has no thead", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { RepeatedTableHeader } = await import("/src/modules/repeated-header.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `
        <table style="border-collapse:collapse;margin:0;padding:0">
          <tbody>
            <tr><td style="height:100px;margin:0;padding:0">Row 1</td></tr>
            <tr><td style="height:100px;margin:0;padding:0">Row 2</td></tr>
          </tbody>
        </table>`;
			document.body.appendChild(container);
			const tableNode = new DOMLayoutNode(container.firstElementChild);

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 300,
				fragmentainerBlockSize: 300,
				fragmentationType: FRAGMENTATION_PAGE,
			});

			const breakToken = new BlockBreakToken(tableNode);
			const mod = new RepeatedTableHeader();
			const res = mod.beforeChildren(tableNode, cs, breakToken);
			container.remove();
			return { isNull: res === null };
		});
		expect(result.isNull).toBe(true);
	});
});
