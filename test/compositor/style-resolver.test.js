import { test, expect } from "../browser-fixture.js";

test.describe("parseAnPlusB", () => {
	test("parses 'odd'", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseAnPlusB } = await import("/src/handlers/style-resolver.js");
			return parseAnPlusB("odd");
		});
		expect(result).toEqual({ a: 2, b: 1 });
	});

	test("parses 'even'", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseAnPlusB } = await import("/src/handlers/style-resolver.js");
			return parseAnPlusB("even");
		});
		expect(result).toEqual({ a: 2, b: 0 });
	});

	test("parses '2n+1'", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseAnPlusB } = await import("/src/handlers/style-resolver.js");
			return parseAnPlusB("2n+1");
		});
		expect(result).toEqual({ a: 2, b: 1 });
	});

	test("parses '-n+6'", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseAnPlusB } = await import("/src/handlers/style-resolver.js");
			return parseAnPlusB("-n+6");
		});
		expect(result).toEqual({ a: -1, b: 6 });
	});
});

test.describe("matchesAnPlusB", () => {
	test("matches odd (2n+1)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { matchesAnPlusB } = await import("/src/handlers/style-resolver.js");
			return [1, 2, 3].map((i) => matchesAnPlusB(i, { a: 2, b: 1 }));
		});
		expect(result).toEqual([true, false, true]);
	});

	test("matches -n+3 (first 3 elements)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { matchesAnPlusB } = await import("/src/handlers/style-resolver.js");
			return [1, 2, 3, 4].map((i) => matchesAnPlusB(i, { a: -1, b: 3 }));
		});
		expect(result).toEqual([true, true, true, false]);
	});
});

test.describe("computeOriginalPosition", () => {
	test("computes positions for mixed siblings", async ({ page }) => {
		const pos = await page.evaluate(async () => {
			const { computeOriginalPosition } = await import("/src/handlers/style-resolver.js");
			const parent = document.createElement("div");
			parent.innerHTML = "<p>1</p><span>2</span><p>3</p>";
			document.body.appendChild(parent);
			const result = computeOriginalPosition(parent.children[2]);
			document.body.removeChild(parent);
			return result;
		});
		expect(pos).toEqual({
			childIndex: 3,
			typeIndex: 2,
			childFromEnd: 1,
			typeFromEnd: 1,
			totalChildren: 3,
			totalOfType: 2,
		});
	});

	test("returns null for orphan elements", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { computeOriginalPosition } = await import("/src/handlers/style-resolver.js");
			return computeOriginalPosition(document.createElement("div"));
		});
		expect(result).toBeNull();
	});
});

test.describe("splitSelectorList", () => {
	test("splits on top-level commas", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { splitSelectorList } = await import("/src/styles/selector-utils.js");
			return splitSelectorList("a, b, c");
		});
		expect(result).toEqual(["a", "b", "c"]);
	});

	test("ignores commas inside parens", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { splitSelectorList } = await import("/src/styles/selector-utils.js");
			return splitSelectorList(":is(a, b), c");
		});
		expect(result).toEqual([":is(a, b)", "c"]);
	});

	test("ignores commas inside attribute brackets", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { splitSelectorList } = await import("/src/styles/selector-utils.js");
			return splitSelectorList('[data-x="a,b"], p');
		});
		expect(result).toEqual(['[data-x="a,b"]', "p"]);
	});
});

test.describe("tokenizeSelector", () => {
	test("tokenizes a single compound", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { tokenizeSelector } = await import("/src/styles/selector-utils.js");
			return tokenizeSelector("li.foo");
		});
		expect(result).toEqual([{ compound: "li.foo", combinator: null }]);
	});

	test("tokenizes descendant chain", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { tokenizeSelector } = await import("/src/styles/selector-utils.js");
			return tokenizeSelector("table tr td");
		});
		expect(result).toEqual([
			{ compound: "table", combinator: " " },
			{ compound: "tr", combinator: " " },
			{ compound: "td", combinator: null },
		]);
	});

	test("tokenizes mixed combinators", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { tokenizeSelector } = await import("/src/styles/selector-utils.js");
			return tokenizeSelector("table tr:last-of-type > td.tdr");
		});
		expect(result).toEqual([
			{ compound: "table", combinator: " " },
			{ compound: "tr:last-of-type", combinator: ">" },
			{ compound: "td.tdr", combinator: null },
		]);
	});

	test("keeps parens in a compound", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { tokenizeSelector } = await import("/src/styles/selector-utils.js");
			return tokenizeSelector("li:is(a, b)");
		});
		expect(result).toEqual([{ compound: "li:is(a, b)", combinator: null }]);
	});

	test("handles sibling combinators", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { tokenizeSelector } = await import("/src/styles/selector-utils.js");
			return tokenizeSelector("h1 + p ~ span");
		});
		expect(result).toEqual([
			{ compound: "h1", combinator: "+" },
			{ compound: "p", combinator: "~" },
			{ compound: "span", combinator: null },
		]);
	});
});

