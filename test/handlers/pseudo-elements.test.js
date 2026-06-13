import { test, expect } from "../browser-fixture.js";

test.describe("PseudoElements selector lists", () => {
	test("keeps a comma inside :is() intact when rewriting ::before", async ({ page }) => {
		const rules = await page.evaluate(async () => {
			const { PseudoElements } = await import("/src/handlers/pseudo-elements.js");
			const sheet = new CSSStyleSheet();
			sheet.insertRule(':is(h1, h2)::before { content: "\\bb "; color: red; }');
			const handler = new PseudoElements();
			handler.resetRules();
			handler.matchRule(sheet.cssRules[0], { wrappers: [] });
			const out = [];
			handler.appendRules(out);
			return out;
		});
		const styleRule = rules.find((r) => r.includes("frag-pseudo"));
		expect(styleRule).toContain(':is(h1, h2) > frag-pseudo[data-pseudo="before"]');
	});

	test("rewrites each selector in a comma-separated list", async ({ page }) => {
		const rules = await page.evaluate(async () => {
			const { PseudoElements } = await import("/src/handlers/pseudo-elements.js");
			const sheet = new CSSStyleSheet();
			sheet.insertRule('h1::before, .note::before { content: "x"; color: blue; }');
			const handler = new PseudoElements();
			handler.resetRules();
			handler.matchRule(sheet.cssRules[0], { wrappers: [] });
			const out = [];
			handler.appendRules(out);
			return out;
		});
		const styleRule = rules.find((r) => r.includes("frag-pseudo"));
		expect(styleRule).toContain('h1 > frag-pseudo[data-pseudo="before"]');
		expect(styleRule).toContain('.note > frag-pseudo[data-pseudo="before"]');
	});
});

test.describe("registry rule injection", () => {
	test("skips invalid rules instead of throwing", async ({ page }) => {
		const count = await page.evaluate(async () => {
			const { insertWrappedRule } = await import("/src/styles/walk-rules.js");
			const sheet = new CSSStyleSheet();
			insertWrappedRule(sheet, "h2) > frag-pseudo {{{ broken", []);
			insertWrappedRule(sheet, "h1 { color: red; }", []);
			return sheet.cssRules.length;
		});
		expect(count).toBe(1);
	});
});
