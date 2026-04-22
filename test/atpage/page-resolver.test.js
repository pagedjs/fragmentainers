import { test, expect } from "../browser-fixture.js";

test.describe("PageResolver", () => {
	test("returns default size when no rules", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const DEFAULT_SIZE = { inlineSize: 816, blockSize: 1056 };
			const resolver = new PageResolver([], DEFAULT_SIZE);
			const c = resolver.resolve(0, null, null);
			return {
				contentArea: c.contentArea,
				margins: c.margins,
			};
		});
		expect(result.margins).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
		expect(result.contentArea).toEqual({ inlineSize: 816, blockSize: 1056 });
	});

	test("defaults to US Letter when no size given", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver([]);
			const c = resolver.resolve(0, null, null);
			return c.contentArea;
		});
		expect(result).toEqual({ inlineSize: 816, blockSize: 1056 });
	});

	test("universal @page with explicit size", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const M0 = { top: "0px", right: "0px", bottom: "0px", left: "0px" };
			const resolver = new PageResolver([new PageRule({ size: "600px 800px", margin: M0 })], {
				inlineSize: 816,
				blockSize: 1056,
			});
			const c = resolver.resolve(0, null, null);
			return { inlineSize: c.contentArea.inlineSize, blockSize: c.contentArea.blockSize };
		});
		expect(result.inlineSize).toBe(600);
		expect(result.blockSize).toBe(800);
	});

	test("universal @page with named size (a4)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver([new PageRule({ size: "a4" })], {
				inlineSize: 816,
				blockSize: 1056,
			});
			const c = resolver.resolve(0, null, null);
			return { inlineSize: c.pageBoxSize.inlineSize, blockSize: c.pageBoxSize.blockSize };
		});
		expect(result.inlineSize).toBe(794);
		expect(result.blockSize).toBe(1123);
	});

	test("named size with landscape orientation", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver([new PageRule({ size: "letter landscape" })], {
				inlineSize: 816,
				blockSize: 1056,
			});
			const c = resolver.resolve(0, null, null);
			return { inlineSize: c.pageBoxSize.inlineSize, blockSize: c.pageBoxSize.blockSize };
		});
		expect(result.inlineSize).toBe(1056);
		expect(result.blockSize).toBe(816);
	});

	test("bare landscape rotates default", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const DEFAULT_SIZE = { inlineSize: 816, blockSize: 1056 };
			const resolver = new PageResolver([new PageRule({ size: "landscape" })], DEFAULT_SIZE);
			const c = resolver.resolve(0, null, null);
			return { inlineSize: c.pageBoxSize.inlineSize, blockSize: c.pageBoxSize.blockSize };
		});
		expect(result.inlineSize).toBe(1056);
		expect(result.blockSize).toBe(816);
	});

	test("applies margins and computes content area", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver(
				[new PageRule({ size: "800px 1000px", margin: { top: "50px", right: "40px", bottom: "50px", left: "40px" } })],
				{ inlineSize: 816, blockSize: 1056 },
			);
			const c = resolver.resolve(0, null, null);
			return { inlineSize: c.contentArea.inlineSize, blockSize: c.contentArea.blockSize };
		});
		expect(result.inlineSize).toBe(720);
		expect(result.blockSize).toBe(900);
	});

	test(":first pseudo-class matches only page 0", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const M0 = { top: "0px", right: "0px", bottom: "0px", left: "0px" };
			const resolver = new PageResolver(
				[
					new PageRule({ size: "600px 800px", margin: M0 }),
					new PageRule({ pseudo: ["first"], size: "400px 500px" }),
				],
				{ inlineSize: 816, blockSize: 1056 },
			);

			const c0 = resolver.resolve(0, null, null);
			const c1 = resolver.resolve(1, null, null);
			return { c0Inline: c0.contentArea.inlineSize, c1Inline: c1.contentArea.inlineSize };
		});
		expect(result.c0Inline).toBe(400);
		expect(result.c1Inline).toBe(600);
	});

	test(":left/:right alternate by page index", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver(
				[
					new PageRule({ size: "600px 800px" }),
					new PageRule({
						pseudo: ["right"],
						margin: { top: "0px", right: "100px", bottom: "0px", left: "0px" },
					}),
					new PageRule({ pseudo: ["left"], margin: { top: "0px", right: "0px", bottom: "0px", left: "100px" } }),
				],
				{ inlineSize: 816, blockSize: 1056 },
			);

			const c0 = resolver.resolve(0, null, null);
			const c1 = resolver.resolve(1, null, null);
			return {
				c0Right: c0.margins.right,
				c0Left: c0.margins.left,
				c1Left: c1.margins.left,
				c1Right: c1.margins.right,
			};
		});
		expect(result.c0Right).toBe(100);
		expect(result.c0Left).toBe(0);
		expect(result.c1Left).toBe(100);
		expect(result.c1Right).toBe(0);
	});

	test("named page rule matches only its named page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const M0 = { top: "0px", right: "0px", bottom: "0px", left: "0px" };
			const resolver = new PageResolver(
				[new PageRule({ size: "600px 800px", margin: M0 }), new PageRule({ name: "chapter", size: "500px 700px", margin: M0 })],
				{ inlineSize: 816, blockSize: 1056 },
			);

			const cNone = resolver.resolve(0, null, null);
			const chapterRoot = blockNode({ children: [blockNode({ page: "chapter" })] });
			const cChapter = resolver.resolve(1, chapterRoot, null);
			return {
				noneInline: cNone.contentArea.inlineSize,
				chapterInline: cChapter.contentArea.inlineSize,
			};
		});
		expect(result.noneInline).toBe(600);
		expect(result.chapterInline).toBe(500);
	});

	test("cascade: named+pseudo overrides named overrides pseudo overrides universal", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const M0 = { top: "0px", right: "0px", bottom: "0px", left: "0px" };
				const resolver = new PageResolver(
				[
					new PageRule({ size: "100px 100px", margin: M0 }),
					new PageRule({ pseudo: ["first"], size: "200px 200px", margin: M0 }),
					new PageRule({ name: "cover", size: "300px 300px", margin: M0 }),
					new PageRule({ name: "cover", pseudo: ["first"], size: "400px 400px", margin: M0 }),
				],
				{ inlineSize: 816, blockSize: 1056 },
			);

			const coverRoot = blockNode({ children: [blockNode({ page: "cover" })] });
			const c = resolver.resolve(0, coverRoot, null);
			return c.contentArea.inlineSize;
		});
		expect(result).toBe(400);
	});

	test("cascade: margins merge from multiple rules", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const resolver = new PageResolver(
				[
					new PageRule({ size: "600px 800px", margin: { top: "10px", right: "10px", bottom: "10px", left: "10px" } }),
					new PageRule({ name: "wide", margin: { left: "50px", right: "50px" } }),
				],
				{ inlineSize: 816, blockSize: 1056 },
			);

			const wideRoot = blockNode({ children: [blockNode({ page: "wide" })] });
			const c = resolver.resolve(0, wideRoot, null);
			return c.margins;
		});
		expect(result.top).toBe(10);
		expect(result.left).toBe(50);
		expect(result.right).toBe(50);
	});

	test("specificity: :first (0,1,0) beats :right (0,0,1) on first-right page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const M0 = { top: "0px", right: "0px", bottom: "0px", left: "0px" };
			const resolver = new PageResolver(
				[
					new PageRule({ pseudo: ["right"], size: "200px 200px", margin: M0 }),
					new PageRule({ pseudo: ["first"], size: "400px 400px", margin: M0 }),
				],
				{ inlineSize: 816, blockSize: 1056 },
			);
			return resolver.resolve(0, null, null).contentArea.inlineSize;
		});
		expect(result).toBe(400);
	});

	test("specificity: named (1,0,0) beats :blank:right (0,1,1)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			const M0 = { top: "0px", right: "0px", bottom: "0px", left: "0px" };
			const resolver = new PageResolver(
				[
					new PageRule({ pseudo: ["blank", "right"], size: "200px 200px", margin: M0 }),
					new PageRule({ name: "cover", size: "400px 400px", margin: M0 }),
				],
				{ inlineSize: 816, blockSize: 1056 },
			);
			const coverRoot = blockNode({ children: [blockNode({ page: "cover" })] });
			return resolver.resolve(0, coverRoot, null, true).contentArea.inlineSize;
		});
		expect(result).toBe(400);
	});

	test("specificity helpers produce [f,g,h] tuples and compare lexicographically", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { PageRule } = await import("/src/resolvers/page-resolver.js");
			const rA = new PageRule({ name: "artsy", pseudo: ["left"] });
			const rB = new PageRule({ name: "artsy", pseudo: ["first"] });
			const rC = new PageRule({ name: "artsy", pseudo: ["first", "left"] });
			const rD = new PageRule({ name: "artsy" });
			const rE = new PageRule({ pseudo: ["blank", "left"] });
			return {
				specA: rA.specificity,
				specB: rB.specificity,
				specC: rC.specificity,
				specD: rD.specificity,
				specE: rE.specificity,
				cBeatsA: rC.compareSpecificity(rA) > 0,
				cBeatsB: rC.compareSpecificity(rB) > 0,
				bBeatsA: rB.compareSpecificity(rA) > 0,
				aBeatsD: rA.compareSpecificity(rD) > 0,
				dBeatsE: rD.compareSpecificity(rE) > 0,
			};
		});
		expect(result.specA).toEqual([1, 0, 1]);
		expect(result.specB).toEqual([1, 1, 0]);
		expect(result.specC).toEqual([1, 1, 1]);
		expect(result.specD).toEqual([1, 0, 0]);
		expect(result.specE).toEqual([0, 1, 1]);
		expect(result.cBeatsA).toBe(true);
		expect(result.cBeatsB).toBe(true);
		expect(result.bBeatsA).toBe(true);
		expect(result.aBeatsD).toBe(true);
		expect(result.dBeatsE).toBe(true);
	});

	test("multi-pseudo: :blank:left only matches blank left pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver(
				[new PageRule({ pseudo: ["blank", "left"], size: "400px 400px" })],
				{ inlineSize: 816, blockSize: 1056 },
			);
			const blankLeft = resolver.resolve(1, null, null, true).contentArea.inlineSize;
			const blankRight = resolver.resolve(0, null, null, true).contentArea.inlineSize;
			const nonBlankLeft = resolver.resolve(1, null, null, false).contentArea.inlineSize;
			return { blankLeft, blankRight, nonBlankLeft };
		});
		expect(result.blankLeft).toBe(400);
		expect(result.blankRight).toBe(816);
		expect(result.nonBlankLeft).toBe(816);
	});

	test("document-order tiebreak: later rule wins at equal specificity", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const M0 = { top: "0px", right: "0px", bottom: "0px", left: "0px" };
			const resolver = new PageResolver(
				[
					new PageRule({ size: "300px 300px", margin: M0 }),
					new PageRule({ size: "500px 500px", margin: M0 }),
				],
				{ inlineSize: 816, blockSize: 1056 },
			);
			return resolver.resolve(0, null, null).contentArea.inlineSize;
		});
		expect(result).toBe(500);
	});

	test("invalid pseudo-class causes rule to be dropped", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parsePageRulesFromCSS } = await import("/src/resolvers/page-resolver.js");
			const rules = parsePageRulesFromCSS([
				"@page :unknown { size: 300px 300px; }",
				"@page { size: 500px 500px; }",
			]);
			return rules.map((r) => ({ name: r.name, pseudo: r.pseudo }));
		});
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ name: null, pseudo: [] });
	});

	test("selector parser: multi-pseudo tokenizer", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parsePageSelector } = await import("/src/resolvers/page-resolver.js");
			return {
				empty: parsePageSelector(""),
				namedOnly: parsePageSelector("artsy"),
				pseudoOnly: parsePageSelector(":first"),
				namedPseudo: parsePageSelector("artsy:first"),
				multiPseudo: parsePageSelector(":blank:left"),
				namedMulti: parsePageSelector("artsy:first:left"),
				dedup: parsePageSelector(":first:first:left"),
				caseInsensitive: parsePageSelector(":FIRST:Left"),
				invalid: parsePageSelector(":unknown"),
				mixedInvalid: parsePageSelector("artsy:first:bogus"),
			};
		});
		expect(result.empty).toEqual({ name: null, pseudo: [], nth: null });
		expect(result.namedOnly).toEqual({ name: "artsy", pseudo: [], nth: null });
		expect(result.pseudoOnly).toEqual({ name: null, pseudo: ["first"], nth: null });
		expect(result.namedPseudo).toEqual({ name: "artsy", pseudo: ["first"], nth: null });
		expect(result.multiPseudo).toEqual({ name: null, pseudo: ["blank", "left"], nth: null });
		expect(result.namedMulti).toEqual({ name: "artsy", pseudo: ["first", "left"], nth: null });
		expect(result.dedup).toEqual({ name: null, pseudo: ["first", "left"], nth: null });
		expect(result.caseInsensitive).toEqual({ name: null, pseudo: ["first", "left"], nth: null });
		expect(result.invalid).toBeNull();
		expect(result.mixedInvalid).toBeNull();
	});

	test("selector parser: :nth() argument forms", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parsePageSelector } = await import("/src/resolvers/page-resolver.js");
			return {
				integer: parsePageSelector(":nth(2)"),
				everyTwo: parsePageSelector(":nth(2n)"),
				odd: parsePageSelector(":nth(2n+1)"),
				oddKeyword: parsePageSelector(":nth(odd)"),
				evenKeyword: parsePageSelector(":nth(even)"),
				negative: parsePageSelector(":nth(-n+3)"),
				named: parsePageSelector("chapter:nth(2)"),
				combined: parsePageSelector(":nth(2):first"),
				whitespace: parsePageSelector(":nth( 2n + 1 )"),
				caseInsensitive: parsePageSelector(":NTH(2)"),
				missingArg: parsePageSelector(":nth"),
				emptyArg: parsePageSelector(":nth()"),
				bareWithArg: parsePageSelector(":first(2)"),
				bogusArg: parsePageSelector(":nth(abc)"),
				duplicateNth: parsePageSelector(":nth(2):nth(3)"),
				spacedName: parsePageSelector("chapter :first"),
			};
		});
		expect(result.integer).toEqual({ name: null, pseudo: [], nth: { a: 0, b: 2 } });
		expect(result.everyTwo).toEqual({ name: null, pseudo: [], nth: { a: 2, b: 0 } });
		expect(result.odd).toEqual({ name: null, pseudo: [], nth: { a: 2, b: 1 } });
		expect(result.oddKeyword).toEqual({ name: null, pseudo: [], nth: { a: 2, b: 1 } });
		expect(result.evenKeyword).toEqual({ name: null, pseudo: [], nth: { a: 2, b: 0 } });
		expect(result.negative).toEqual({ name: null, pseudo: [], nth: { a: -1, b: 3 } });
		expect(result.named).toEqual({ name: "chapter", pseudo: [], nth: { a: 0, b: 2 } });
		expect(result.combined).toEqual({ name: null, pseudo: ["first"], nth: { a: 0, b: 2 } });
		expect(result.whitespace).toEqual({ name: null, pseudo: [], nth: { a: 2, b: 1 } });
		expect(result.caseInsensitive).toEqual({ name: null, pseudo: [], nth: { a: 0, b: 2 } });
		expect(result.missingArg).toBeNull();
		expect(result.emptyArg).toBeNull();
		expect(result.bareWithArg).toBeNull();
		expect(result.bogusArg).toBeNull();
		expect(result.duplicateNth).toBeNull();
		expect(result.spacedName).toEqual({ name: "chapter", pseudo: ["first"], nth: null });
	});

	test("matchRules: :nth(2n) fires on every even page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const rule = new PageRule({ nth: { a: 2, b: 0 }, margin: { top: "50px", right: "0px", bottom: "0px", left: "0px" } });
			const resolver = new PageResolver([new PageRule({ size: "600px 800px" }), rule]);
			return [0, 1, 2, 3, 4].map(
				(i) => resolver.matchRules(i, null, false).includes(rule),
			);
		});
		expect(result).toEqual([false, true, false, true, false]);
	});

	test("matchRules: :nth(-n+3) matches only the first three pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const rule = new PageRule({ nth: { a: -1, b: 3 } });
			const resolver = new PageResolver([new PageRule({ size: "600px 800px" }), rule]);
			return [0, 1, 2, 3, 4].map(
				(i) => resolver.matchRules(i, null, false).includes(rule),
			);
		});
		expect(result).toEqual([true, true, true, false, false]);
	});

	test("specificity: :nth() bumps the g component like :first", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule } = await import("/src/resolvers/page-resolver.js");
			return {
				bare: new PageRule().specificity,
				nth: new PageRule({ nth: { a: 0, b: 2 } }).specificity,
				first: new PageRule({ pseudo: ["first"] }).specificity,
			};
		});
		expect(result.bare).toEqual([0, 0, 0]);
		expect(result.nth).toEqual([0, 1, 0]);
		expect(result.first).toEqual([0, 1, 0]);
	});

	test("pageOrientation: rotate-left swaps dimensions", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver(
				[new PageRule({ size: "600px 800px", pageOrientation: "rotate-left" })],
				{ inlineSize: 816, blockSize: 1056 },
			);
			const c = resolver.resolve(0, null, null);
			return { inlineSize: c.pageBoxSize.inlineSize, blockSize: c.pageBoxSize.blockSize };
		});
		expect(result.inlineSize).toBe(800);
		expect(result.blockSize).toBe(600);
	});

	test("toConstraintSpace() produces correct values", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver(
				[new PageRule({ size: "600px 800px", margin: { top: "20px", right: "20px", bottom: "20px", left: "20px" } })],
				{ inlineSize: 816, blockSize: 1056 },
			);

			const c = resolver.resolve(0, null, null);
			const cs = c.toConstraintSpace();
			return {
				availableInlineSize: cs.availableInlineSize,
				availableBlockSize: cs.availableBlockSize,
				fragmentainerBlockSize: cs.fragmentainerBlockSize,
				blockOffsetInFragmentainer: cs.blockOffsetInFragmentainer,
				fragmentationType: cs.fragmentationType,
			};
		});
		expect(result.availableInlineSize).toBe(560);
		expect(result.availableBlockSize).toBe(760);
		expect(result.fragmentainerBlockSize).toBe(760);
		expect(result.blockOffsetInFragmentainer).toBe(0);
		expect(result.fragmentationType).toBe("page");
	});

	test("isFirst, isVerso, isRecto flags", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const DEFAULT_SIZE = { inlineSize: 816, blockSize: 1056 };
			const resolver = new PageResolver([], DEFAULT_SIZE);

			const c0 = resolver.resolve(0, null, null);
			const c1 = resolver.resolve(1, null, null);
			return {
				c0First: c0.isFirst,
				c0Verso: c0.isVerso,
				c0Recto: c0.isRecto,
				c1First: c1.isFirst,
				c1Verso: c1.isVerso,
				c1Recto: c1.isRecto,
			};
		});
		expect(result.c0First).toBe(true);
		expect(result.c0Verso).toBe(false);
		expect(result.c0Recto).toBe(true);
		expect(result.c1First).toBe(false);
		expect(result.c1Verso).toBe(true);
		expect(result.c1Recto).toBe(false);
	});
});

