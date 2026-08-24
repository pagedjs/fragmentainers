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

test.describe("native pseudo preservation", () => {
	test("skips materialization for marked native pseudos", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PseudoElements } = await import("/src/handlers/pseudo-elements.js");
			const { markNativePseudo } = await import("/src/handlers/index.js");

			const style = document.createElement("style");
			style.textContent = ".native::after { content: \"native\"; }";
			document.head.appendChild(style);

			const root = document.createElement("div");
			root.innerHTML = "<span class=\"native\"></span>";
			document.body.appendChild(root);

			const el = root.firstElementChild;
			markNativePseudo(el, "after");

			const handler = new PseudoElements();
			handler.beforeMeasurement(root);

			const hasMaterializedPseudo = el.querySelector("frag-pseudo") !== null;
			const nativeContent = getComputedStyle(el, "::after").content;

			root.remove();
			style.remove();

			return { hasMaterializedPseudo, nativeContent };
		});

		expect(result.hasMaterializedPseudo).toBe(false);
		expect(result.nativeContent).toBe('"native"');
	});

	test("keeps a counter ::after native through the full flow pipeline", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/index.js");
			const { markNativePseudo } = await import("/src/handlers/index.js");

			const sheet = new CSSStyleSheet();
			sheet.replaceSync(`
				p { counter-increment: fn; }
				[data-footnote-call]::after { content: counter(fn); }
				.other::after { content: counter(fn); }
			`);

			const template = document.createElement("template");
			template.innerHTML = "<p>Text<a data-footnote-call=\"\"></a></p><p class=\"other\">More</p>";
			const call = template.content.querySelector("[data-footnote-call]");
			markNativePseudo(call, "after");

			const layout = new Fragmenter(template.content, {
				width: 400,
				height: 400,
				styles: [sheet],
			});
			const el = layout.next().value;
			document.body.appendChild(el);

			const outCall = el.querySelector("[data-footnote-call]");
			const outOther = el.querySelector(".other");
			const res = {
				callHasFragPseudo: outCall.querySelector("frag-pseudo") !== null,
				callNative: getComputedStyle(outCall, "::after").content,
				otherHasFragPseudo: outOther.querySelector("frag-pseudo") !== null,
				otherNative: getComputedStyle(outOther, "::after").content,
			};
			el.remove();
			layout.destroy();
			return res;
		});

		expect(result.callHasFragPseudo).toBe(false);
		expect(result.callNative).toBe("counter(fn)");
		expect(result.otherHasFragPseudo).toBe(true);
		expect(result.otherNative).toBe("none");
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
