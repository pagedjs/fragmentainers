import { test, expect } from "../browser-fixture.js";

for (const display of ["inline", "block"]) {
	test(`allocates ${display} MathML as one mathematical formatting root`, async ({ page }) => {
		const result = await page.evaluate(async (display) => {
			const { Fragmenter, PageResolver } = await import("/src/index.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("@page { size: 300px 120px; margin: 10px; } body { margin: 0; }");
			const holder = document.createElement("div");
			holder.style.width = "280px";
			holder.innerHTML = Array.from({ length: 24 }, (_, i) => `<div data-row="${i}"><math display="${display}" data-equation="${i}"><mrow><mfrac><mi>x</mi><mn>${i + 1}</mn></mfrac><mo>+</mo><msup><mi>y</mi><mn>2</mn></msup></mrow></math></div>`).join("");
			document.body.append(holder);
			const expected = [...holder.children].map((el) => el.getBoundingClientRect().height);
			const source = document.createDocumentFragment();
			source.append(...holder.childNodes);
			holder.remove();
			const flow = new Fragmenter(source, { resolver: PageResolver.fromStyleSheets([sheet]), styles: [sheet] });
			const pages = [...flow];
			const allocations = [];
			const pageAllocations = flow.fragments.map((pageFragment) => {
				const rows = [];
				const walk = (fragment) => {
					const id = fragment.node?.element?.dataset.row;
					if (id !== undefined && fragment.blockSize > 0) {
						const allocation = { id, height: fragment.blockSize };
						allocations.push(allocation);
						rows.push(allocation);
					}
					fragment.childFragments.forEach(walk);
				};
				walk(pageFragment);
				return { rows, available: pageFragment.constraints.contentArea.blockSize };
			});
			const ids = pages.flatMap((el) => [...el.querySelectorAll("math")].map((math) => math.dataset.equation));
			const complete = flow.fragments.at(-1).breakToken === null;
			flow.destroy();
			return { expected, allocations, pageAllocations, ids, complete };
		}, display);
		expect(result.ids).toEqual(Array.from({ length: 24 }, (_, i) => String(i)));
		expect(result.allocations).toHaveLength(24);
		for (const allocation of result.allocations) {
			expect(allocation.height).toBeCloseTo(result.expected[Number(allocation.id)], 1);
		}
		for (let i = 0; i < result.pageAllocations.length - 1; i++) {
			const page = result.pageAllocations[i];
			const used = page.rows.reduce((sum, row) => sum + row.height, 0);
			const next = result.pageAllocations[i + 1].rows[0];
			expect(next).toBeDefined();
			expect(page.available - used).toBeLessThan(next.height);
		}
		expect(result.complete).toBe(true);
	});
}