test.describe("PageResolver constructor with plain objects", () => {
	test("empty array falls back to default size", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const DEFAULT_SIZE = { inlineSize: 816, blockSize: 1056 };
			const resolver = new PageResolver([], DEFAULT_SIZE);
			const c = resolver.resolve(0, null, null);
			return { contentArea: c.contentArea, margins: c.margins };
		});
		expect(result.margins).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
		expect(result.contentArea).toEqual({ inlineSize: 816, blockSize: 1056 });
	});

	test("universal rule with named size 'A4'", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver(
				[{ size: "A4" }],
				{ inlineSize: 816, blockSize: 1056 },
			);
			const c = resolver.resolve(0, null, null);
			return { inlineSize: c.pageBoxSize.inlineSize, blockSize: c.pageBoxSize.blockSize };
		});
		expect(result.inlineSize).toBe(794);
		expect(result.blockSize).toBe(1123);
	});

	test("named page + node.page lookup", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver(
				[
					{ size: "210mm 297mm" },
					{ name: "chapter", size: "148mm 210mm" },
				],
				{ inlineSize: 816, blockSize: 1056 },
			);
			const rootNode = { children: [{ page: "chapter", children: [] }] };
			const c = resolver.resolve(0, rootNode, null);
			return { namedPage: c.namedPage, inlineSize: c.pageBoxSize.inlineSize };
		});
		expect(result.namedPage).toBe("chapter");
		expect(result.inlineSize).toBe(559);
	});

	test(":first pseudo matches only page 0", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver([
				{ size: "500px 500px" },
				{
					pseudo: ["first"],
					size: "300px 300px",
				},
			]);
			const p0 = resolver.resolve(0, null, null).pageBoxSize.inlineSize;
			const p1 = resolver.resolve(1, null, null).pageBoxSize.inlineSize;
			return { p0, p1 };
		});
		expect(result.p0).toBe(300);
		expect(result.p1).toBe(500);
	});

	test(":nth(2n+1) matches odd pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseAnPlusB } = await import("/src/styles/an-plus-b.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver([
				{ size: "500px 500px" },
				{
					nth: parseAnPlusB("2n+1"),
					size: "300px 300px",
				},
			]);
			return [0, 1, 2, 3].map(
				(i) => resolver.resolve(i, null, null).pageBoxSize.inlineSize,
			);
		});
		expect(result).toEqual([300, 500, 300, 500]);
	});

	test(":blank pseudo matches only blank pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver([
				{ size: "500px 500px" },
				{
					pseudo: ["blank"],
					size: "200px 200px",
				},
			]);
			const blank = resolver.resolve(0, null, null, true).pageBoxSize.inlineSize;
			const normal = resolver.resolve(0, null, null, false).pageBoxSize.inlineSize;
			return { blank, normal };
		});
		expect(result.blank).toBe(200);
		expect(result.normal).toBe(500);
	});

	test("mixed margin longhands — unset sides default to 0", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver([
				{
					size: "800px 1000px",
					margin: { top: "50px", left: "40px" },
				},
			]);
			const c = resolver.resolve(0, null, null);
			return c.margins;
		});
		expect(result).toEqual({ top: 50, right: 0, bottom: 0, left: 40 });
	});

	test("CSS length units resolve to px", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver([
				{
					size: "210mm 297mm",
					margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
				},
			]);
			const c = resolver.resolve(0, null, null);
			return {
				pageBoxSize: c.pageBoxSize,
				margins: c.margins,
			};
		});
		expect(result.pageBoxSize).toEqual({ inlineSize: 794, blockSize: 1123 });
		// 10mm at 96 DPI ≈ 37.795 → rounds to 38
		expect(result.margins).toEqual({ top: 38, right: 38, bottom: 38, left: 38 });
	});

	test("mixed input: PageRule + plain object in the same array", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver(
				[
					new PageRule({ size: "600px 800px" }),
					{ name: "chapter", size: "400px 500px" },
				],
				{ inlineSize: 816, blockSize: 1056 },
			);
			const universal = resolver.resolve(0, null, null).pageBoxSize;
			const rootNode = { children: [{ page: "chapter", children: [] }] };
			const named = resolver.resolve(0, rootNode, null).pageBoxSize;
			return { universal, named };
		});
		expect(result.universal).toEqual({ inlineSize: 600, blockSize: 800 });
		expect(result.named).toEqual({ inlineSize: 400, blockSize: 500 });
	});

	test("parity: fromStyleSheets vs plain objects produce identical PageConstraints", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");

			const css = `
				@page { size: 210mm 297mm; margin: 20mm; }
				@page :first { margin-top: 40mm; }
				@page :left { margin-left: 30mm; }
			`;
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(css);
			const fromSheet = PageResolver.fromStyleSheets([sheet]);

			const fromData = new PageResolver([
				{
					size: "210mm 297mm",
					margin: { top: "20mm", right: "20mm", bottom: "20mm", left: "20mm" },
				},
				{
					pseudo: ["first"],
					margin: { top: "40mm" },
				},
				{
					pseudo: ["left"],
					margin: { left: "30mm" },
				},
			]);

			const snapshot = (r, i) => {
				const c = r.resolve(i, null, null);
				return {
					pageBoxSize: c.pageBoxSize,
					margins: c.margins,
					contentArea: c.contentArea,
					isFirst: c.isFirst,
					isVerso: c.isVerso,
				};
			};

			return [0, 1, 2, 3].map((i) => ({
				sheet: snapshot(fromSheet, i),
				data: snapshot(fromData, i),
			}));
		});
		for (const row of result) {
			expect(row.data).toEqual(row.sheet);
		}
	});

	test("plain objects are accepted by the constructor", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver([
				{ name: null, pseudo: ["first"], size: "500px 500px" },
			]);
			return resolver.pageRules.map((r) => r.size);
		});
		expect(result).toEqual(["500px 500px"]);
	});
});

