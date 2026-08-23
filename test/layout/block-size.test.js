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
				const rendered = [...ctx].map((el) => el.innerHTML);
				flow.destroy();
				return { pages, html: rendered };
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

	test("content taller than the specified block-size keeps its own extent", async ({ page }) => {
		const { pages } = await layout(
			page,
			"<div><p>a</p><p>b</p></div>",
			"div { margin: 0; height: 10px; } p { margin: 0; height: 30px; }",
		);
		expect(pages.length).toBe(1);
		expect(pages[0][0].blockSize).toBe(60);
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
