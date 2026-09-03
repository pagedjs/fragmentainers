import { test, expect } from "../browser-fixture.js";

const TABLE_STYLE = "border-collapse:collapse;border-spacing:0;margin:0;padding:0;width:400px";
const CELL_STYLE = "margin:0;padding:0;vertical-align:top";

function cellParts(count, height, prefix = "LONG", extraStyle = "") {
	return Array.from({ length: count }, (_, index) =>
		`<div style="height:${height}px;margin:0;padding:0;${extraStyle}">${prefix}-${index + 1} </div>`).join("");
}

function tableRows(body, headerStyle = "") {
	return `<table style="${TABLE_STYLE}">
		<thead style="${headerStyle}"><tr><th style="${CELL_STYLE};height:40px">HEADER</th></tr></thead>
		<tbody>${body}</tbody>
	</table>`;
}

async function paginate(page, html, { firstHeight = 200, height = firstHeight, type = "page" } = {}) {
	return page.evaluate(async ({ html, firstHeight, height, type }) => {
		const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
		const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
		const { PageResolver, PageRule } = await import("/src/resolvers/page-resolver.js");
		const template = document.createElement("template");
		template.innerHTML = `<div style="margin:0;padding:0;font:16px/20px monospace">${html}</div>`;
		const sourceCells = Array.from(template.content.querySelectorAll("[data-cell]"), (cell) => ({
			id: cell.dataset.cell,
			text: cell.textContent.replace(/\s+/g, ""),
		}));
		const options = firstHeight === height ? {
			constraintSpace: new ConstraintSpace({
				availableInlineSize: 400,
				availableBlockSize: height,
				fragmentainerBlockSize: height,
				fragmentationType: type,
			}),
		} : {
			resolver: new PageResolver([
				new PageRule({ size: `400px ${height}px`, margin: { top: "0", right: "0", bottom: "0", left: "0" } }),
				new PageRule({ pseudo: ["first"], size: `400px ${firstHeight}px` }),
			]),
		};
		const flow = new Fragmenter(template.content, options);
		const elements = [];
		let completed = false;
		try {
			// Fixed bound: a non-progressing header retry must fail without hanging Chromium.
			for (let call = 0; call < 8; call++) {
				const step = flow.next();
				if (step.done) {
					completed = true;
					break;
				}
				document.body.appendChild(step.value);
				elements.push(step.value);
			}
			const fragments = flow.fragments;
			return {
				completed,
				finalBreakToken: fragments.at(-1)?.breakToken === null ? null : "continuation",
				pageHeights: fragments.map((fragment) => fragment.constraints?.contentArea.blockSize ?? null),
				pages: elements.map((element) => ({
					text: element.textContent.replace(/\s+/g, ""),
					headers: element.querySelectorAll("thead").length,
					bodyText: Array.from(element.querySelectorAll("tbody"), (body) => body.textContent).join("").trim(),
					cells: Array.from(element.querySelectorAll("[data-cell]"), (cell) => ({
						id: cell.dataset.cell,
						text: cell.textContent.replace(/\s+/g, ""),
						height: cell.getBoundingClientRect().height,
					})),
				})),
				conservation: sourceCells.map(({ id, text }) => ({
					id,
					source: text,
					output: elements.flatMap((element) => Array.from(
						element.querySelectorAll(`[data-cell="${id}"]`),
						(cell) => cell.textContent.replace(/\s+/g, ""),
					)).join(""),
				})),
			};
		} finally {
			flow.destroy();
			for (const element of elements) element.remove();
		}
	}, { html, firstHeight, height, type });
}

function expectCompleted(result) {
	expect(result.completed).toBe(true);
	expect(result.finalBreakToken).toBe(null);
	for (const cell of result.conservation) {
		expect(cell.output, `ordered text for ${cell.id}`).toBe(cell.source);
	}
}