test.describe("PageResolver.fromStyleSheets", () => {
	test("extracts PageRules from a CSSStyleSheet", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(`
				@page chapter:first { size: A4; margin: 10mm 20mm; }
				@page :left { margin-left: 30mm; }
			`);
			return PageResolver.fromStyleSheets([sheet]).pageRules;
		});
		expect(result).toHaveLength(2);
		expect(result[0].name).toBe("chapter");
		expect(result[0].pseudo).toEqual(["first"]);
		expect(result[0].size).toBe("a4");
		expect(result[0].margin.top).toBe("10mm");
		expect(result[0].margin.left).toBe("20mm");
		expect(result[1].name).toBe(null);
		expect(result[1].pseudo).toEqual(["left"]);
		expect(result[1].margin.left).toBe("30mm");
	});
});

test.describe("parseNumeric", () => {
	test("parses px", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseNumeric } = await import("/src/styles/css-values.js");
			return parseNumeric("100px").to("px").value;
		});
		expect(result).toBe(100);
	});

	test("parses in", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseNumeric } = await import("/src/styles/css-values.js");
			return parseNumeric("1in").to("px").value;
		});
		expect(result).toBe(96);
	});

	test("parses cm", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseNumeric } = await import("/src/styles/css-values.js");
			return parseNumeric("2.54cm").to("px").value;
		});
		expect(Math.abs(result - 96) < 0.01).toBeTruthy();
	});

	test("parses mm", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseNumeric } = await import("/src/styles/css-values.js");
			return parseNumeric("25.4mm").to("px").value;
		});
		expect(Math.abs(result - 96) < 0.01).toBeTruthy();
	});

	test("parses pt", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseNumeric } = await import("/src/styles/css-values.js");
			return parseNumeric("72pt").to("px").value;
		});
		expect(result).toBe(96);
	});

	test("parses bare number as px", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseNumeric } = await import("/src/styles/css-values.js");
			return parseNumeric("50").to("px").value;
		});
		expect(result).toBe(50);
	});

	test("parses calc expressions", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseNumeric } = await import("/src/styles/css-values.js");
			return parseNumeric("calc(1in + 2mm)").to("px").value;
		});
		expect(Math.abs(result - (96 + (2 * 96) / 25.4)) < 0.01).toBeTruthy();
	});

	test("returns null for invalid", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseNumeric } = await import("/src/styles/css-values.js");
			return parseNumeric("abc");
		});
		expect(result).toBe(null);
	});
});

