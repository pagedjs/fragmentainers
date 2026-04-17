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
			const M0 = { top: 0, right: 0, bottom: 0, left: 0 };
			const resolver = new PageResolver([new PageRule({ size: [600, 800], margin: M0 })], {
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
				[new PageRule({ size: [800, 1000], margin: { top: 50, right: 40, bottom: 50, left: 40 } })],
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
			const M0 = { top: 0, right: 0, bottom: 0, left: 0 };
			const resolver = new PageResolver(
				[
					new PageRule({ size: [600, 800], margin: M0 }),
					new PageRule({ pseudoClasses: ["first"], size: [400, 500] }),
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
					new PageRule({ size: [600, 800] }),
					new PageRule({
						pseudoClasses: ["right"],
						margin: { top: 0, right: 100, bottom: 0, left: 0 },
					}),
					new PageRule({ pseudoClasses: ["left"], margin: { top: 0, right: 0, bottom: 0, left: 100 } }),
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

			const M0 = { top: 0, right: 0, bottom: 0, left: 0 };
			const resolver = new PageResolver(
				[new PageRule({ size: [600, 800], margin: M0 }), new PageRule({ name: "chapter", size: [500, 700], margin: M0 })],
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

			const M0 = { top: 0, right: 0, bottom: 0, left: 0 };
				const resolver = new PageResolver(
				[
					new PageRule({ size: [100, 100], margin: M0 }),
					new PageRule({ pseudoClasses: ["first"], size: [200, 200], margin: M0 }),
					new PageRule({ name: "cover", size: [300, 300], margin: M0 }),
					new PageRule({ name: "cover", pseudoClasses: ["first"], size: [400, 400], margin: M0 }),
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
					new PageRule({ size: [600, 800], margin: { top: 10, right: 10, bottom: 10, left: 10 } }),
					new PageRule({ name: "wide", margin: { left: 50, right: 50 } }),
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
			const M0 = { top: 0, right: 0, bottom: 0, left: 0 };
			const resolver = new PageResolver(
				[
					new PageRule({ pseudoClasses: ["right"], size: [200, 200], margin: M0 }),
					new PageRule({ pseudoClasses: ["first"], size: [400, 400], margin: M0 }),
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
			const M0 = { top: 0, right: 0, bottom: 0, left: 0 };
			const resolver = new PageResolver(
				[
					new PageRule({ pseudoClasses: ["blank", "right"], size: [200, 200], margin: M0 }),
					new PageRule({ name: "cover", size: [400, 400], margin: M0 }),
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
			const { PageRule, pageRuleSpecificity, compareSpecificity } = await import(
				"/src/resolvers/page-resolver.js"
			);
			const rA = new PageRule({ name: "artsy", pseudoClasses: ["left"] });
			const rB = new PageRule({ name: "artsy", pseudoClasses: ["first"] });
			const rC = new PageRule({ name: "artsy", pseudoClasses: ["first", "left"] });
			const rD = new PageRule({ name: "artsy" });
			const rE = new PageRule({ pseudoClasses: ["blank", "left"] });
			return {
				specA: pageRuleSpecificity(rA),
				specB: pageRuleSpecificity(rB),
				specC: pageRuleSpecificity(rC),
				specD: pageRuleSpecificity(rD),
				specE: pageRuleSpecificity(rE),
				cBeatsA: compareSpecificity(pageRuleSpecificity(rC), pageRuleSpecificity(rA)) > 0,
				cBeatsB: compareSpecificity(pageRuleSpecificity(rC), pageRuleSpecificity(rB)) > 0,
				bBeatsA: compareSpecificity(pageRuleSpecificity(rB), pageRuleSpecificity(rA)) > 0,
				aBeatsD: compareSpecificity(pageRuleSpecificity(rA), pageRuleSpecificity(rD)) > 0,
				dBeatsE: compareSpecificity(pageRuleSpecificity(rD), pageRuleSpecificity(rE)) > 0,
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
				[new PageRule({ pseudoClasses: ["blank", "left"], size: [400, 400] })],
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
			const M0 = { top: 0, right: 0, bottom: 0, left: 0 };
			const resolver = new PageResolver(
				[
					new PageRule({ size: [300, 300], margin: M0 }),
					new PageRule({ size: [500, 500], margin: M0 }),
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
			return rules.map((r) => ({ name: r.name, pseudoClasses: r.pseudoClasses }));
		});
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ name: null, pseudoClasses: [] });
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
		expect(result.empty).toEqual({ name: null, pseudoClasses: [] });
		expect(result.namedOnly).toEqual({ name: "artsy", pseudoClasses: [] });
		expect(result.pseudoOnly).toEqual({ name: null, pseudoClasses: ["first"] });
		expect(result.namedPseudo).toEqual({ name: "artsy", pseudoClasses: ["first"] });
		expect(result.multiPseudo).toEqual({ name: null, pseudoClasses: ["blank", "left"] });
		expect(result.namedMulti).toEqual({ name: "artsy", pseudoClasses: ["first", "left"] });
		expect(result.dedup).toEqual({ name: null, pseudoClasses: ["first", "left"] });
		expect(result.caseInsensitive).toEqual({ name: null, pseudoClasses: ["first", "left"] });
		expect(result.invalid).toBeNull();
		expect(result.mixedInvalid).toBeNull();
	});

	test("page-orientation: rotate-left swaps dimensions", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver(
				[new PageRule({ size: [600, 800], pageOrientation: "rotate-left" })],
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
				[new PageRule({ size: [600, 800], margin: { top: 20, right: 20, bottom: 20, left: 20 } })],
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
			const { createFragments } = await import("/src/layout/layout-request.js");
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
			const { createFragments } = await import("/src/layout/layout-request.js");
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
			const { createFragments } = await import("/src/layout/layout-request.js");
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
			const { createFragments } = await import("/src/layout/layout-request.js");
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
			const { createFragments } = await import("/src/layout/layout-request.js");
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
			const { createFragments } = await import("/src/layout/layout-request.js");
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
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const DEFAULT_SIZE = { inlineSize: 600, blockSize: 1000 };
			const M0 = { top: 0, right: 0, bottom: 0, left: 0 };
			const resolver = new PageResolver([new PageRule({ size: [600, 1000], margin: M0 })], DEFAULT_SIZE);

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
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const M0 = { top: 0, right: 0, bottom: 0, left: 0 };
				const resolver = new PageResolver(
				[new PageRule({ size: [600, 200], margin: M0 }), new PageRule({ name: "wide", size: [800, 200], margin: M0 })],
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
			const { createFragments } = await import("/src/layout/layout-request.js");
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