test.describe("Table row break scores", () => {
	for (const scenario of [
		{ name: "row avoidance penalizes an in-flow split", rowAvoid: "avoid", type: "page", cells: [{ score: 0, continues: true }], expected: 2 },
		{ name: "worst continuing cell wins", rowAvoid: "auto", type: "page", cells: [{ score: 1, continues: true }, { score: 2, continues: true }], expected: 2 },
		{ name: "missing continuing cell scores default to perfect", rowAvoid: "auto", type: "page", cells: [{ continues: true }], expected: 0 },
		{ name: "a completed avoided row has a perfect score", rowAvoid: "avoid", type: "page", cells: [{ score: 0, continues: null }], expected: 0 },
		{ name: "completed cell scores do not penalize another cell", rowAvoid: "auto", type: "page", cells: [{ score: 3, continues: null }, { score: 0, continues: true }], expected: 0 },
		{ name: "overflow-only continuations do not penalize the row", rowAvoid: "avoid", type: "page", cells: [{ score: 3, continues: false }, { score: 2, continues: null }], expected: 0 },
		{ name: "overflow-only scores do not override an in-flow cell score", rowAvoid: "auto", type: "page", cells: [{ score: 3, continues: false }, { score: 1, continues: true }], expected: 1 },
		{ name: "row avoidance preserves a worse cell score", rowAvoid: "avoid", type: "page", cells: [{ score: 3, continues: true }], expected: 3 },
		{ name: "avoid-page applies to pages", rowAvoid: "avoid-page", type: "page", cells: [{ score: 0, continues: true }], expected: 2 },
		{ name: "avoid-page does not apply to columns", rowAvoid: "avoid-page", type: "column", cells: [{ score: 0, continues: true }], expected: 0 },
		{ name: "avoid-column applies to columns", rowAvoid: "avoid-column", type: "column", cells: [{ score: 0, continues: true }], expected: 2 },
		{ name: "avoid-column does not apply to pages", rowAvoid: "avoid-column", type: "page", cells: [{ score: 0, continues: true }], expected: 0 },
		...[1, 2, 3].flatMap((score) => ["auto", "avoid"].flatMap((rowAvoid) => [false, true].map((forcedFirst) => ({
			name: `${rowAvoid} row preserves unforced score ${score} with forced cell ${forcedFirst ? "first" : "last"}`,
			rowAvoid,
			type: "page",
			cells: forcedFirst
				? [{ score: 0, continues: true, forced: true }, { score, continues: true }]
				: [{ score, continues: true }, { score: 0, continues: true, forced: true }],
			expected: rowAvoid === "avoid" ? Math.max(score, 2) : score,
		})))),
		{ name: "all forced cells override row avoidance", rowAvoid: "avoid", type: "page", cells: [{ score: 2, continues: true, forced: true }, { score: 3, continues: true, forced: true }], expected: 0 },
		{ name: "forced-only in-flow cells ignore overflow-only penalties", rowAvoid: "avoid", type: "page", cells: [{ score: 0, continues: true, forced: true }, { score: 3, continues: false }], expected: 0 },
		{ name: "forced overflow cannot erase an unforced cell score", rowAvoid: "auto", type: "page", cells: [{ score: 0, continues: false, forced: true }, { score: 1, continues: true }], expected: 1 },
		{ name: "forced overflow cannot erase row avoidance", rowAvoid: "avoid", type: "page", cells: [{ score: 0, continues: false, forced: true }, { score: 1, continues: true }], expected: 2 },
	]) {
		test(scenario.name, async ({ page }) => {
			const result = await page.evaluate(async ({ rowAvoid, type, cells: responses }) => {
				const { TableRowAlgorithm } = await import("/src/algorithms/table-row.js");
				const { BlockContainerAlgorithm } = await import("/src/algorithms/block-container.js");
				const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
				const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
				const { ensureFlowContext } = await import("/src/fragmentation/flow-context.js");
				const { Fragment } = await import("/src/fragmentation/fragment.js");
				const { tableRowNode, blockNode } = await import("/test/fixtures/nodes.js");
				const cells = responses.map(() => blockNode());
				const row = tableRowNode({ cells, breakInside: rowAvoid });
				const generator = new TableRowAlgorithm(row, new ConstraintSpace({
					availableInlineSize: 400, availableBlockSize: 100,
					fragmentainerBlockSize: 100, fragmentationType: type,
				}), null).layout();
				let step = generator.next();
				for (let index = 0; index < responses.length; index++) {
					const response = responses[index];
					const token = response.continues === null ? null : new BlockBreakToken(cells[index]);
					if (token) token.isAtBlockEnd = !response.continues;
					if (token && response.forced) {
						token.childBreakTokens = [BlockBreakToken.createBreakBefore(blockNode(), true, "page")];
					}
					step = generator.next({
						fragment: new Fragment(cells[index], 100, []),
						breakToken: token,
						breakScore: response.score,
					});
				}
				const parent = blockNode({ children: [row] });
				ensureFlowContext(parent);
				const parentGenerator = new BlockContainerAlgorithm(parent, new ConstraintSpace({
					availableInlineSize: 400, availableBlockSize: 100,
					fragmentainerBlockSize: 100, fragmentationType: type,
				}), null).layout();
				parentGenerator.next();
				const parentResult = parentGenerator.next(step.value);
				return { done: step.done, score: step.value.breakScore, parentScore: parentResult.value.breakScore };
			}, scenario);
			expect(result.done).toBe(true);
			expect(result.score).toBe(scenario.expected);
			expect(result.parentScore).toBe(scenario.expected);
		});
	}

	test("cell avoidance propagates through row, row group, table, and outer block", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } = await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { tableRowNode, tableNode, blockNode } = await import("/test/fixtures/nodes.js");
			const cell = blockNode({ breakInside: "avoid", children: [blockNode({ blockSize: 100 }), blockNode({ blockSize: 100 })] });
			const row = tableRowNode({ cells: [cell] });
			const group = blockNode({ children: [row] });
			const table = tableNode({ children: [group] });
			const outer = blockNode({ children: [table] });
			return [cell, row, group, table, outer].map((node) => {
				const Algorithm = getLayoutAlgorithm(node);
				const result = runLayoutGenerator(new Algorithm(node, new ConstraintSpace({
					availableInlineSize: 400, availableBlockSize: 150,
					fragmentainerBlockSize: 150, fragmentationType: "page",
				}), null));
				return { score: result.breakScore, continues: result.breakToken?.continuesInFlow };
			});
		});
		expect(result).toEqual(Array.from({ length: 5 }, () => ({ score: 2, continues: true })));
	});

	for (const type of ["page", "column"]) {
		test(`an independent cell penalty survives a forced ${type} break through every ancestor`, async ({ page }) => {
			const result = await page.evaluate(async (type) => {
				const { runLayoutGenerator, getLayoutAlgorithm } = await import("/src/layout/layout-driver.js");
				const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
				const { tableRowNode, tableNode, blockNode } = await import("/test/fixtures/nodes.js");
				const forced = blockNode({ children: [
					blockNode({ blockSize: 100 }), blockNode({ blockSize: 100, breakBefore: type }),
				] });
				const avoided = blockNode({ breakInside: "avoid", children: [
					blockNode({ blockSize: 100 }), blockNode({ blockSize: 100 }),
				] });
				const row = tableRowNode({ cells: [forced, avoided] });
				const group = blockNode({ children: [row] });
				const table = tableNode({ children: [group] });
				const outer = blockNode({ children: [table] });
				return [forced, avoided, row, group, table, outer].map((node) => {
					const Algorithm = getLayoutAlgorithm(node);
					const output = runLayoutGenerator(new Algorithm(node, new ConstraintSpace({
						availableInlineSize: 400, availableBlockSize: 150,
						fragmentainerBlockSize: 150, fragmentationType: type,
					}), null));
					return { score: output.breakScore, continues: output.breakToken?.continuesInFlow };
				});
			}, type);
			expect(result).toEqual([0, 2, 2, 2, 2, 2].map((score) => ({ score, continues: true })));
		});
	}
});

