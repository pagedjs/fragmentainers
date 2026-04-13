import { test, expect } from "../browser-fixture.js";

test.describe("parseAnPlusB", () => {
	test("parses 'odd'", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseAnPlusB } = await import("/src/handlers/nth-selectors.js");
			return parseAnPlusB("odd");
		});
		expect(result).toEqual({ a: 2, b: 1 });
	});

	test("parses 'even'", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseAnPlusB } = await import("/src/handlers/nth-selectors.js");
			return parseAnPlusB("even");
		});
		expect(result).toEqual({ a: 2, b: 0 });
	});

	test("parses a plain integer", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseAnPlusB } = await import("/src/handlers/nth-selectors.js");
			return parseAnPlusB("3");
		});
		expect(result).toEqual({ a: 0, b: 3 });
	});

	test("parses negative integer", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseAnPlusB } = await import("/src/handlers/nth-selectors.js");
			return parseAnPlusB("-2");
		});
		expect(result).toEqual({ a: 0, b: -2 });
	});

	test("parses 'n'", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseAnPlusB } = await import("/src/handlers/nth-selectors.js");
			return parseAnPlusB("n");
		});
		expect(result).toEqual({ a: 1, b: 0 });
	});

	test("parses '-n+6'", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseAnPlusB } = await import("/src/handlers/nth-selectors.js");
			return parseAnPlusB("-n+6");
		});
		expect(result).toEqual({ a: -1, b: 6 });
	});

	test("parses '2n+1'", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseAnPlusB } = await import("/src/handlers/nth-selectors.js");
			return parseAnPlusB("2n+1");
		});
		expect(result).toEqual({ a: 2, b: 1 });
	});

	test("parses '2n'", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseAnPlusB } = await import("/src/handlers/nth-selectors.js");
			return parseAnPlusB("2n");
		});
		expect(result).toEqual({ a: 2, b: 0 });
	});

	test("parses '+n'", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseAnPlusB } = await import("/src/handlers/nth-selectors.js");
			return parseAnPlusB("+n");
		});
		expect(result).toEqual({ a: 1, b: 0 });
	});

	test("parses '-3n-2'", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseAnPlusB } = await import("/src/handlers/nth-selectors.js");
			return parseAnPlusB("-3n-2");
		});
		expect(result).toEqual({ a: -3, b: -2 });
	});

	test("handles whitespace", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseAnPlusB } = await import("/src/handlers/nth-selectors.js");
			return parseAnPlusB(" 2n + 1 ");
		});
		expect(result).toEqual({ a: 2, b: 1 });
	});
});

test.describe("matchesAnPlusB", () => {
	test("matches exact index", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { matchesAnPlusB } = await import("/src/handlers/nth-selectors.js");
			return {
				match3: matchesAnPlusB(3, { a: 0, b: 3 }),
				match2: matchesAnPlusB(2, { a: 0, b: 3 }),
			};
		});
		expect(result.match3).toBe(true);
		expect(result.match2).toBe(false);
	});

	test("matches odd (2n+1)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { matchesAnPlusB } = await import("/src/handlers/nth-selectors.js");
			return {
				m1: matchesAnPlusB(1, { a: 2, b: 1 }),
				m2: matchesAnPlusB(2, { a: 2, b: 1 }),
				m3: matchesAnPlusB(3, { a: 2, b: 1 }),
			};
		});
		expect(result.m1).toBe(true);
		expect(result.m2).toBe(false);
		expect(result.m3).toBe(true);
	});

	test("matches even (2n)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { matchesAnPlusB } = await import("/src/handlers/nth-selectors.js");
			return {
				m2: matchesAnPlusB(2, { a: 2, b: 0 }),
				m4: matchesAnPlusB(4, { a: 2, b: 0 }),
				m1: matchesAnPlusB(1, { a: 2, b: 0 }),
			};
		});
		expect(result.m2).toBe(true);
		expect(result.m4).toBe(true);
		expect(result.m1).toBe(false);
	});

	test("matches -n+3 (first 3 elements)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { matchesAnPlusB } = await import("/src/handlers/nth-selectors.js");
			return {
				m1: matchesAnPlusB(1, { a: -1, b: 3 }),
				m2: matchesAnPlusB(2, { a: -1, b: 3 }),
				m3: matchesAnPlusB(3, { a: -1, b: 3 }),
				m4: matchesAnPlusB(4, { a: -1, b: 3 }),
			};
		});
		expect(result.m1).toBe(true);
		expect(result.m2).toBe(true);
		expect(result.m3).toBe(true);
		expect(result.m4).toBe(false);
	});
});

