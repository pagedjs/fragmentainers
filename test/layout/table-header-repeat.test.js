import { test, expect } from "../browser-fixture.js";

test.describe("Repeating table headers", () => {
	test("repeats thead on page 2 when table breaks across pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { blockNode, tableNode, tableHeaderNode } = await import("/test/fixtures/nodes.js");

			const thead = tableHeaderNode({
				children: [blockNode({ debugName: "header-row", blockSize: 40 })],
			});
			const table = tableNode({
				children: [
					thead,
					blockNode({ debugName: "row1", blockSize: 100 }),
					blockNode({ debugName: "row2", blockSize: 100 }),
					blockNode({ debugName: "row3", blockSize: 100 }),
				],
			});
			const root = blockNode({ children: [table] });

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 250,
					fragmentainerBlockSize: 250,
					fragmentationType: "page",
				}),
			);

			const page2Table = pages[1].childFragments[0];
			const repeatedHeader = page2Table.childFragments[0];
			return {
				length: pages.length,
				page2TableDefined: !!page2Table,
				isRepeated: repeatedHeader.isRepeated,
				blockSize: repeatedHeader.blockSize,
			};
		});
		expect(result.length).toBe(2);
		expect(result.page2TableDefined).toBe(true);
		expect(result.isRepeated).toBe(true);
		expect(result.blockSize).toBe(40);
	});

	test("does not repeat when table fits on one page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { blockNode, tableNode, tableHeaderNode } = await import("/test/fixtures/nodes.js");

			const thead = tableHeaderNode({
				children: [blockNode({ debugName: "header-row", blockSize: 40 })],
			});
			const table = tableNode({
				children: [thead, blockNode({ debugName: "row1", blockSize: 50 })],
			});
			const root = blockNode({ children: [table] });

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 300,
					fragmentainerBlockSize: 300,
					fragmentationType: "page",
				}),
			);

			const tableFragment = pages[0].childFragments[0];
			const anyRepeated = tableFragment.childFragments.some((c) => c.isRepeated);
			return { length: pages.length, anyRepeated };
		});
		expect(result.length).toBe(1);
		expect(result.anyRepeated).toBe(false);
	});

	test("does not repeat thead in column fragmentation mode", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { blockNode, tableNode, tableHeaderNode } = await import("/test/fixtures/nodes.js");

			const thead = tableHeaderNode({
				children: [blockNode({ debugName: "header-row", blockSize: 40 })],
			});
			const table = tableNode({
				children: [
					thead,
					blockNode({ debugName: "row1", blockSize: 100 }),
					blockNode({ debugName: "row2", blockSize: 100 }),
					blockNode({ debugName: "row3", blockSize: 100 }),
				],
			});
			const root = blockNode({ children: [table] });

			const space = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 250,
				fragmentainerBlockSize: 250,
				fragmentationType: "column",
			});
			const pages = createFragments(root, space);

			let anyRepeated = false;
			for (let p = 1; p < pages.length; p++) {
				const tableFragment = pages[p].childFragments[0];
				if (tableFragment) {
					for (const child of tableFragment.childFragments) {
						if (child.isRepeated) anyRepeated = true;
					}
				}
			}
			return { length: pages.length, anyRepeated };
		});
		expect(result.length).toBeGreaterThan(1);
		expect(result.anyRepeated).toBe(false);
	});

	test("does not repeat when table has no thead", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { blockNode, tableNode } = await import("/test/fixtures/nodes.js");

			const table = tableNode({
				children: [
					blockNode({ debugName: "row1", blockSize: 100 }),
					blockNode({ debugName: "row2", blockSize: 100 }),
					blockNode({ debugName: "row3", blockSize: 100 }),
				],
			});
			const root = blockNode({ children: [table] });

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 250,
					fragmentainerBlockSize: 250,
					fragmentationType: "page",
				}),
			);

			const page2Table = pages[1].childFragments[0];
			const anyRepeated = page2Table.childFragments.some((c) => c.isRepeated);
			return { length: pages.length, anyRepeated };
		});
		expect(result.length).toBe(2);
		expect(result.anyRepeated).toBe(false);
	});

	test("repeats thead even when it is tall", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { blockNode, tableNode, tableHeaderNode } = await import("/test/fixtures/nodes.js");

			const thead = tableHeaderNode({
				children: [blockNode({ debugName: "header-row", blockSize: 120 })],
			});
			const table = tableNode({
				children: [
					thead,
					blockNode({ debugName: "row1", blockSize: 100 }),
					blockNode({ debugName: "row2", blockSize: 100 }),
					blockNode({ debugName: "row3", blockSize: 100 }),
				],
			});
			const root = blockNode({ children: [table] });

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 300,
					fragmentainerBlockSize: 300,
					fragmentationType: "page",
				}),
			);

			const page2Table = pages[1].childFragments[0];
			const repeatedHeader = page2Table.childFragments[0];
			return {
				length: pages.length,
				isRepeated: repeatedHeader.isRepeated,
				blockSize: repeatedHeader.blockSize,
			};
		});
		expect(result.length).toBeGreaterThan(1);
		expect(result.isRepeated).toBe(true);
		expect(result.blockSize).toBe(120);
	});

	test("repeats thead on every continuation page across multiple pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { blockNode, tableNode, tableHeaderNode } = await import("/test/fixtures/nodes.js");

			const thead = tableHeaderNode({
				children: [blockNode({ debugName: "header-row", blockSize: 30 })],
			});
			const rows = [];
			for (let i = 0; i < 10; i++) {
				rows.push(blockNode({ debugName: `row${i}`, blockSize: 50 }));
			}
			const table = tableNode({
				children: [thead, ...rows],
			});
			const root = blockNode({ children: [table] });

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 150,
					fragmentainerBlockSize: 150,
					fragmentationType: "page",
				}),
			);

			const results = [];
			for (let p = 1; p < pages.length; p++) {
				const tableFragment = pages[p].childFragments[0];
				const firstChild = tableFragment.childFragments[0];
				results.push(firstChild.isRepeated);
			}
			return { length: pages.length, allRepeated: results.every((r) => r) };
		});
		expect(result.length).toBeGreaterThan(2);
		expect(result.allRepeated).toBe(true);
	});

	test("hasSeenAllChildren is correct when repeated header is present", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { blockNode, tableNode, tableHeaderNode } = await import("/test/fixtures/nodes.js");

			const thead = tableHeaderNode({
				children: [blockNode({ debugName: "header-row", blockSize: 30 })],
			});
			const table = tableNode({
				children: [
					thead,
					blockNode({ debugName: "row1", blockSize: 100 }),
					blockNode({ debugName: "row2", blockSize: 100 }),
					blockNode({ debugName: "row3", blockSize: 100 }),
				],
			});
			const root = blockNode({ children: [table] });

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 160,
					fragmentainerBlockSize: 160,
					fragmentationType: "page",
				}),
			);

			const page2Table = pages[1].childFragments[0];
			const page3Table = pages[2].childFragments[0];
			return {
				length: pages.length,
				page2HasBreakToken: page2Table.breakToken !== null,
				page3HasBreakToken: page3Table.breakToken !== null,
			};
		});
		expect(result.length).toBe(3);
		expect(result.page2HasBreakToken).toBe(true);
		expect(result.page3HasBreakToken).toBe(false);
	});

	test("reduces available space for body content by header height", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { blockNode, tableNode, tableHeaderNode } = await import("/test/fixtures/nodes.js");

			const thead = tableHeaderNode({
				children: [blockNode({ debugName: "header-row", blockSize: 60 })],
			});
			const table = tableNode({
				children: [
					thead,
					blockNode({ debugName: "row1", blockSize: 80 }),
					blockNode({ debugName: "row2", blockSize: 80 }),
					blockNode({ debugName: "row3", blockSize: 80 }),
				],
			});
			const root = blockNode({ children: [table] });

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

			const page2Table = pages[1].childFragments[0];
			const repeated = page2Table.childFragments[0];
			return {
				length: pages.length,
				isRepeated: repeated.isRepeated,
				blockSize: repeated.blockSize,
			};
		});
		expect(result.length).toBeGreaterThan(1);
		expect(result.isRepeated).toBe(true);
		expect(result.blockSize).toBe(60);
	});
});

