import { test, expect } from "../browser-fixture.js";

test("measures named table content after an empty segment prefix", async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { Fragmenter, PageResolver } = await import("/src/index.js");
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(`
			@page { size: 300px 120px; margin: 10px; }
			body { margin: 0; }
			.marker { display: block; height: 0; margin: 0; padding: 0; border: 0; }
			section { page: chapter; }
			table { width: 100%; margin-top: 6px; border-collapse: collapse; }
			td { padding: 4px; border: 1px solid; vertical-align: top; font: 14px/20px monospace; }
			p { margin: 0; }
		`);
		const source = document.createElement("template");
		const lines = Array.from({ length: 18 }, (_, i) => `<p>Long ${i}</p>`).join("");
		source.innerHTML = `<span class="marker"></span><span class="marker"></span><section><table><tbody><tr><td data-cell="short">Short</td><td data-cell="long">${lines}</td></tr></tbody></table></section>`;
		const flow = new Fragmenter(source.content, { resolver: PageResolver.fromStyleSheets([sheet]), styles: [sheet] });
		const pages = [...flow];
		const text = (id) => pages.flatMap((el) => [...el.querySelectorAll(`[data-cell="${id}"]`)]).map((el) => el.textContent.replace(/\s+/g, "")).join("");
		const cells = [];
		const walk = (fragment) => {
			if (fragment.node?.element?.dataset.cell) cells.push({ display: fragment.node.display, size: fragment.blockSize });
			fragment.childFragments.forEach(walk);
		};
		flow.fragments.forEach(walk);
		const result = {
			short: text("short"), long: text("long"), cells,
			firstPageHasTable: !!pages[0].querySelector("table"),
			pages: pages.length, complete: flow.fragments.at(-1).breakToken === null,
		};
		flow.destroy();
		return result;
	});
	expect(result.pages).toBeGreaterThan(2);
	expect(result.firstPageHasTable).toBe(true);
	expect(result.short).toBe("Short");
	expect(result.long).toBe(Array.from({ length: 18 }, (_, i) => `Long${i}`).join(""));
	expect(result.cells.every((cell) => cell.display === "table-cell" && cell.size <= 100)).toBe(true);
	expect(result.complete).toBe(true);
});