test.describe("computeOriginalPosition", () => {
	test("computes position for a single child", async ({ page }) => {
		const pos = await page.evaluate(async () => {
			const { computeOriginalPosition } = await import("/src/handlers/nth-selectors.js");
			const parent = document.createElement("div");
			const child = document.createElement("p");
			parent.appendChild(child);
			document.body.appendChild(parent);
			const pos = computeOriginalPosition(child);
			document.body.removeChild(parent);
			return pos;
		});
		expect(pos).toEqual({
			childIndex: 1,
			typeIndex: 1,
			childFromEnd: 1,
			typeFromEnd: 1,
			totalChildren: 1,
			totalOfType: 1,
		});
	});

	test("computes position for middle child", async ({ page }) => {
		const pos = await page.evaluate(async () => {
			const { computeOriginalPosition } = await import("/src/handlers/nth-selectors.js");
			const parent = document.createElement("ul");
			parent.innerHTML = "<li>a</li><li>b</li><li>c</li>";
			document.body.appendChild(parent);
			const pos = computeOriginalPosition(parent.children[1]);
			document.body.removeChild(parent);
			return pos;
		});
		expect(pos.childIndex).toBe(2);
		expect(pos.typeIndex).toBe(2);
		expect(pos.childFromEnd).toBe(2);
		expect(pos.typeFromEnd).toBe(2);
	});

	test("handles mixed tag types", async ({ page }) => {
		const pos = await page.evaluate(async () => {
			const { computeOriginalPosition } = await import("/src/handlers/nth-selectors.js");
			const parent = document.createElement("div");
			parent.innerHTML = "<p>first</p><span>mid</span><p>last</p>";
			document.body.appendChild(parent);
			const lastP = parent.children[2];
			const pos = computeOriginalPosition(lastP);
			document.body.removeChild(parent);
			return pos;
		});
		expect(pos.childIndex).toBe(3);
		expect(pos.typeIndex).toBe(2);
		expect(pos.totalChildren).toBe(3);
		expect(pos.totalOfType).toBe(2);
	});

	test("returns null for orphan elements", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { computeOriginalPosition } = await import("/src/handlers/nth-selectors.js");
			const orphan = document.createElement("div");
			return computeOriginalPosition(orphan);
		});
		expect(result).toBeNull();
	});
});

test.describe("extractNthDescriptors", () => {
	test("extracts :first-child rules", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { extractNthDescriptors } = await import("/src/handlers/nth-selectors.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("li:first-child { color: red; }");
			const descriptors = extractNthDescriptors([sheet]);
			return {
				length: descriptors.length,
				baseSelector: descriptors[0].baseSelector,
				nthParts: descriptors[0].nthParts,
				cssText: descriptors[0].cssText,
			};
		});
		expect(result.length).toBe(1);
		expect(result.baseSelector).toBe("li");
		expect(result.nthParts).toEqual([{ a: 0, b: 1, isType: false, isLast: false }]);
		expect(result.cssText).toContain("color");
	});

	test("extracts :nth-child(odd) rules", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { extractNthDescriptors } = await import("/src/handlers/nth-selectors.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("li:nth-child(odd) { background: pink; }");
			const descriptors = extractNthDescriptors([sheet]);
			return {
				length: descriptors.length,
				a: descriptors[0].nthParts[0].a,
				b: descriptors[0].nthParts[0].b,
			};
		});
		expect(result.length).toBe(1);
		expect(result.a).toBe(2);
		expect(result.b).toBe(1);
	});

	test("captures @media wrappers", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { extractNthDescriptors } = await import("/src/handlers/nth-selectors.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("@media (min-width: 0px) { li:first-child { color: red; } }");
			const descriptors = extractNthDescriptors([sheet]);
			return {
				length: descriptors.length,
				wrappersLength: descriptors[0].wrappers.length,
				firstWrapper: descriptors[0].wrappers[0],
			};
		});
		expect(result.length).toBe(1);
		expect(result.wrappersLength).toBe(1);
		expect(result.firstWrapper).toContain("@media");
	});

	test("handles multiple sheets", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { extractNthDescriptors } = await import("/src/handlers/nth-selectors.js");
			const s1 = new CSSStyleSheet();
			s1.replaceSync("li:first-child { color: red; }");
			const s2 = new CSSStyleSheet();
			s2.replaceSync("p:last-child { font-weight: bold; }");
			return extractNthDescriptors([s1, s2]).length;
		});
		expect(result).toBe(2);
	});

	test("returns empty array for sheets without nth rules", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { extractNthDescriptors } = await import("/src/handlers/nth-selectors.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("div { color: blue; }");
			return extractNthDescriptors([sheet]).length;
		});
		expect(result).toBe(0);
	});
});