test.describe("extractNthDescriptors", () => {
	test("attaches :last-of-type to the correct compound", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { extractNthDescriptors } = await import("/src/handlers/style-resolver.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("table tr:last-of-type td { padding-bottom: 6px; }");
			return extractNthDescriptors([sheet]);
		});
		expect(result).toHaveLength(1);
		expect(result[0].compounds).toEqual([
			{ strippedCompound: "table", combinator: " ", nthParts: [] },
			{
				strippedCompound: "tr",
				combinator: " ",
				nthParts: [{ a: 0, b: 1, isType: true, isLast: true }],
			},
			{ strippedCompound: "td", combinator: null, nthParts: [] },
		]);
	});

	test("splits selector lists into independent descriptors", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { extractNthDescriptors } = await import("/src/handlers/style-resolver.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("tr:last-of-type td, p:first-child { color: red; }");
			return extractNthDescriptors([sheet]).length;
		});
		expect(result).toBe(2);
	});

	test("skips rules with no nth pseudos", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { extractNthDescriptors } = await import("/src/handlers/style-resolver.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("p { color: red; }");
			return extractNthDescriptors([sheet]).length;
		});
		expect(result).toBe(0);
	});

	test("skips rules whose nth is nested inside :not()", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { extractNthDescriptors } = await import("/src/handlers/style-resolver.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("li:not(:first-child) { color: red; }");
			return extractNthDescriptors([sheet]).length;
		});
		expect(result).toBe(0);
	});

	test("captures @media wrappers", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { extractNthDescriptors } = await import("/src/handlers/style-resolver.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("@media (min-width: 0px) { li:first-child { color: red; } }");
			return extractNthDescriptors([sheet]);
		});
		expect(result).toHaveLength(1);
		expect(result[0].wrappers).toHaveLength(1);
		expect(result[0].wrappers[0]).toContain("@media");
	});

	test("ignores @page rules with a page selector", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { extractNthDescriptors } = await import("/src/handlers/style-resolver.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("@page :first { font-family: serif; }");
			return extractNthDescriptors([sheet]).length;
		});
		expect(result).toBe(0);
	});
});

test.describe("StyleResolver — pre-stamping", () => {
	test("stamps data-ref on source elements during afterMeasurementSetup", async ({ page }) => {
		const stamps = await page.evaluate(async () => {
			const { StyleResolver } = await import("/src/handlers/style-resolver.js");
			const r = new StyleResolver();
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("p:first-child { color: red; }");
			for (const rule of sheet.cssRules) r.matchRule(rule, { wrappers: [] });

			const root = document.createElement("div");
			root.innerHTML = "<p>a</p><p>b</p><p>c</p>";
			document.body.appendChild(root);
			r.afterMeasurementSetup(root);
			const out = [...root.querySelectorAll("[data-ref]")].map((el) => el.textContent);
			document.body.removeChild(root);
			return out;
		});
		expect(stamps).toEqual(["a"]);
	});

	test("cloneNode propagates data-ref to clones", async ({ page }) => {
		const ref = await page.evaluate(async () => {
			const { StyleResolver } = await import("/src/handlers/style-resolver.js");
			const r = new StyleResolver();
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("p:first-child { color: red; }");
			for (const rule of sheet.cssRules) r.matchRule(rule, { wrappers: [] });

			const root = document.createElement("div");
			root.innerHTML = "<p>a</p><p>b</p>";
			document.body.appendChild(root);
			r.afterMeasurementSetup(root);
			const clone = root.cloneNode(true);
			document.body.removeChild(root);
			return clone.querySelector("p").getAttribute("data-ref");
		});
		expect(ref).not.toBeNull();
	});

	test("clears stamps when descriptors go empty (reflow with new rules)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { StyleResolver } = await import("/src/handlers/style-resolver.js");
			const r = new StyleResolver();

			const root = document.createElement("div");
			root.innerHTML = "<p>x</p>";
			document.body.appendChild(root);

			const first = new CSSStyleSheet();
			first.replaceSync("p:first-child { color: red; }");
			for (const rule of first.cssRules) r.matchRule(rule, { wrappers: [] });
			r.afterMeasurementSetup(root);
			const before = root.querySelector("p").hasAttribute("data-ref");

			r.resetRules();
			r.afterMeasurementSetup(root);
			const after = root.querySelector("p").hasAttribute("data-ref");

			document.body.removeChild(root);
			return { before, after };
		});
		expect(result.before).toBe(true);
		expect(result.after).toBe(false);
	});
});