test.describe("getNamedPage", () => {
	test("returns page property from node", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getNamedPage } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			return getNamedPage(blockNode({ page: "cover" }));
		});
		expect(result).toBe("cover");
	});

	test("returns null for node with no page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getNamedPage } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			return getNamedPage(blockNode());
		});
		expect(result).toBe(null);
	});

	test("returns null for null node", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getNamedPage } = await import("/src/resolvers/page-resolver.js");
			return getNamedPage(null);
		});
		expect(result).toBe(null);
	});
});

test.describe("resolveNamedPageForBreakToken", () => {
	test("returns first child page when no break token", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { resolveNamedPageForBreakToken } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const root = blockNode({
				children: [blockNode({ page: "cover" }), blockNode({ page: "chapter" })],
			});
			return resolveNamedPageForBreakToken(root, null);
		});
		expect(result).toBe("cover");
	});

	test("returns null when first child has no page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { resolveNamedPageForBreakToken } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const root = blockNode({
				children: [blockNode(), blockNode()],
			});
			return resolveNamedPageForBreakToken(root, null);
		});
		expect(result).toBe(null);
	});

	test("returns page of isBreakBefore child", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { resolveNamedPageForBreakToken } = await import("/src/resolvers/page-resolver.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const childB = blockNode({ debugName: "B", page: "chapter" });
			const root = blockNode({
				children: [blockNode({ debugName: "A" }), childB],
			});

			const bt = new BlockBreakToken(root);
			const childBT = BlockBreakToken.createBreakBefore(childB, true);
			bt.childBreakTokens.push(childBT);

			return resolveNamedPageForBreakToken(root, bt);
		});
		expect(result).toBe("chapter");
	});

	test("returns page of next sibling when break inside a child", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { resolveNamedPageForBreakToken } = await import("/src/resolvers/page-resolver.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const childA = blockNode({ debugName: "A", blockSize: 200 });
			const childB = blockNode({ debugName: "B", page: "appendix" });
			const root = blockNode({
				children: [childA, childB],
			});

			const bt = new BlockBreakToken(root);
			const childAToken = new BlockBreakToken(childA);
			childAToken.consumedBlockSize = 100;
			bt.childBreakTokens.push(childAToken);

			return resolveNamedPageForBreakToken(root, bt);
		});
		expect(result).toBe("appendix");
	});
});