test.describe("buildPerFragmentNthSheet", () => {
	test("returns null for empty descriptors", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { buildPerFragmentNthSheet } = await import("/src/handlers/nth-selectors.js");
			const slot = document.createElement("div");
			slot.innerHTML = "<li>a</li><li>b</li>";
			return buildPerFragmentNthSheet(slot, []);
		});
		expect(result).toBeNull();
	});

	test("generates :is([data-ref=...]) rules for :first-child", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { buildPerFragmentNthSheet } = await import("/src/handlers/nth-selectors.js");
			const { handlers } = await import("/src/handlers/registry.js");

			const sourceUl = document.createElement("ul");
			sourceUl.innerHTML = "<li>a</li><li>b</li><li>c</li>";
			document.body.appendChild(sourceUl);

			const slot = document.createElement("div");
			slot.innerHTML = "<li>a</li><li>b</li><li>c</li>";

			const clones = slot.querySelectorAll("*");
			const sources = sourceUl.children;
			for (let i = 0; i < clones.length && i < sources.length; i++) {
				handlers.trackClone(clones[i], sources[i]);
			}

			const descriptors = [
				{
					baseSelector: "li",
					nthParts: [{ a: 0, b: 1, isType: false, isLast: false }],
					cssText: "color: red;",
					wrappers: [],
				},
			];

			const sheet = buildPerFragmentNthSheet(slot, descriptors);
			document.body.removeChild(sourceUl);

			if (!sheet) return null;
			return {
				cssRulesLength: sheet.cssRules.length,
				ruleText: sheet.cssRules[0].cssText,
			};
		});
		expect(result).not.toBeNull();
		expect(result.cssRulesLength).toBe(1);
		expect(result.ruleText).toContain("data-ref");
		expect(result.ruleText).toContain("color");
	});

	test("generates rules for :nth-child(odd)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { buildPerFragmentNthSheet } = await import("/src/handlers/nth-selectors.js");
			const { handlers } = await import("/src/handlers/registry.js");

			const sourceUl = document.createElement("ul");
			sourceUl.innerHTML = "<li>1</li><li>2</li><li>3</li><li>4</li>";
			document.body.appendChild(sourceUl);

			const slot = document.createElement("div");
			slot.innerHTML = "<li>1</li><li>2</li><li>3</li><li>4</li>";

			const clones = slot.querySelectorAll("*");
			const sources = sourceUl.children;
			for (let i = 0; i < clones.length && i < sources.length; i++) {
				handlers.trackClone(clones[i], sources[i]);
			}

			const descriptors = [
				{
					baseSelector: "li",
					nthParts: [{ a: 2, b: 1, isType: false, isLast: false }],
					cssText: "background: pink;",
					wrappers: [],
				},
			];

			const sheet = buildPerFragmentNthSheet(slot, descriptors);
			document.body.removeChild(sourceUl);

			if (!sheet) return null;
			const ruleText = sheet.cssRules[0].cssText;
			const matches = ruleText.match(/data-ref/g);
			return {
				cssRulesLength: sheet.cssRules.length,
				dataRefCount: matches ? matches.length : 0,
			};
		});
		expect(result).not.toBeNull();
		expect(result.cssRulesLength).toBe(1);
		expect(result.dataRefCount).toBe(2);
	});

	test("wraps rules in grouping contexts", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { buildPerFragmentNthSheet } = await import("/src/handlers/nth-selectors.js");
			const { handlers } = await import("/src/handlers/registry.js");

			const sourceUl = document.createElement("ul");
			sourceUl.innerHTML = "<li>a</li>";
			document.body.appendChild(sourceUl);

			const slot = document.createElement("div");
			slot.innerHTML = "<li>a</li>";

			const clones = slot.querySelectorAll("*");
			const sources = sourceUl.children;
			for (let i = 0; i < clones.length && i < sources.length; i++) {
				handlers.trackClone(clones[i], sources[i]);
			}

			const descriptors = [
				{
					baseSelector: "li",
					nthParts: [{ a: 0, b: 1, isType: false, isLast: false }],
					cssText: "color: red;",
					wrappers: ["@media (min-width: 0px)"],
				},
			];

			const sheet = buildPerFragmentNthSheet(slot, descriptors);
			document.body.removeChild(sourceUl);

			if (!sheet) return null;
			return {
				outerRuleText: sheet.cssRules[0].cssText,
				innerRuleText: sheet.cssRules[0].cssRules[0].cssText,
			};
		});
		expect(result).not.toBeNull();
		expect(result.outerRuleText).toContain("@media");
		expect(result.innerRuleText).toContain("data-ref");
	});

	test("returns null when no elements match", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { buildPerFragmentNthSheet } = await import("/src/handlers/nth-selectors.js");
			const { handlers } = await import("/src/handlers/registry.js");

			const sourceUl = document.createElement("ul");
			sourceUl.innerHTML = "<li>a</li><li>b</li>";
			document.body.appendChild(sourceUl);

			const slot = document.createElement("div");
			slot.innerHTML = "<li>a</li><li>b</li>";

			const clones = slot.querySelectorAll("*");
			const sources = sourceUl.children;
			for (let i = 0; i < clones.length && i < sources.length; i++) {
				handlers.trackClone(clones[i], sources[i]);
			}

			const descriptors = [
				{
					baseSelector: "li",
					nthParts: [{ a: 0, b: 5, isType: false, isLast: false }],
					cssText: "color: red;",
					wrappers: [],
				},
			];

			const sheet = buildPerFragmentNthSheet(slot, descriptors);
			document.body.removeChild(sourceUl);
			return sheet;
		});
		expect(result).toBeNull();
	});

	test("handles :last-child", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { buildPerFragmentNthSheet } = await import("/src/handlers/nth-selectors.js");
			const { handlers } = await import("/src/handlers/registry.js");

			const sourceUl = document.createElement("ul");
			sourceUl.innerHTML = "<li>a</li><li>b</li><li>c</li>";
			document.body.appendChild(sourceUl);

			const slot = document.createElement("div");
			slot.innerHTML = "<li>a</li><li>b</li><li>c</li>";

			const clones = slot.querySelectorAll("*");
			const sources = sourceUl.children;
			for (let i = 0; i < clones.length && i < sources.length; i++) {
				handlers.trackClone(clones[i], sources[i]);
			}

			const descriptors = [
				{
					baseSelector: "li",
					nthParts: [{ a: 0, b: 1, isType: false, isLast: true }],
					cssText: "color: blue;",
					wrappers: [],
				},
			];

			const sheet = buildPerFragmentNthSheet(slot, descriptors);
			document.body.removeChild(sourceUl);

			if (!sheet) return null;
			const ruleText = sheet.cssRules[0].cssText;
			const matches = ruleText.match(/data-ref/g);
			return { dataRefCount: matches ? matches.length : 0 };
		});
		expect(result).not.toBeNull();
		expect(result.dataRefCount).toBe(1);
	});

	test("handles :only-child (two nthParts)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { buildPerFragmentNthSheet } = await import("/src/handlers/nth-selectors.js");
			const { handlers } = await import("/src/handlers/registry.js");

			const sourceDiv = document.createElement("div");
			sourceDiv.innerHTML = "<p>only child</p>";
			document.body.appendChild(sourceDiv);

			const slot = document.createElement("div");
			slot.innerHTML = "<p>only child</p>";

			const clones = slot.querySelectorAll("*");
			const sources = sourceDiv.children;
			for (let i = 0; i < clones.length && i < sources.length; i++) {
				handlers.trackClone(clones[i], sources[i]);
			}

			const descriptors = [
				{
					baseSelector: "p",
					nthParts: [
						{ a: 0, b: 1, isType: false, isLast: false },
						{ a: 0, b: 1, isType: false, isLast: true },
					],
					cssText: "font-weight: bold;",
					wrappers: [],
				},
			];

			const sheet = buildPerFragmentNthSheet(slot, descriptors);
			document.body.removeChild(sourceDiv);

			if (!sheet) return null;
			return { ruleText: sheet.cssRules[0].cssText };
		});
		expect(result).not.toBeNull();
		expect(result.ruleText).toContain("data-ref");
	});
});