test.describe("StyleResolver — emitted sheet", () => {
	test("emits per-element selector with [data-ref] anchor", async ({ page }) => {
		const cssText = await page.evaluate(async () => {
			const { StyleResolver } = await import("/src/handlers/style-resolver.js");
			const r = new StyleResolver();
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("p:first-child { color: red; }");
			for (const rule of sheet.cssRules) r.matchRule(rule, { wrappers: [] });

			const root = document.createElement("div");
			root.innerHTML = "<p>x</p>";
			document.body.appendChild(root);
			r.afterMeasurementSetup(root);
			const out = r.getAdoptedSheets()[0].cssRules[0].cssText;
			document.body.removeChild(root);
			return out;
		});
		expect(cssText).toContain('p[data-ref="0"]');
		expect(cssText).toContain("color: red !important");
		expect(cssText).not.toContain(":first-child");
	});

	test("groups multiple matches under one descriptor", async ({ page }) => {
		const sel = await page.evaluate(async () => {
			const { StyleResolver } = await import("/src/handlers/style-resolver.js");
			const r = new StyleResolver();
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("li:nth-child(odd) { color: red; }");
			for (const rule of sheet.cssRules) r.matchRule(rule, { wrappers: [] });

			const root = document.createElement("div");
			root.innerHTML = "<ul><li>1</li><li>2</li><li>3</li><li>4</li></ul>";
			document.body.appendChild(root);
			r.afterMeasurementSetup(root);
			const innerRule = r.getAdoptedSheets()[0].cssRules[0].cssText;
			document.body.removeChild(root);
			return innerRule;
		});
		expect(sel).toContain('li[data-ref="0"]');
		expect(sel).toContain('li[data-ref="1"]');
	});

	test("preserves @media wrappers around emitted rules", async ({ page }) => {
		const cssText = await page.evaluate(async () => {
			const { StyleResolver } = await import("/src/handlers/style-resolver.js");
			const { walkRules } = await import("/src/styles/walk-rules.js");
			const r = new StyleResolver();
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("@media print { p:first-child { color: red; } }");
			walkRules(sheet.cssRules, (rule, wrappers) => {
				r.matchRule(rule, { wrappers });
			});

			const root = document.createElement("div");
			root.innerHTML = "<p>x</p>";
			document.body.appendChild(root);
			r.afterMeasurementSetup(root);
			const out = r.getAdoptedSheets()[0].cssRules[0].cssText;
			document.body.removeChild(root);
			return out;
		});
		expect(cssText).toContain("@media print");
		expect(cssText).toContain("color: red !important");
	});
});

