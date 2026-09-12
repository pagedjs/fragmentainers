import { test, expect } from "../browser-fixture.js";

test("restores nested counter scopes inside composed continuations and closes inner scopes", async ({ page }) => {
	await page.evaluate(async () => {
		const { Fragmenter } = await import("/src/index.js");
		const css = `
			body { margin: 0; }
			.outer { counter-reset: n; }
			section { margin: 0; }
			p { margin: 0; height: 35px; counter-increment: n; }
			p::before { content: "N=" counters(n, ".") ";"; }
			.inner-start { counter-reset: n 10; }
		`;
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(css);
		document.adoptedStyleSheets = [sheet];
		const source = document.createElement("div");
		source.innerHTML = "<div class=\"outer\"><p>outer first</p><section><p class=\"inner-start\">inner first</p><p>inner second</p><p>inner third</p></section><p>outer second</p></div>";
		window.counterFlow = new Fragmenter(source, { width: 300, height: 80, styles: sheet });
		for (const fragment of window.counterFlow) document.body.appendChild(fragment);
	});
	const read = async () => {
		const client = await page.context().newCDPSession(page);
		try {
			const { documents, strings } = await client.send("DOMSnapshot.captureSnapshot", { computedStyles: [] });
			return documents.flatMap(({ layout }) => layout.text.map((index) => strings[index])).join("").match(/N=[\d.]+;/g) ?? [];
		} finally {
			await client.detach();
		}
	};
	expect(await read()).toEqual(["N=1;", "N=1.11;", "N=1.12;", "N=1.13;", "N=2;"]);
	await page.evaluate(() => {
		document.querySelectorAll("fragment-container").forEach((element) => element.remove());
		const fragments = window.counterFlow.reflow(0);
		for (const fragment of fragments) document.body.appendChild(fragment);
	});
	expect(await read()).toEqual(["N=1;", "N=1.11;", "N=1.12;", "N=1.13;", "N=2;"]);
	await page.evaluate(() => window.counterFlow.destroy());
});
