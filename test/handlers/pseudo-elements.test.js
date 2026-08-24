import { test, expect } from "../browser-fixture.js";

async function inspectMaterializedPseudo(
	page,
	{ css, html, pseudo = "before", updateProperty = null, updateValue = null },
) {
	return page.evaluate(
		async ({ css: sourceCSS, html: sourceHTML, pseudo: which, updateProperty, updateValue }) => {
			const { PseudoElements } = await import("/src/handlers/pseudo-elements.js");
			const sourceSheet = new CSSStyleSheet();
			sourceSheet.replaceSync(sourceCSS);
			const handler = new PseudoElements();
			handler.resetRules();
			for (const rule of sourceSheet.cssRules) {
				handler.matchRule(rule, { wrappers: [] });
			}
			const companionRules = [];
			handler.appendRules(companionRules);

			const style = document.createElement("style");
			style.textContent = `${sourceCSS}\n${companionRules.join("\n")}`;
			document.head.appendChild(style);
			const root = document.createElement("div");
			root.innerHTML = sourceHTML;
			document.body.appendChild(root);
			handler.beforeMeasurement(root);

			const target = root.querySelector(".target");
			const synthetic = target.querySelector(
				`:scope > frag-pseudo[data-pseudo="${which}"]`,
			);
			const capture = () => ({
				text: synthetic.textContent,
				relocatedContent: getComputedStyle(synthetic, `::${which}`).content,
				originalContent: getComputedStyle(target, `::${which}`).content,
				width: target.getBoundingClientRect().width,
				controls: Object.fromEntries(
					Array.from(root.querySelectorAll("[data-control]"), (element) => [
						element.dataset.control,
						element.getBoundingClientRect().width,
					]),
				),
			});

			const before = capture();
			let after = null;
			if (updateProperty) {
				target.style.setProperty(updateProperty, updateValue);
				after = capture();
			}

			root.remove();
			style.remove();
			return { before, after };
		},
		{ css, html, pseudo, updateProperty, updateValue },
	);
}

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

test.describe("PseudoElements content classification", () => {
	test("renders var content once and re-resolves an inline custom property", async ({ page }) => {
		const result = await inspectMaterializedPseudo(page, {
			css: `
				.target, [data-control] { display: inline-block; font: 20px/1 monospace; }
				.target { --label: "one"; }
				.target::before { content: var(--label); }
			`,
			html: `
				<span class="target"></span>
				<span data-control="one">one</span>
				<span data-control="updated">updated</span>
			`,
			updateProperty: "--label",
			updateValue: '"updated"',
		});

		expect(result.before.text).toBe("");
		expect(result.before.relocatedContent).toBe('"one"');
		expect(result.before.originalContent).toBe("none");
		expect(result.before.width).toBeCloseTo(result.before.controls.one, 1);
		expect(result.after.text).toBe("");
		expect(result.after.relocatedContent).toBe('"updated"');
		expect(result.after.width).toBeCloseTo(result.after.controls.updated, 1);
	});

	test("renders counter content once and re-resolves an inline counter reset", async ({ page }) => {
		const result = await inspectMaterializedPseudo(page, {
			css: `
				.target, [data-control] { display: inline-block; font: 20px/1 monospace; }
				.target { counter-reset: item 7; }
				.target::after { content: counter(item); }
			`,
			html: `
				<span class="target"></span>
				<span data-control="seven">7</span>
				<span data-control="updated">12345</span>
			`,
			pseudo: "after",
			updateProperty: "counter-reset",
			updateValue: "item 12345",
		});

		expect(result.before.text).toBe("");
		expect(result.before.relocatedContent).toBe("counter(item)");
		expect(result.before.originalContent).toBe("none");
		expect(result.before.width).toBeCloseTo(result.before.controls.seven, 1);
		expect(result.after.text).toBe("");
		expect(result.after.relocatedContent).toBe("counter(item)");
		expect(result.after.width).toBeCloseTo(result.after.controls.updated, 1);
	});

	test("keeps literal content as materialized text only", async ({ page }) => {
		const result = await inspectMaterializedPseudo(page, {
			css: `
				.target, [data-control] { display: inline-block; font: 20px/1 monospace; }
				.target::before { content: "literal"; }
			`,
			html: `
				<span class="target"></span>
				<span data-control="literal">literal</span>
			`,
		});

		expect(result.before.text).toBe("literal");
		expect(result.before.relocatedContent).toBe("none");
		expect(result.before.originalContent).toBe("none");
		expect(result.before.width).toBeCloseTo(result.before.controls.literal, 1);
	});

	test("keeps the content marker in the important cascade", async ({ page }) => {
		const result = await inspectMaterializedPseudo(page, {
			css: `
				.target, [data-control] { display: inline-block; font: 20px/1 monospace; }
				.target { --label: "generated"; }
				.target::before { content: var(--label) !important; }
				.target::before { content: "literal"; }
			`,
			html: `
				<span class="target"></span>
				<span data-control="generated">generated</span>
			`,
		});

		expect(result.before.text).toBe("");
		expect(result.before.relocatedContent).toBe('"generated"');
		expect(result.before.originalContent).toBe("none");
		expect(result.before.width).toBeCloseTo(result.before.controls.generated, 1);
	});

	test("lets a later literal clear an earlier relocation rule", async ({ page }) => {
		const result = await inspectMaterializedPseudo(page, {
			css: `
				.target, [data-control] { display: inline-block; font: 20px/1 monospace; }
				.target { --label: "generated"; }
				.target::before { content: var(--label); }
				.target::before { content: "literal"; }
			`,
			html: `
				<span class="target"></span>
				<span data-control="literal">literal</span>
			`,
		});

		expect(result.before.text).toBe("literal");
		expect(result.before.relocatedContent).toBe("none");
		expect(result.before.originalContent).toBe("none");
		expect(result.before.width).toBeCloseTo(result.before.controls.literal, 1);
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