test.describe("emitNeutralizationCss", () => {
	test("emits per-property unset !important for structural-pseudo rules", async ({ page }) => {
		const out = await page.evaluate(async () => {
			const { emitNeutralizationCss } = await import("/src/styles/neutralize-structural-pseudos.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("tr:nth-child(odd) { color: red; background: blue; }");
			return emitNeutralizationCss([sheet]);
		});
		expect(out).toMatch(/tr:nth-child\((odd|2n\+1)\)/);
		expect(out).toContain("color: unset !important");
		expect(out).toContain("background-color: unset !important");
	});

	test("skips rules without structural pseudos", async ({ page }) => {
		const out = await page.evaluate(async () => {
			const { emitNeutralizationCss } = await import("/src/styles/neutralize-structural-pseudos.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("p { color: red; }");
			return emitNeutralizationCss([sheet]);
		});
		expect(out).toBe("");
	});

	test("selector lists only neutralize the structural-pseudo branches", async ({ page }) => {
		const out = await page.evaluate(async () => {
			const { emitNeutralizationCss } = await import("/src/styles/neutralize-structural-pseudos.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("p, tr:nth-child(even) { color: red; }");
			return emitNeutralizationCss([sheet]);
		});
		expect(out).toMatch(/tr:nth-child\((even|2n)\)/);
		expect(out).not.toMatch(/^p\s/);
	});

	test("preserves @media wrappers", async ({ page }) => {
		const out = await page.evaluate(async () => {
			const { emitNeutralizationCss } = await import("/src/styles/neutralize-structural-pseudos.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(`
				@media print {
					tr:first-child { color: blue; }
				}
			`);
			return emitNeutralizationCss([sheet]);
		});
		expect(out).toContain("@media print");
		expect(out).toContain("tr:first-child");
		expect(out).toContain("color: unset !important");
	});
});

test.describe("StyleResolver selector rewrite", () => {
	test("substitutes structural pseudo with [data-ref] and keeps surrounding compounds", async ({ page }) => {
		const ruleText = await page.evaluate(async () => {
			const { StyleResolver } = await import("/src/handlers/style-resolver.js");
			const r = new StyleResolver();
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("body tr.foo:nth-child(odd) { color: red; }");
			for (const rule of sheet.cssRules) r.matchRule(rule, { wrappers: [] });
			const root = document.createElement("div");
			root.innerHTML = `<table><tbody>
				<tr class="foo"><td>a</td></tr>
				<tr class="foo"><td>b</td></tr>
				<tr class="foo"><td>c</td></tr>
			</tbody></table>`;
			document.body.appendChild(root);
			r.afterMeasurementSetup(root);
			const [out] = r.getAdoptedSheets();
			const text = out ? [...out.cssRules].map((rr) => rr.cssText).join("\n") : "";
			document.body.removeChild(root);
			return text;
		});
		// Two odd-position trs (1st and 3rd) → two refs.
		expect(ruleText).toMatch(/tr\.foo\[data-ref="\d"\]/);
		expect(ruleText).toContain("color: red !important");
		expect(ruleText).not.toContain(":nth-child");
	});
});

test.describe("end-to-end cascade", () => {
	async function setupCascade(page, html, css) {
		return page.evaluate(
			async ({ html, css }) => {
				const { StyleResolver } = await import("/src/handlers/style-resolver.js");
				const { buildCompositeSheet } = await import("/src/styles/composite-sheet.js");
				await import("/src/components/fragment-container.js");

				const authorSheet = new CSSStyleSheet();
				authorSheet.replaceSync(css);
				document.adoptedStyleSheets = [...document.adoptedStyleSheets, authorSheet];

				const r = new StyleResolver();
				for (const rule of authorSheet.cssRules) r.matchRule(rule, { wrappers: [] });

				const source = document.createElement("div");
				source.innerHTML = html;
				document.body.appendChild(source);
				r.afterMeasurementSetup(source);

				const wrapper = document.createElement("fragment-container");
				const cloned = source.cloneNode(true);
				while (cloned.firstChild) wrapper.appendChild(cloned.firstChild);
				document.body.appendChild(wrapper);

				const composite = buildCompositeSheet({ sheets: [authorSheet] }, r.getAdoptedSheets(), null);
				document.adoptedStyleSheets = [...document.adoptedStyleSheets, composite];

				window.cascadeProbe = { source, wrapper, authorSheet, composite };
				return { wrapperReady: true };
			},
			{ html, css },
		);
	}

	async function teardownCascade(page) {
		await page.evaluate(() => {
			const { source, wrapper, authorSheet, composite } = window.cascadeProbe;
			document.body.removeChild(source);
			document.body.removeChild(wrapper);
			document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
				(s) => s !== authorSheet && s !== composite,
			);
			delete window.cascadeProbe;
		});
	}

	test("table tr:last-of-type td applies only to the last row's cells", async ({ page }) => {
		await setupCascade(
			page,
			`<table><tbody>
				<tr><td>r1c1</td><td>r1c2</td><td>r1c3</td></tr>
				<tr><td>r2c1</td><td>r2c2</td><td>r2c3</td></tr>
				<tr><td>r3c1</td><td>r3c2</td><td>r3c3</td></tr>
			</tbody></table>`,
			"table tr:last-of-type td { padding-bottom: 6px; }",
		);
		const observed = await page.evaluate(() => {
			const { wrapper } = window.cascadeProbe;
			return [...wrapper.querySelectorAll("td")].map((cell) => ({
				text: cell.textContent,
				paddingBottom: getComputedStyle(cell).paddingBottom,
			}));
		});
		await teardownCascade(page);

		const lastRow = observed.slice(-3);
		const earlier = observed.slice(0, -3);
		for (const cell of lastRow) {
			expect(cell.paddingBottom, `last cell "${cell.text}"`).toBe("6px");
		}
		for (const cell of earlier) {
			expect(cell.paddingBottom, `earlier cell "${cell.text}"`).not.toBe("6px");
		}
	});

	test("table tr:last-of-type > td (child combinator)", async ({ page }) => {
		await setupCascade(
			page,
			`<table><tbody>
				<tr><td>a</td><td>b</td></tr>
				<tr><td>c</td><td>d</td></tr>
			</tbody></table>`,
			"table tr:last-of-type > td { color: rgb(255, 0, 0); }",
		);
		const observed = await page.evaluate(() => {
			const { wrapper } = window.cascadeProbe;
			return [...wrapper.querySelectorAll("td")].map((cell) => ({
				text: cell.textContent,
				color: getComputedStyle(cell).color,
			}));
		});
		await teardownCascade(page);
		const red = "rgb(255, 0, 0)";
		expect(observed.find((c) => c.text === "a").color).not.toBe(red);
		expect(observed.find((c) => c.text === "c").color).toBe(red);
		expect(observed.find((c) => c.text === "d").color).toBe(red);
	});

	test("ul > li:nth-child(2) a applies only to second li's anchors", async ({ page }) => {
		await setupCascade(
			page,
			`<ul>
				<li><a>a1</a><a>a2</a></li>
				<li><a>b1</a><a>b2</a></li>
				<li><a>c1</a><a>c2</a></li>
			</ul>`,
			"ul > li:nth-child(2) a { color: rgb(255, 0, 0); }",
		);
		const observed = await page.evaluate(() => {
			const { wrapper } = window.cascadeProbe;
			return [...wrapper.querySelectorAll("a")].map((a) => ({
				text: a.textContent,
				color: getComputedStyle(a).color,
			}));
		});
		await teardownCascade(page);
		const red = "rgb(255, 0, 0)";
		expect(observed.find((a) => a.text === "a1").color).not.toBe(red);
		expect(observed.find((a) => a.text === "b1").color).toBe(red);
		expect(observed.find((a) => a.text === "b2").color).toBe(red);
		expect(observed.find((a) => a.text === "c1").color).not.toBe(red);
	});

	test("selector list (tr:last-of-type td, p:first-child) applies both branches", async ({ page }) => {
		await setupCascade(
			page,
			`<section>
				<p>first</p>
				<p>second</p>
			</section>
			<table><tbody>
				<tr><td>r1c1</td><td>r1c2</td></tr>
				<tr><td>r2c1</td><td>r2c2</td></tr>
			</tbody></table>`,
			"tr:last-of-type td, p:first-child { color: rgb(255, 0, 0); }",
		);
		const observed = await page.evaluate(() => {
			const { wrapper } = window.cascadeProbe;
			const items = [
				...wrapper.querySelectorAll("p"),
				...wrapper.querySelectorAll("td"),
			];
			return items.map((el) => ({
				text: el.textContent.trim(),
				color: getComputedStyle(el).color,
			}));
		});
		await teardownCascade(page);
		const red = "rgb(255, 0, 0)";
		expect(observed.find((i) => i.text === "first").color).toBe(red);
		expect(observed.find((i) => i.text === "second").color).not.toBe(red);
		expect(observed.find((i) => i.text === "r1c1").color).not.toBe(red);
		expect(observed.find((i) => i.text === "r2c1").color).toBe(red);
		expect(observed.find((i) => i.text === "r2c2").color).toBe(red);
	});

	test("per-element override wins over the original nth rule", async ({ page }) => {
		await setupCascade(
			page,
			"<table><tbody><tr><td>row1</td></tr><tr><td>row2</td></tr></tbody></table>",
			`tr { color: rgb(0, 0, 0); }
			 tr:nth-child(2) { color: rgb(255, 0, 0); }`,
		);
		const observed = await page.evaluate(() => {
			const { wrapper } = window.cascadeProbe;
			return [...wrapper.querySelectorAll("tr")].map((tr) =>
				getComputedStyle(tr.querySelector("td")).color,
			);
		});
		await teardownCascade(page);
		expect(observed[1]).toBe("rgb(255, 0, 0)");
	});
});
