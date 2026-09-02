import { test, expect } from "../browser-fixture.js";

// A box's specified block-size is a limit that the extent of its fragments
// counts against (CSS Fragmentation §5.3); the box breaks after its content
// at a Class C break point (§4.1) when the rest does not fit.
test.describe("Specified block-size under fragmentation", () => {
	async function layout(page, html, css, { height = 200, margin = 40 } = {}) {
		return page.evaluate(
			async ({ html, css, height, margin }) => {
				const { Fragmenter, PageResolver } = await import("/src/index.js");
				const sheet = new CSSStyleSheet();
				sheet.replaceSync(`@page { size: 300px ${height}px; margin: ${margin}px 20px; } ${css}`);
				const template = document.createElement("template");
				template.innerHTML = html;
				const flow = new Fragmenter(template.content, {
					resolver: PageResolver.fromStyleSheets([sheet]),
					styles: [sheet],
				});
				const ctx = flow.flow();
				const describe = (f) => ({
					node: f.node?.debugName ?? null,
					blockSize: f.blockSize,
					blockOffset: f.blockOffset,
					clip: f.needsBlockClip,
					children: f.childFragments.map(describe),
					token: f.breakToken
						? {
								type: f.breakToken.type,
								consumed: f.breakToken.consumedBlockSize,
								seenAll: f.breakToken.hasSeenAllChildren,
								atEnd: f.breakToken.isAtBlockEnd,
								childTokens: f.breakToken.childBreakTokens?.length ?? 0,
							}
						: null,
				});
				const pages = ctx.fragments.map((f) => f.childFragments.map(describe));
				const elements = [...ctx];
				const rendered = elements.map((el) => el.innerHTML);
				const metrics = elements.map((el) => {
					document.body.appendChild(el);
					const pageTop = el.getBoundingClientRect().top;
					const boxes = {};
					for (const box of el.querySelectorAll("[data-test]")) {
						const rect = box.getBoundingClientRect();
						const style = getComputedStyle(box);
						boxes[box.dataset.test] = {
							decorationClone: box.hasAttribute("data-box-decoration-clone"),
							top: rect.top - pageTop,
							height: rect.height,
							width: rect.width,
							boxSizing: style.boxSizing,
							paddingBlockStart: parseFloat(style.paddingBlockStart),
							paddingBlockEnd: parseFloat(style.paddingBlockEnd),
							borderBlockStart: parseFloat(style.borderBlockStartWidth),
							borderBlockEnd: parseFloat(style.borderBlockEndWidth),
						};
					}
					el.remove();
					return boxes;
				});
				flow.destroy();
				return { pages, html: rendered, metrics };
			},
			{ html, css, height, margin },
		);
	}

	test("a paragraph taller than the page breaks after its line and continues as an empty slice", async ({
		page,
	}) => {
		// Page content area 200 − 80 = 120px; the first page also carries the
		// 8px UA body margin, so the first paragraph has 112px.
		const { pages, html } = await layout(
			page,
			"<p>a</p><p>b</p><p>c</p>",
			"p { margin: 0; height: 113px; }",
		);
		expect(pages.length).toBe(3);

		const first = pages[0][0];
		expect(first.node).toBe("p");
		expect(first.blockSize).toBe(112);
		expect(first.clip).toBe(true);
		expect(first.children[0].children.length).toBe(1);
		expect(first.token).toEqual({
			type: "block",
			consumed: 112,
			seenAll: true,
			atEnd: false,
			childTokens: 0,
		});

		const rest = pages[1][0];
		expect(rest.node).toBe("p");
		expect(rest.blockSize).toBe(1);
		expect(rest.clip).toBe(true);
		expect(rest.children.length).toBe(0);
		expect(rest.token).toBe(null);

		// The second paragraph fits whole in the 119px left on page 2.
		const second = pages[1][1];
		expect(second.blockSize).toBe(113);
		expect(second.token).toBe(null);

		expect(html[0]).toContain(">a<");
		expect(html[1]).not.toContain(">a<");
		expect(html[1]).toMatch(/<p[^>]*data-split-from/);
	});

	test("a paragraph whose block-size fits extends to it, with one real line", async ({ page }) => {
		const { pages } = await layout(page, "<p>a</p><p>b</p><p>c</p>", "p { margin: 0; height: 100px; }");
		expect(pages.length).toBe(3);
		const p = pages[0][0];
		expect(p.blockSize).toBe(100);
		expect(p.clip).toBe(false);
		expect(p.token).toBe(null);
		expect(p.children[0].children.length).toBe(1);
	});

	test("a block container taller than the page breaks after its content", async ({ page }) => {
		const { pages } = await layout(
			page,
			"<div><p>a</p></div>",
			"div { margin: 0; height: 250px; } p { margin: 0; }",
		);
		expect(pages.length).toBe(3);
		expect(pages[0][0].blockSize).toBe(112);
		expect(pages[0][0].token.consumed).toBe(112);
		expect(pages[1][0].blockSize).toBe(120);
		expect(pages[1][0].children.length).toBe(0);
		expect(pages[1][0].token.consumed).toBe(232);
		expect(pages[2][0].blockSize).toBe(18);
		expect(pages[2][0].token).toBe(null);
	});

	test("block-end decorations belong to the last fragment of the box", async ({ page }) => {
		const { pages } = await layout(
			page,
			"<p>a</p>",
			"p { margin: 0; height: 100px; padding-bottom: 20px; box-sizing: border-box; border-bottom: 10px solid; }",
			{ height: 100, margin: 10 },
		);
		// 72px available: the 100px border box needs two fragments.
		expect(pages.length).toBe(2);
		expect(pages[0][0].blockSize).toBe(72);
		expect(pages[1][0].blockSize).toBe(28);
	});

	// Content overflowing a fixed-size box is parallel to the content after
	// the box (CSS Fragmentation §2.1): it does not size the box, and what
	// does not fit continues in the next fragmentainer alongside the content
	// that follows the box.
	test.describe("content overflowing a fixed-size box", () => {
		const paragraphs = (n) => Array.from({ length: n }, (_, i) => `<p>${i + 1}</p>`).join("");

		test("the box keeps its block-size and the next sibling follows it", async ({ page }) => {
			const { pages, html } = await layout(
				page,
				`<div>${paragraphs(5)}</div><p class="sib">after</p>`,
				"div, p { margin: 0; } div { height: 30px; }",
			);
			expect(pages.length).toBe(1);

			const [div, sib] = pages[0];
			expect(div.node).toBe("div");
			expect(div.blockSize).toBe(30);
			expect(div.clip).toBe(false);
			expect(div.token).toBe(null);
			expect(div.children.length).toBe(5);
			expect(div.children[4].blockOffset).toBe(72);

			// The first page starts with the 8px UA body margin.
			expect(div.blockOffset).toBe(8);
			expect(sib.node).toBe("p.sib");
			expect(sib.blockOffset).toBe(div.blockOffset + 30);

			expect(html[0]).toBe(
				'<div><p>1</p><p>2</p><p>3</p><p>4</p><p>5</p></div><p class="sib">after</p>',
			);
		});

		test("overflow past the page continues in parallel with the content after the box", async ({
			page,
		}) => {
			// Eight 18px paragraphs: six fit in the 112px of page 1, the box is
			// 30px, and the sibling's six lines break after four.
			const { pages, html } = await layout(
				page,
				`<div>${paragraphs(8)}</div><p class="sib">one<br>two<br>three<br>four<br>five<br>six</p>`,
				"div, p { margin: 0; } div { height: 30px; }",
			);
			expect(pages.length).toBe(2);

			const [div, sib] = pages[0];
			expect(div.blockSize).toBe(30);
			expect(div.clip).toBe(false);
			expect(div.children.length).toBe(7);
			expect(div.token).toEqual({
				type: "block",
				consumed: 30,
				seenAll: false,
				atEnd: true,
				childTokens: 1,
			});
			expect(sib.blockOffset).toBe(div.blockOffset + 30);
			expect(sib.blockSize).toBe(72);
			expect(sib.token.atEnd).toBe(false);

			// Page 2: the box contributes no extent and its remaining
			// paragraphs are laid out from the top, as is the sibling's rest.
			const [divRest, sibRest] = pages[1];
			expect(divRest.node).toBe("div");
			expect(divRest.blockSize).toBe(0);
			expect(divRest.blockOffset).toBe(0);
			expect(divRest.token).toBe(null);
			expect(divRest.children.map((c) => [c.node, c.blockOffset])).toEqual([
				["p", 0],
				["p", 18],
			]);
			expect(sibRest.node).toBe("p.sib");
			expect(sibRest.blockOffset).toBe(0);
			expect(sibRest.blockSize).toBe(36);
			expect(sibRest.token).toBe(null);

			expect(html[0]).toMatch(/^<div><p>1<\/p>(<p>\d<\/p>){5}<\/div><p class="sib" data-split-to="">one<br>/);
			expect(html[1]).toMatch(
				/^<div data-split-from="" data-past-block-end=""><p>7<\/p><p>8<\/p><\/div><p class="sib" data-split-from="">five<br>six<\/p>$/,
			);
		});

		test("a continuation of the box is composed at the rest of its block-size", async ({
			page,
		}) => {
			// 150px box: 108px of paragraphs on page 1, the last two on page 2
			// inside the 42px that are left, followed by the sibling.
			const { pages, html } = await layout(
				page,
				`<div>${paragraphs(8)}</div><p class="sib">after</p>`,
				"div, p { margin: 0; } div { height: 150px; }",
			);
			expect(pages.length).toBe(2);
			expect(pages[0][0].token.consumed).toBe(108);

			const [divRest, sib] = pages[1];
			expect(divRest.blockSize).toBe(42);
			expect(divRest.children.length).toBe(2);
			expect(divRest.token).toBe(null);
			expect(sib.blockOffset).toBe(42);

			expect(html[1]).toMatch(
				/^<div data-split-from="" style="[^"]*height: 42px !important;"><p>7<\/p><p>8<\/p><\/div><p class="sib">after<\/p>$/,
			);
		});

		test("an oversized line cannot make fixed-size progress negative", async ({ page }) => {
			const { pages } = await layout(
				page,
				'<div class="fixed"><p>a<br>b</p></div><p class="sib">after</p>',
				"body, div, p { margin: 0; } .fixed { height: 130px; } .fixed > p { line-height: 150px; }",
				{ height: 100, margin: 0 },
			);
			const fixed = pages.flat().filter((fragment) => fragment.node === "div.fixed");
			expect(fixed.map((fragment) => fragment.blockSize)).toEqual([100, 30]);
			expect(fixed[0].token.consumed).toBe(100);
			expect(pages[1].find((fragment) => fragment.node === "p.sib").blockOffset).toBe(30);
			expect(pages.flat().every((fragment) => fragment.blockSize >= 0)).toBe(true);
		});

		test("a content-box continuation preserves its inline size", async ({ page }) => {
			const paragraphs = Array.from({ length: 8 }, (_, i) => `<p>${i + 1}</p>`).join("");
			const { metrics } = await layout(
				page,
				`<div data-test="box">${paragraphs}</div><p data-test="sib">after</p>`,
				"body, div, p { margin: 0; } div { box-sizing: content-box; width: 100px; height: 150px; padding-inline: 20px; }",
				{ height: 120, margin: 0 },
			);
			expect(metrics).toHaveLength(2);
			expect(metrics[0].box.width).toBe(140);
			expect(metrics[1].box.width).toBe(140);
			expect(metrics[1].box.boxSizing).toBe("content-box");
			expect(metrics[1].sib.top - metrics[1].box.top).toBe(42);
		});

		test("a border-box continuation keeps its border-box fragment height", async ({ page }) => {
			const paragraphs = Array.from({ length: 8 }, (_, i) => `<p>${i + 1}</p>`).join("");
			const { pages, metrics } = await layout(
				page,
				`<div data-test="box">${paragraphs}</div><p data-test="sib">after</p>`,
				"body, div, p { margin: 0; } div { box-sizing: border-box; height: 150px; padding-block: 10px; } p { line-height: 18px; }",
				{ height: 120, margin: 0 },
			);
			expect(pages.map((pageFragments) => pageFragments[0].blockSize)).toEqual([100, 50]);
			expect(metrics).toHaveLength(2);
			expect(metrics[1].box.boxSizing).toBe("border-box");
			expect(metrics[1].box.height).toBe(50);
			expect(metrics[1].sib.top - metrics[1].box.top).toBe(50);
		});
		});

	test("block-size limits resolve to border-box px", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const container = document.createElement("div");
			container.innerHTML = `
				<div style="height: 100px; min-height: 20px; max-height: 150px; padding: 5px 0; border: 1px solid"></div>
				<div style="height: 100px; min-height: 20px; padding: 5px 0; box-sizing: border-box"></div>
				<div style="min-height: 50%; max-height: none"></div>`;
			document.body.appendChild(container);
			const limits = [...container.children].map((el) => new DOMLayoutNode(el).blockSizeLimits());
			container.remove();
			return limits;
		});
		expect(result[0]).toEqual({ specified: 112, min: 32, max: 162 });
		expect(result[1]).toEqual({ specified: 100, min: 20, max: Infinity });
		expect(result[2]).toEqual({ specified: null, min: 0, max: Infinity });
	});

	test("a border-box block-size is floored at its padding and border", async ({ page }) => {
		const { pages, metrics } = await layout(
			page,
			'<div data-test="box"></div><p data-test="sib">after</p>',
			"body, div, p { margin: 0; } div { box-sizing: border-box; height: 10px; padding: 20px 0; }",
			{ height: 120, margin: 0 },
		);
		expect(pages[0][0].blockSize).toBe(40);
		expect(pages[0][1].blockOffset).toBe(40);
		expect(metrics[0].box.height).toBe(40);
		expect(metrics[0].sib.top - metrics[0].box.top).toBe(40);
	});

	test("a min-height is an extent the box reaches and breaks over", async ({ page }) => {
		const { pages } = await layout(
			page,
			"<div><p>a</p></div>",
			"div { margin: 0; min-height: 250px; } p { margin: 0; }",
		);
		expect(pages.length).toBe(3);
		expect(pages[0][0].blockSize).toBe(112);
		expect(pages[0][0].clip).toBe(true);
		expect(pages[0][0].token).toEqual({
			type: "block",
			consumed: 112,
			seenAll: true,
			atEnd: false,
			childTokens: 0,
		});
		expect(pages[1][0].blockSize).toBe(120);
		expect(pages[1][0].children.length).toBe(0);
		expect(pages[1][0].token.consumed).toBe(232);
		expect(pages[2][0].blockSize).toBe(18);
		expect(pages[2][0].token).toBe(null);
	});

	test("content taller than the min-height keeps its own extent", async ({ page }) => {
		const { pages } = await layout(
			page,
			"<div><p>a</p><p>b</p></div>",
			"div { margin: 0; min-height: 10px; } p { margin: 0; height: 30px; }",
		);
		expect(pages.length).toBe(1);
		expect(pages[0][0].blockSize).toBe(60);
		expect(pages[0][0].clip).toBe(false);
	});

	test("a max-height caps the specified block-size, a min-height wins over it", async ({
		page,
	}) => {
		const { pages } = await layout(
			page,
			"<p>a</p><p>b</p>",
			"p { margin: 0; height: 113px; max-height: 100px; } p + p { min-height: 110px; }",
		);
		expect(pages.length).toBe(2);
		const capped = pages[0][0];
		expect(capped.blockSize).toBe(100);
		expect(capped.clip).toBe(false);
		expect(capped.token).toBe(null);
		// min-height: 110px overrides the 100px maximum (CSS2 §10.7).
		expect(pages[1][0].blockSize).toBe(110);
		expect(pages[1][0].token).toBe(null);
	});

	test("max-height caps an auto-height box and leaves its overflow parallel", async ({ page }) => {
		const paragraphs = Array.from({ length: 5 }, (_, i) => `<p>${i + 1}</p>`).join("");
		const { pages, metrics } = await layout(
			page,
			`<div data-test="box">${paragraphs}</div><p data-test="sib">after</p>`,
			"body, div, p { margin: 0; } div { max-height: 30px; }",
			{ height: 120, margin: 0 },
		);
		expect(pages).toHaveLength(1);
		expect(pages[0][0].blockSize).toBe(30);
		expect(pages[0][1].blockOffset).toBe(30);
		expect(metrics[0].box.height).toBe(30);
		expect(metrics[0].sib.top - metrics[0].box.top).toBe(30);
	});

	test("min-height wins over max-height on an auto-height box", async ({ page }) => {
		const { pages, metrics } = await layout(
			page,
			'<div data-test="box"><p></p></div><p data-test="sib">after</p>',
			"body, div, p { margin: 0; } div { min-height: 80px; max-height: 30px; } div > p { height: 120px; }",
			{ height: 120, margin: 0 },
		);
		expect(pages[0][0].blockSize).toBe(80);
		expect(pages[0][1].blockOffset).toBe(80);
		expect(metrics[0].box.height).toBe(80);
		expect(metrics[0].sib.top - metrics[0].box.top).toBe(80);
	});

	test("a table's specified height remains a minimum across all fragments", async ({ page }) => {
		const rows = Array.from({ length: 8 }, (_, i) => `<tr><td>r${i + 1}</td></tr>`).join("");
		const { pages, metrics } = await layout(
			page,
			`<table data-test="table"><tbody>${rows}</tbody></table><p data-test="sib">after</p>`,
			"body, table, td, p { margin: 0; padding: 0; } table { height: 40px; border-collapse: collapse; border-spacing: 0; } td, p { line-height: 18px; }",
			{ height: 120, margin: 0 },
		);
		expect(pages).toHaveLength(2);
		expect(pages[0][0].blockSize).toBe(108);
		expect(pages[1][0].blockSize).toBe(36);
		expect(pages[1][1].blockOffset).toBe(36);
		expect(metrics[1].table.height).toBe(36);
		expect(metrics[1].sib.top - metrics[1].table.top).toBe(36);
	});

	test("an auto paragraph with a min-height taller than the page breaks after its line", async ({
		page,
	}) => {
		const { pages, html } = await layout(page, "<p>a</p><p>b</p>", "p { margin: 0; min-height: 150px; }");
		expect(pages.length).toBe(3);
		const first = pages[0][0];
		expect(first.blockSize).toBe(112);
		expect(first.clip).toBe(true);
		expect(first.children[0].children.length).toBe(1);
		expect(first.token.consumed).toBe(112);
		expect(first.token.seenAll).toBe(true);

		const rest = pages[1][0];
		expect(rest.blockSize).toBe(38);
		expect(rest.children.length).toBe(0);
		expect(rest.token).toBe(null);
		expect(html[1]).not.toContain(">a<");

		// The second paragraph places its line in the 82px left on page 2 and
		// reaches the rest of its minimum on page 3.
		expect(pages[1][1].blockSize).toBe(82);
		expect(pages[1][1].token.consumed).toBe(82);
		expect(pages[2][0].blockSize).toBe(68);
		expect(pages[2][0].token).toBe(null);
	});

	// Under box-decoration-break: clone every fragment is wrapped in the
	// box's block-start and block-end insets (CSS Fragmentation §5.4). The
	// repeated insets lie outside the box's block-size: the content extent
	// across all fragments still adds up to the content-box height.
	test("a self-broken clone box wraps each fragment in its insets", async ({ page }) => {
		const { pages } = await layout(
			page,
			"<div><p>a</p></div>",
			"div { margin: 0; height: 200px; padding: 10px 0; box-decoration-break: clone; } p { margin: 0; }",
		);
		expect(pages.length).toBe(3);
		const fragments = pages.map((p) => p[0]);
		expect(fragments.map((f) => f.blockSize)).toEqual([112, 120, 28]);
		expect(fragments.map((f) => f.clip)).toEqual([true, true, true]);
		// consumedBlockSize counts the box's own extent: the first fragment's
		// block-start inset and the content, never a repeated inset.
		expect(fragments[0].token.consumed).toBe(102);
		expect(fragments[1].token.consumed).toBe(202);
		expect(fragments[1].children.length).toBe(0);
		expect(fragments[2].token).toBe(null);
		const content = fragments.reduce((sum, f) => sum + f.blockSize - 20, 0);
		expect(content).toBe(200);
	});

	test("a composed clone paints both block edges on every fragment", async ({ page }) => {
		const { pages, metrics } = await layout(
			page,
			'<div data-test="box"><p>a</p></div>',
			"body, div, p { margin: 0; } div { height: 200px; padding: 10px 0; border-block: 5px solid; box-decoration-break: clone; }",
			{ height: 120, margin: 0 },
		);
		expect(pages.map((fragments) => fragments[0].blockSize)).toEqual([120, 120, 50]);
		expect(metrics.map((pageMetrics) => pageMetrics.box.decorationClone)).toEqual([
			true,
			true,
			true,
		]);
		for (const pageMetrics of metrics) {
			expect(pageMetrics.box.paddingBlockStart).toBe(10);
			expect(pageMetrics.box.paddingBlockEnd).toBe(10);
			expect(pageMetrics.box.borderBlockStart).toBe(5);
			expect(pageMetrics.box.borderBlockEnd).toBe(5);
		}
		expect(metrics.map((pageMetrics) => pageMetrics.box.height)).toEqual([120, 120, 50]);
	});

	test("a completed table cell cannot re-inflate a row continuation", async ({ page }) => {
		const { pages, metrics } = await layout(
			page,
			`<table data-test="table"><tbody><tr data-test="row">
				<td class="short" data-test="short">short</td>
				<td class="long"><div></div></td>
			</tr></tbody></table><p data-test="sib">after</p>`,
			"body, table, tr, td, p, div { margin: 0; } table { border-spacing: 0; } .short { height: 180px; padding: 10px 0; border: 5px solid; box-decoration-break: clone; } .long { padding: 0; } .long > div { height: 300px; }",
			{ height: 200, margin: 0 },
		);
		expect(pages).toHaveLength(2);
		expect(pages[1][0].blockSize).toBe(100);
		expect(metrics[1].table.height).toBe(100);
		expect(metrics[1].row.height).toBe(100);
		expect(metrics[1].short.height).toBe(100);
		expect(metrics[1].short.paddingBlockStart).toBe(0);
		expect(metrics[1].short.paddingBlockEnd).toBe(0);
		expect(metrics[1].short.borderBlockStart).toBe(0);
		expect(metrics[1].short.borderBlockEnd).toBe(0);
		expect(metrics[1].sib.top - metrics[1].table.top).toBe(100);
	});

	test("a clone box breaking through its children keeps counting its block-size", async ({
		page,
	}) => {
		const { pages } = await layout(
			page,
			"<div><p>a</p><p>b</p><p>c</p></div>",
			"div { margin: 0; height: 300px; padding: 10px 0; box-decoration-break: clone; } p { margin: 0; height: 50px; }",
		);
		expect(pages.length).toBe(4);
		const fragments = pages.map((p) => p[0]);
		expect(fragments.map((f) => f.blockSize)).toEqual([112, 120, 120, 28]);
		expect(fragments[0].token.childTokens).toBe(1);
		expect(fragments[0].token.consumed).toBe(102);
		expect(fragments[1].token).toEqual({
			type: "block",
			consumed: 202,
			seenAll: true,
			atEnd: false,
			childTokens: 0,
		});
		expect(fragments[2].token.consumed).toBe(302);
		expect(fragments[3].token).toBe(null);
		const content = fragments.reduce((sum, f) => sum + f.blockSize - 20, 0);
		expect(content).toBe(300);
	});

	test("a text-bearing block is a block container holding one anonymous inline node", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { getLayoutAlgorithm } = await import("/src/layout/layout-driver.js");
			const container = document.createElement("div");
			container.innerHTML = "<p>Hello <em>world</em></p>";
			document.body.appendChild(container);
			const p = new DOMLayoutNode(container.firstElementChild);
			const out = {
				algorithm: getLayoutAlgorithm(p).name,
				childCount: p.children.length,
				childIsInline: p.children[0].isInlineNode,
				childAlgorithm: getLayoutAlgorithm(p.children[0]).name,
				text: p.children[0].inlineItemsData.textContent,
			};
			container.remove();
			return out;
		});
		expect(result.algorithm).toBe("BlockContainerAlgorithm");
		expect(result.childCount).toBe(1);
		expect(result.childIsInline).toBe(true);
		expect(result.childAlgorithm).toBe("InlineContentAlgorithm");
		expect(result.text).toBe("Hello world");
	});
});