test.describe("break-inside: avoid push for tables", () => {
	test("pushes a break-inside:avoid table that does not fit to the next page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { blockNode, tableNode } = await import("/test/fixtures/nodes.js");

			const table = tableNode({
				blockSize: 200,
				breakInside: "avoid",
				children: [
					blockNode({ debugName: "row1", blockSize: 80 }),
					blockNode({ debugName: "row2", blockSize: 80 }),
				],
			});
			const root = blockNode({
				children: [blockNode({ debugName: "para", blockSize: 200 }), table],
			});

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 300,
					fragmentainerBlockSize: 300,
					fragmentationType: "page",
				}),
			);

			return {
				length: pages.length,
				page1ChildCount: pages[0].childFragments.length,
				page1ChildName: pages[0].childFragments[0].node.debugName,
				page2IsTable: pages[1].childFragments[0].node.isTable,
			};
		});
		expect(result.length).toBe(2);
		expect(result.page1ChildCount).toBe(1);
		expect(result.page1ChildName).toBe("para");
		expect(result.page2IsTable).toBe(true);
	});

	test("does not push when table is the first element on the page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { blockNode, tableNode } = await import("/test/fixtures/nodes.js");

			const table = tableNode({
				blockSize: 500,
				breakInside: "avoid",
				children: [
					blockNode({ debugName: "row1", blockSize: 200 }),
					blockNode({ debugName: "row2", blockSize: 200 }),
				],
			});
			const root = blockNode({ children: [table] });

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 300,
					fragmentainerBlockSize: 300,
					fragmentationType: "page",
				}),
			);

			return {
				length: pages.length,
				page1IsTable: pages[0].childFragments[0].node.isTable,
				page1BlockSize: pages[0].blockSize,
			};
		});
		expect(result.length).toBeGreaterThan(1);
		expect(result.page1IsTable).toBe(true);
		expect(result.page1BlockSize).toBeGreaterThan(0);
	});

	test("does not push when table fits in remaining space", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/core/layout-request.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");
			const { blockNode, tableNode } = await import("/test/fixtures/nodes.js");

			const table = tableNode({
				blockSize: 80,
				breakInside: "avoid",
				children: [
					blockNode({ debugName: "row1", blockSize: 40 }),
					blockNode({ debugName: "row2", blockSize: 40 }),
				],
			});
			const root = blockNode({
				children: [blockNode({ debugName: "para", blockSize: 100 }), table],
			});

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 300,
					fragmentainerBlockSize: 300,
					fragmentationType: "page",
				}),
			);
			return pages.length;
		});
		expect(result).toBe(1);
	});
});