test.describe("Named page forced breaks", () => {
	test("forces break when page property changes between siblings", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50, page: "cover" }),
					blockNode({ debugName: "B", blockSize: 50, page: "chapter" }),
					blockNode({ debugName: "C", blockSize: 50, page: "chapter" }),
				],
			});

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 1000,
					fragmentainerBlockSize: 1000,
					fragmentationType: "page",
				}),
			);
			return {
				length: pages.length,
				page0Children: pages[0].childFragments.length,
				page1Children: pages[1].childFragments.length,
			};
		});
		expect(result.length).toBe(2);
		expect(result.page0Children).toBe(1);
		expect(result.page1Children).toBe(2);
	});

	test("forces break when changing from named to null", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50, page: "cover" }),
					blockNode({ debugName: "B", blockSize: 50 }),
				],
			});

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 1000,
					fragmentainerBlockSize: 1000,
					fragmentationType: "page",
				}),
			);
			return pages.length;
		});
		expect(result).toBe(2);
	});

	test("forces break when changing from null to named", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50 }),
					blockNode({ debugName: "B", blockSize: 50, page: "chapter" }),
				],
			});

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 1000,
					fragmentainerBlockSize: 1000,
					fragmentationType: "page",
				}),
			);
			return pages.length;
		});
		expect(result).toBe(2);
	});

	test("no break when both siblings have same page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50, page: "chapter" }),
					blockNode({ debugName: "B", blockSize: 50, page: "chapter" }),
				],
			});

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 1000,
					fragmentainerBlockSize: 1000,
					fragmentationType: "page",
				}),
			);
			return pages.length;
		});
		expect(result).toBe(1);
	});

	test("no break when both siblings have null page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50 }),
					blockNode({ debugName: "B", blockSize: 50 }),
				],
			});

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 1000,
					fragmentainerBlockSize: 1000,
					fragmentationType: "page",
				}),
			);
			return pages.length;
		});
		expect(result).toBe(1);
	});

	test("forced break token has isForcedBreak = true", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50, page: "cover" }),
					blockNode({ debugName: "B", blockSize: 50, page: "chapter" }),
				],
			});

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 1000,
					fragmentainerBlockSize: 1000,
					fragmentationType: "page",
				}),
			);
			return pages[0].breakToken.childBreakTokens[0].isForcedBreak;
		});
		expect(result).toBe(true);
	});
});

