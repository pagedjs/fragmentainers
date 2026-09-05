import { test, expect } from "../browser-fixture.js";

for (const count of ["auto", "1", "2"]) {
	test(`composes and resumes a root with column-count:${count}`, async ({ page }) => {
		const result = await page.evaluate(async (count) => {
			const { Fragmenter, PageResolver } = await import("/src/index.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(`
				@page { size: 300px 100px; margin: 10px; }
				body { margin: 0; column-count: ${count}; column-gap: 20px; }
				p { margin: 0; font: 14px/20px monospace; }
				p::before { content: "X"; }
			`);
			const source = document.createElement("template");
			source.innerHTML = Array.from({ length: 13 }, (_, i) => `<p data-row="${i}">Row ${i}</p>`).join("");
			const flow = new Fragmenter(source.content, {
				resolver: PageResolver.fromStyleSheets([sheet]), styles: [sheet],
			});
			const pages = [...flow];
			pages.forEach((el) => {
				el.style.width = "280px";
				el.style.height = "80px";
				document.body.append(el);
			});
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const rows = pages.flatMap((el) => [...el.querySelectorAll("p")].map((row) => ({
				id: row.dataset.row,
				text: row.textContent.replace(/^X/, ""),
				width: row.getBoundingClientRect().width,
			})));
			const complete = flow.fragments.at(-1).breakToken === null;
			const pageCount = pages.length;
			flow.destroy();
			return { rows, complete, pageCount };
		}, count);
		expect(result.pageCount).toBeGreaterThan(1);
		expect(result.complete).toBe(true);
		expect(result.rows.map((row) => row.id)).toEqual(Array.from({ length: 13 }, (_, i) => String(i)));
		for (let i = 0; i < result.rows.length; i++) {
			expect(result.rows[i].text).toBe(`Row ${i}`);
			expect(result.rows[i].width).toBeCloseTo(count === "2" ? 130 : 280, 0);
		}
	});
}