test.describe("Repeating table headers (browser)", () => {
	test("repeats thead in each fragment after the first", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");

			const template = document.createElement("template");
			template.innerHTML = `
        <table style="border-collapse: collapse; margin: 0; padding: 0;">
          <thead><tr><th style="height: 30px; margin: 0; padding: 0;">Header</th></tr></thead>
          <tbody>
            <tr><td style="height: 80px; margin: 0; padding: 0;">Row 1</td></tr>
            <tr><td style="height: 80px; margin: 0; padding: 0;">Row 2</td></tr>
            <tr><td style="height: 80px; margin: 0; padding: 0;">Row 3</td></tr>
            <tr><td style="height: 80px; margin: 0; padding: 0;">Row 4</td></tr>
          </tbody>
        </table>
      `;
			const layout = new FragmentedFlow(template.content, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			});
			const flow = layout.flow();

			const results = [];
			for (let i = 1; i < flow.fragments.length; i++) {
				const tableFragment = flow.fragments[i].childFragments[0];
				const firstChild = tableFragment.childFragments[0];
				results.push(firstChild.isRepeated);
			}
			layout.destroy();
			return {
				count: flow.fragmentainerCount,
				allRepeated: results.every((r) => r),
			};
		});
		expect(result.count).toBeGreaterThan(1);
		expect(result.allRepeated).toBe(true);
	});

	test("does not repeat thead when table fits on one page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");

			const template = document.createElement("template");
			template.innerHTML = `
        <table style="border-collapse: collapse; margin: 0; padding: 0;">
          <thead><tr><th style="height: 30px; margin: 0; padding: 0;">Header</th></tr></thead>
          <tbody>
            <tr><td style="height: 40px; margin: 0; padding: 0;">Row 1</td></tr>
          </tbody>
        </table>
      `;
			const layout = new FragmentedFlow(template.content, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			});
			const flow = layout.flow();

			const tableFragment = flow.fragments[0].childFragments[0];
			const anyRepeated = tableFragment.childFragments.some((c) => c.isRepeated);
			layout.destroy();
			return { count: flow.fragmentainerCount, anyRepeated };
		});
		expect(result.count).toBe(1);
		expect(result.anyRepeated).toBe(false);
	});

	test("repeated header uses measured DOM height for accurate space accounting", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");

			const template = document.createElement("template");
			template.innerHTML = `
        <table style="border-collapse: collapse; margin: 0; padding: 0;">
          <thead>
            <tr><th style="font-size: 10px; line-height: 10px; padding: 8px 0; margin: 0;">Header</th></tr>
          </thead>
          <tbody>
            <tr><td style="height: 80px; margin: 0; padding: 0;">Row 1</td></tr>
            <tr><td style="height: 80px; margin: 0; padding: 0;">Row 2</td></tr>
            <tr><td style="height: 80px; margin: 0; padding: 0;">Row 3</td></tr>
          </tbody>
        </table>
      `;
			const layout = new FragmentedFlow(template.content, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			});
			const flow = layout.flow();

			const page2 = flow.fragments[1];
			const tableFragment = page2.childFragments[0];
			const repeated = tableFragment.childFragments[0];
			layout.destroy();
			return {
				count: flow.fragmentainerCount,
				isRepeated: repeated.isRepeated,
				blockSize: repeated.blockSize,
			};
		});
		expect(result.count).toBeGreaterThan(1);
		expect(result.isRepeated).toBe(true);
		expect(result.blockSize).toBeGreaterThan(10);
	});

	test("repeated header reduces available space for body content", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");

			const template = document.createElement("template");
			template.innerHTML = `
        <table style="border-collapse: collapse; margin: 0; padding: 0;">
          <thead><tr><th style="height: 50px; margin: 0; padding: 0;">Header</th></tr></thead>
          <tbody>
            <tr><td style="height: 100px; margin: 0; padding: 0;">Row 1</td></tr>
            <tr><td style="height: 100px; margin: 0; padding: 0;">Row 2</td></tr>
            <tr><td style="height: 100px; margin: 0; padding: 0;">Row 3</td></tr>
          </tbody>
        </table>
      `;
			const layout = new FragmentedFlow(template.content, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			});
			const flow = layout.flow();

			const results = [];
			for (let i = 1; i < flow.fragments.length; i++) {
				const tableFragment = flow.fragments[i].childFragments[0];
				const repeated = tableFragment.childFragments[0];
				results.push({ isRepeated: repeated.isRepeated, blockSize: repeated.blockSize });
			}
			layout.destroy();
			return results;
		});
		for (const r of result) {
			expect(r.isRepeated).toBe(true);
			expect(r.blockSize).toBeGreaterThan(0);
		}
	});

	test("hasSeenAllChildren is correct across multi-page table with repeated header", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");

			const template = document.createElement("template");
			template.innerHTML = `
        <table style="border-collapse: collapse; margin: 0; padding: 0;">
          <thead><tr><th style="height: 20px; margin: 0; padding: 0;">Header</th></tr></thead>
          <tbody>
            <tr><td style="height: 60px; margin: 0; padding: 0;">Row 1</td></tr>
            <tr><td style="height: 60px; margin: 0; padding: 0;">Row 2</td></tr>
            <tr><td style="height: 60px; margin: 0; padding: 0;">Row 3</td></tr>
          </tbody>
        </table>
      `;
			const layout = new FragmentedFlow(template.content, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 100,
					fragmentainerBlockSize: 100,
					fragmentationType: "page",
				}),
			});
			const flow = layout.flow();

			const lastFragment = flow.fragments[flow.fragments.length - 1];
			const middleBreakTokens = [];
			for (let i = 0; i < flow.fragments.length - 1; i++) {
				middleBreakTokens.push(flow.fragments[i].breakToken !== null);
			}
			layout.destroy();
			return {
				count: flow.fragmentainerCount,
				lastBreakTokenNull: lastFragment.breakToken === null,
				allMiddleHaveBreakTokens: middleBreakTokens.every((b) => b),
			};
		});
		expect(result.count).toBeGreaterThan(1);
		expect(result.lastBreakTokenNull).toBe(true);
		expect(result.allMiddleHaveBreakTokens).toBe(true);
	});
});