test.describe("Table row early-break retries", () => {
	test("completed short cells stay empty while long-cell text continues in source order", async ({ page }) => {
		const result = await paginate(page, `<table style="${TABLE_STYLE}"><tbody>
			<tr style="break-inside:avoid"><td data-cell="short" style="${CELL_STYLE}">SHORT-CELL</td>
			<td data-cell="long" style="${CELL_STYLE}">${cellParts(7, 50)}</td></tr>
		</tbody></table>`);
		expectCompleted(result);
		expect(result.pages.length).toBeGreaterThan(1);
		expect(result.pages[0].cells.find((cell) => cell.id === "short").text).toBe("SHORT-CELL");
		expect(result.pages.slice(1).flatMap((page) => page.cells).filter((cell) => cell.id === "short").every((cell) => cell.text === "")).toBe(true);
	});

	test("an avoided row fitting below a fresh repeated header moves intact", async ({ page }) => {
		const result = await paginate(page, tableRows(`
			<tr><td data-cell="first" style="${CELL_STYLE}">${cellParts(1, 80, "FIRST")}</td></tr>
			<tr style="break-inside:avoid"><td data-cell="long" style="${CELL_STYLE}">${cellParts(3, 40)}</td></tr>`));
		expectCompleted(result);
		expect(result.pages).toHaveLength(2);
		expect(result.pages.map((page) => page.headers)).toEqual([1, 1]);
		expect(result.pages[0].text).toBe("HEADERFIRST-1");
		expect(result.pages[1].text).toBe("HEADERLONG-1LONG-2LONG-3");
	});

	test("a 250px avoided row stays intact on the following 400px page", async ({ page }) => {
		const result = await paginate(page, tableRows(`
			<tr><td data-cell="first" style="${CELL_STYLE}">${cellParts(1, 80, "FIRST")}</td></tr>
			<tr style="break-inside:avoid"><td data-cell="long" style="${CELL_STYLE}">${cellParts(5, 50)}</td></tr>`), { firstHeight: 200, height: 400 });
		expectCompleted(result);
		expect(result.pages).toHaveLength(2);
		expect(result.pages.map((page) => page.headers)).toEqual([1, 1]);
		expect(result.pages[0].text).toBe("HEADERFIRST-1");
		expect(result.pages[1].text).toBe("HEADERLONG-1LONG-2LONG-3LONG-4LONG-5");
		expect(result.pageHeights).toEqual([200, 400]);
		expect(result.pages[1].cells.find((cell) => cell.id === "long").height).toBe(250);
	});

	for (const height of [20, 120]) {
		test(`a ${height}px caption does not make a body-free breakpoint eligible`, async ({ page }) => {
			const html = tableRows(`<tr style="break-inside:avoid">
				<td data-cell="long" style="${CELL_STYLE};break-inside:avoid">${cellParts(6, 70)}</td>
			</tr>`).replace("<thead", `<caption style="height:${height}px">CAPTION</caption><thead`);
			const result = await paginate(page, html);
			expectCompleted(result);
			expect(result.pages.length).toBeGreaterThan(2);
			expect(result.pages[0].text).toContain("CAPTIONHEADERLONG-1");
			expect(result.pages.every((page) => page.headers === 1)).toBe(true);
			expect(result.pages.every((page) => page.bodyText.length > 0)).toBe(true);
		});
	}

	test("a sized empty row group does not make a header-only breakpoint eligible", async ({ page }) => {
		const html = tableRows(`<tr style="break-inside:avoid">
			<td data-cell="long" style="${CELL_STYLE};break-inside:avoid">${cellParts(6, 70)}</td>
		</tr>`).replace("<tbody>", '<tbody style="height:30px"></tbody><tbody>');
		const result = await paginate(page, html);
		expectCompleted(result);
		expect(result.pages.length).toBeGreaterThan(2);
		expect(result.pages.every((page) => page.headers === 1)).toBe(true);
		expect(result.pages.every((page) => page.bodyText.length > 0)).toBe(true);
	});

	test("a physically placed empty body row remains an eligible breakpoint", async ({ page }) => {
		const result = await paginate(page, tableRows(`
			<tr><td data-cell="empty" style="${CELL_STYLE};height:40px"></td></tr>
			<tr style="break-inside:avoid"><td data-cell="long" style="${CELL_STYLE}">${cellParts(3, 50)}</td></tr>`));
		expectCompleted(result);
		expect(result.pages).toHaveLength(2);
		expect(result.pages.map((page) => page.text)).toEqual(["HEADER", "HEADERLONG-1LONG-2LONG-3"]);
		expect(result.pages[0].cells.find((cell) => cell.id === "empty").height).toBe(40);
	});

	for (const avoidance of ["avoid", "avoid-column"]) {
		test(`${avoidance} can move a row past a non-repeating column header`, async ({ page }) => {
			const result = await paginate(page, tableRows(`<tr style="break-inside:${avoidance}">
				<td data-cell="long" style="${CELL_STYLE}">${cellParts(2, 90, "LONG", "overflow:hidden")}</td>
			</tr>`), { type: "column" });
			expectCompleted(result);
			expect(result.pages.map((page) => page.text)).toEqual(["HEADER", "LONG-1LONG-2"]);
			expect(result.pages.map((page) => page.headers)).toEqual([1, 0]);
			expect(result.pages[1].cells.find((cell) => cell.id === "long").height).toBe(180);
		});
	}

	test("a caption-only prefix stays eligible when the table has no repeated header", async ({ page }) => {
		const result = await paginate(page, `<table style="${TABLE_STYLE}">
			<caption style="height:40px">CAPTION</caption><tbody><tr style="break-inside:avoid-page">
				<td data-cell="long" style="${CELL_STYLE}">${cellParts(2, 90, "LONG", "overflow:hidden")}</td>
			</tr></tbody></table>`);
		expectCompleted(result);
		expect(result.pages.map((page) => page.text)).toEqual(["CAPTION", "LONG-1LONG-2"]);
		expect(result.pages[1].cells.find((cell) => cell.id === "long").height).toBe(180);
	});

	for (const scenario of [
		{ name: "after a preceding row", preceding: true, headerStyle: "" },
		{ name: "as the first row", preceding: false, headerStyle: "" },
		{ name: "without a better earlier breakpoint", preceding: false, headerStyle: "break-after:avoid" },
	]) {
		test(`oversized avoided row terminates under repeated headers ${scenario.name}`, async ({ page }) => {
			const preceding = scenario.preceding ? `<tr><td data-cell="first" style="${CELL_STYLE}">${cellParts(1, 60, "FIRST")}</td></tr>` : "";
			const result = await paginate(page, tableRows(`${preceding}
				<tr style="break-inside:avoid"><td data-cell="long" style="${CELL_STYLE};break-inside:avoid">${cellParts(6, 70)}</td></tr>`, scenario.headerStyle));
			expectCompleted(result);
			expect(result.pages.length).toBeGreaterThan(2);
			expect(result.pages.every((page) => page.headers === 1)).toBe(true);
			expect(result.pages.every((page) => page.bodyText.length > 0), JSON.stringify(result.pages.map((page) => page.text))).toBe(true);
		});
	}

	for (const scenario of [
		{ value: "avoid-page", type: "page", firstLong: "" },
		{ value: "avoid-page", type: "column", firstLong: "LONG-1LONG-2" },
		{ value: "avoid-column", type: "page", firstLong: "LONG-1LONG-2" },
		{ value: "avoid-column", type: "column", firstLong: "" },
	]) {
		test(`${scenario.value} retains its ${scenario.type} fragmentation behavior`, async ({ page }) => {
			const result = await paginate(page, `<table style="${TABLE_STYLE}"><tbody>
				<tr><td data-cell="first" style="${CELL_STYLE}">${cellParts(1, 120, "FIRST")}</td></tr>
				<tr style="break-inside:${scenario.value}"><td data-cell="long" style="${CELL_STYLE}">${cellParts(3, 40)}</td></tr>
			</tbody></table>`, { type: scenario.type });
			expectCompleted(result);
			expect(result.pages).toHaveLength(2);
			expect(result.pages[0].text).toBe(`FIRST-1${scenario.firstLong}`);
		});
	}

	test("a forced row break still wins over row and table avoidance", async ({ page }) => {
		const result = await paginate(page, `<table style="${TABLE_STYLE};break-inside:avoid"><tbody>
			<tr style="break-inside:avoid;break-after:page"><td data-cell="first" style="${CELL_STYLE}">${cellParts(1, 40, "FIRST")}</td></tr>
			<tr style="break-inside:avoid"><td data-cell="second" style="${CELL_STYLE}">${cellParts(1, 40, "SECOND")}</td></tr>
		</tbody></table>`);
		expectCompleted(result);
		expect(result.pages.map((page) => page.text)).toEqual(["FIRST-1", "SECOND-1"]);
	});

	test("a forced break inside an avoided row does not move its preceding content", async ({ page }) => {
		const result = await paginate(page, `<div style="height:50px">INTRO</div>
			<table style="${TABLE_STYLE}"><tbody><tr style="break-inside:avoid">
				<td data-cell="long" style="${CELL_STYLE}"><div style="height:50px">A</div>
				<div style="height:50px;break-before:page">B</div></td>
			</tr></tbody></table>`);
		expectCompleted(result);
		expect(result.pages.map((page) => page.text)).toEqual(["INTROA", "B"]);
	});
});
