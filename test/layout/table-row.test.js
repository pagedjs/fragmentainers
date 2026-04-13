import { test, expect } from "../browser-fixture.js";

test.describe("Phase 6: Parallel flows (table row)", () => {
	test("lays out a table row where all cells fit", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator } = await import("/src/layout/layout-request.js");
			const { TableRowAlgorithm } = await import("/src/algorithms/table-row.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<table style="margin:0;padding:0;border-collapse:collapse;border-spacing:0">
        <tbody style="margin:0;padding:0">
          <tr style="margin:0;padding:0">
            <td style="margin:0;padding:0"><div style="height:50px;margin:0;padding:0"></div></td>
            <td style="margin:0;padding:0"><div style="height:80px;margin:0;padding:0"></div></td>
            <td style="margin:0;padding:0"><div style="height:30px;margin:0;padding:0"></div></td>
          </tr>
        </tbody>
      </table>`;
			document.body.appendChild(container);

			const tableNode = new DOMLayoutNode(container.firstElementChild);
			// table -> tbody -> tr
			const tbodyNode = tableNode.children[0];
			const rowNode = tbodyNode.children[0];

			const space = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800,
				fragmentainerBlockSize: 800,
				fragmentationType: "page",
			});
			const result = runLayoutGenerator(new TableRowAlgorithm(rowNode, space, null));

			const out = {
				blockSize: result.fragment.blockSize,
				childCount: result.fragment.childFragments.length,
				breakToken: result.breakToken,
			};

			container.remove();
			return out;
		});

		expect(result.blockSize).toBe(80);
		expect(result.childCount).toBe(3);
		expect(result.breakToken).toBe(null);
	});

	test("all cells get break tokens when any cell overflows", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator } = await import("/src/layout/layout-request.js");
			const { TableRowAlgorithm } = await import("/src/algorithms/table-row.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<table style="margin:0;padding:0;border-collapse:collapse;border-spacing:0">
        <tbody style="margin:0;padding:0">
          <tr style="margin:0;padding:0">
            <td style="margin:0;padding:0"><div style="height:100px;margin:0;padding:0"></div></td>
            <td style="margin:0;padding:0"><div style="height:300px;margin:0;padding:0"></div></td>
            <td style="margin:0;padding:0"><div style="height:50px;margin:0;padding:0"></div></td>
          </tr>
        </tbody>
      </table>`;
			document.body.appendChild(container);

			const tableNode = new DOMLayoutNode(container.firstElementChild);
			const tbodyNode = tableNode.children[0];
			const rowNode = tbodyNode.children[0];

			const space = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 200,
				fragmentainerBlockSize: 200,
				fragmentationType: "page",
			});
			const result = runLayoutGenerator(new TableRowAlgorithm(rowNode, space, null));

			const tokenA = result.breakToken.childBreakTokens[0];
			const tokenB = result.breakToken.childBreakTokens[1];
			const tokenC = result.breakToken.childBreakTokens[2];

			const out = {
				hasBreakToken: !!result.breakToken,
				childBreakTokenCount: result.breakToken.childBreakTokens.length,
				algorithmDataType: result.breakToken.algorithmData.type,
				tokenAIsAtBlockEnd: tokenA.isAtBlockEnd,
				tokenAHasSeenAllChildren: tokenA.hasSeenAllChildren,
				tokenCIsAtBlockEnd: tokenC.isAtBlockEnd,
				tokenBIsAtBlockEnd: tokenB.isAtBlockEnd,
				tokenBConsumedPositive: tokenB.consumedBlockSize > 0,
			};

			container.remove();
			return out;
		});

		expect(result.hasBreakToken).toBe(true);
		expect(result.childBreakTokenCount).toBe(3);
		expect(result.algorithmDataType).toBe("TableRowData");
		expect(result.tokenAIsAtBlockEnd).toBe(true);
		expect(result.tokenAHasSeenAllChildren).toBe(true);
		expect(result.tokenCIsAtBlockEnd).toBe(true);
		expect(result.tokenBIsAtBlockEnd).toBe(false);
		expect(result.tokenBConsumedPositive).toBe(true);
	});

	test("resumes correctly with completed cells producing zero-height fragments", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <table style="margin:0;padding:0;border-collapse:collapse;border-spacing:0">
          <tbody style="margin:0;padding:0">
            <tr style="margin:0;padding:0">
              <td style="margin:0;padding:0"><div style="height:100px;margin:0;padding:0"></div></td>
              <td style="margin:0;padding:0"><div style="height:300px;margin:0;padding:0"></div></td>
              <td style="margin:0;padding:0"><div style="height:50px;margin:0;padding:0"></div></td>
            </tr>
          </tbody>
        </table>
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
				p0BlockSize: pages[0].blockSize,
				p1BlockSizePositive: pages[1].blockSize > 0,
				p1BreakToken: pages[1].breakToken,
			};

			container.remove();
			return out;
		});

		expect(result.pageCount).toBeGreaterThanOrEqual(2);
		expect(result.p0BlockSize).toBeGreaterThan(0);
		expect(result.p1BlockSizePositive).toBe(true);
		expect(result.p1BreakToken).toBe(null);
	});

	test("row height is driven by tallest cell", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator } = await import("/src/layout/layout-request.js");
			const { TableRowAlgorithm } = await import("/src/algorithms/table-row.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<table style="margin:0;padding:0;border-collapse:collapse;border-spacing:0">
        <tbody style="margin:0;padding:0">
          <tr style="margin:0;padding:0">
            <td style="margin:0;padding:0"><div style="height:20px;margin:0;padding:0"></div></td>
            <td style="margin:0;padding:0"><div style="height:150px;margin:0;padding:0"></div></td>
          </tr>
        </tbody>
      </table>`;
			document.body.appendChild(container);

			const tableNode = new DOMLayoutNode(container.firstElementChild);
			const tbodyNode = tableNode.children[0];
			const rowNode = tbodyNode.children[0];

			const space = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 800,
				fragmentainerBlockSize: 800,
				fragmentationType: "page",
			});
			const result = runLayoutGenerator(new TableRowAlgorithm(rowNode, space, null));

			container.remove();
			return { blockSize: result.fragment.blockSize };
		});

		expect(result.blockSize).toBe(150);
	});
});