test.describe("createFragments with PageResolver", () => {
	test("resolves page sizes dynamically", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-driver.js");
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const DEFAULT_SIZE = { inlineSize: 600, blockSize: 1000 };
			const M0 = { top: "0px", right: "0px", bottom: "0px", left: "0px" };
			const resolver = new PageResolver([new PageRule({ size: "600px 1000px", margin: M0 })], DEFAULT_SIZE);

			const root = blockNode({
				children: [blockNode({ blockSize: 800 }), blockNode({ blockSize: 800 })],
			});

			const pages = createFragments(root, resolver);
			return {
				length: pages.length,
				hasConstraints: !!pages[0].constraints,
				inlineSize: pages[0].constraints.contentArea.inlineSize,
			};
		});
		expect(result.length).toBe(2);
		expect(result.hasConstraints).toBe(true);
		expect(result.inlineSize).toBe(600);
	});

	test("uses named page sizes for different pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-driver.js");
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const M0 = { top: "0px", right: "0px", bottom: "0px", left: "0px" };
				const resolver = new PageResolver(
				[new PageRule({ size: "600px 200px", margin: M0 }), new PageRule({ name: "wide", size: "800px 200px", margin: M0 })],
				{ inlineSize: 600, blockSize: 200 },
			);

			const root = blockNode({
				children: [
					blockNode({ debugName: "narrow", blockSize: 50 }),
					blockNode({ debugName: "wide-content", blockSize: 50, page: "wide" }),
				],
			});

			const pages = createFragments(root, resolver);
			return {
				length: pages.length,
				page0Inline: pages[0].constraints.contentArea.inlineSize,
				page1Inline: pages[1].constraints.contentArea.inlineSize,
				page1Named: pages[1].constraints.namedPage,
			};
		});
		expect(result.length).toBe(2);
		expect(result.page0Inline).toBe(600);
		expect(result.page1Inline).toBe(800);
		expect(result.page1Named).toBe("wide");
	});

	test("accepts a plain ConstraintSpace (no resolver)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const root = blockNode({
				children: [blockNode({ blockSize: 50 })],
			});

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);
			return {
				length: pages.length,
				constraints: pages[0].constraints,
			};
		});
		expect(result.length).toBe(1);
		expect(result.constraints).toBe(null);
	});
});
