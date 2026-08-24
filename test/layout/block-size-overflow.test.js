import { test, expect } from "../browser-fixture.js";

test.describe("Block-size overflow", () => {
	test("preserves unvisited siblings after an oversized child forces a self-break", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter, PageResolver } = await import("/src/index.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(`
				@page { size: 300px 120px; margin: 0; }
				body, div, p { margin: 0; }
				.fixed { height: 150px; }
				.big { line-height: 200px; }
				.fixed > p { height: 18px; line-height: 18px; }
			`);
			const template = document.createElement("template");
			template.innerHTML = `
				<div class="fixed">
					<div class="big">BIG</div>
					<p>B</p><p>C</p><p>D</p>
				</div>
				<p class="after">AFTER</p>`;
			const flow = new Fragmenter(template.content, {
				resolver: PageResolver.fromStyleSheets([sheet]),
				styles: [sheet],
			});
			const context = flow.flow();
			const pages = context.fragments.map((pageFragment) => {
				const fixed = pageFragment.childFragments.find(
					(fragment) => fragment.node?.debugName === "div.fixed",
				);
				const after = pageFragment.childFragments.find(
					(fragment) => fragment.node?.debugName === "p.after",
				);
				return {
					fixed: fixed
						? {
								blockSize: fixed.blockSize,
								consumedBlockSize: fixed.breakToken?.consumedBlockSize ?? null,
								hasSeenAllChildren: fixed.breakToken?.hasSeenAllChildren ?? null,
							}
						: null,
					afterOffset: after?.blockOffset ?? null,
				};
			});
			const rendered = [...context];
			const text = rendered.map((element) => element.textContent.replace(/\s+/g, "")).join("");
			rendered.forEach((element) => element.remove());
			flow.destroy();
			return { pages, text };
		});

		expect(result.text).toBe("BIGBCDAFTER");
		expect(result.pages).toEqual([
			{
				fixed: {
					blockSize: 120,
					consumedBlockSize: 120,
					hasSeenAllChildren: false,
				},
				afterOffset: null,
			},
			{
				fixed: {
					blockSize: 30,
					consumedBlockSize: null,
					hasSeenAllChildren: null,
				},
				afterOffset: 30,
			},
		]);
	});
});
