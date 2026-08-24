import { test, expect } from "../browser-fixture.js";

for (const display of ["inline", "block"]) {
	test(`keeps ${display} ::before on a segment boundary element`, async ({ page }) => {
		const result = await page.evaluate(
			async ({ display }) => {
				const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
				const sheet = new CSSStyleSheet();
				sheet.replaceSync(
					`.boundary::before { content: "prefix"; display: ${display}; }`,
				);

				const content = document.createDocumentFragment();
				const first = document.createElement("p");
				first.textContent = "first";
				const boundary = document.createElement("p");
				boundary.className = "boundary";
				boundary.textContent = "boundary";
				boundary.style.breakBefore = "page";
				content.append(first, boundary);

				const flow = new Fragmenter(content, {
					width: 400,
					height: 600,
					styles: [sheet],
				});
				const fragments = [...flow];
				const output = fragments.map((fragment) => ({
					text: fragment.textContent,
					beforeCount: fragment.querySelectorAll(
						'frag-pseudo[data-pseudo="before"]',
					).length,
				}));
				flow.destroy();
				return output;
			},
			{ display },
		);

		expect(result).toHaveLength(2);
		expect(result[1].text).toContain("prefix");
		expect(result[1].beforeCount).toBe(1);
	});
}