test.describe("break-inside: avoid push for tables (browser)", () => {
	test("pushes a break-inside:avoid table when it does not fit at page bottom", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");

			const template = document.createElement("template");
			template.innerHTML = `
        <div style="margin: 0; padding: 0;">
          <div style="height: 160px; margin: 0; padding: 0;">Filler</div>
          <table style="break-inside: avoid; border-collapse: collapse; margin: 0; padding: 0;">
            <tr><td style="height: 60px; margin: 0; padding: 0;">Row 1</td></tr>
            <tr><td style="height: 60px; margin: 0; padding: 0;">Row 2</td></tr>
          </table>
        </div>
      `;
			const layout = new FragmentedFlow(template.content, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			});
			const flow = layout.flow();

			const page1 = flow.fragments[0];
			const page2 = flow.fragments[1];
			const wrapper = page2.childFragments[0];
			const tableFragment = wrapper.childFragments[0];
			layout.destroy();
			return {
				count: flow.fragmentainerCount,
				page1ChildCount: page1.childFragments[0].childFragments.length,
				isTable: tableFragment.node.isTable,
			};
		});
		expect(result.count).toBe(2);
		expect(result.page1ChildCount).toBe(1);
		expect(result.isTable).toBe(true);
	});

	test("does not push when break-inside:avoid table fits in remaining space", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
			const { ConstraintSpace } = await import("/src/core/constraint-space.js");

			const template = document.createElement("template");
			template.innerHTML = `
        <div style="margin: 0; padding: 0;">
          <div style="height: 50px; margin: 0; padding: 0;">Filler</div>
          <table style="break-inside: avoid; border-collapse: collapse; margin: 0; padding: 0;">
            <tr><td style="height: 40px; margin: 0; padding: 0;">Row 1</td></tr>
          </table>
        </div>
      `;
			const layout = new FragmentedFlow(template.content, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			});
			const flow = layout.flow();
			layout.destroy();
			return flow.fragmentainerCount;
		});
		expect(result).toBe(1);
	});
});
