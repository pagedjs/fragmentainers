import { test, expect } from "../browser-fixture.js";

test("keeps an empty native pseudo at its text position across page breaks", async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { Fragmenter } = await import("/src/index.js");
		const { markNativePseudo } = await import("/src/handlers.js");
		const sheet = new CSSStyleSheet();
		sheet.replaceSync("p { margin: 0; font: 16px/20px monospace; } #call::after { content: '1'; }");
		const source = "Before ".repeat(30);
		const template = document.createElement("template");
		template.innerHTML = `<p>${source}<span id="call"></span> After</p>`;
		markNativePseudo(template.content.querySelector("#call"), "after");
		const flow = new Fragmenter(template.content, { width: 200, height: 60, styles: [sheet] });
		const fragments = [...flow];
		const counts = fragments.map((fragment) => fragment.querySelectorAll("#call").length);
		const text = fragments.map((fragment) => {
			for (const call of fragment.querySelectorAll("#call")) call.replaceWith("[call]");
			return fragment.textContent;
		}).join(" ").replace(/\s+/g, " ").trim();
		flow.destroy();
		return { counts, text, source: `${source}[call] After` };
	});
	expect(result.counts.length).toBeGreaterThan(1);
	expect(result.counts[0]).toBe(0);
	expect(result.counts.reduce((total, count) => total + count, 0)).toBe(1);
	expect(result.text).toBe(result.source);
});
