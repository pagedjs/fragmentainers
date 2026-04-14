import { test, expect } from "../browser-fixture.js";

// Helper function tests

test.describe("isSideSpecificBreak", () => {
	test("returns true for left, right, recto, verso", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { isSideSpecificBreak } = await import("/src/resolvers/page-resolver.js");
			return {
				left: isSideSpecificBreak("left"),
				right: isSideSpecificBreak("right"),
				recto: isSideSpecificBreak("recto"),
				verso: isSideSpecificBreak("verso"),
			};
		});
		expect(result.left).toBe(true);
		expect(result.right).toBe(true);
		expect(result.recto).toBe(true);
		expect(result.verso).toBe(true);
	});

	test("returns false for page, column, always, auto, avoid", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { isSideSpecificBreak } = await import("/src/resolvers/page-resolver.js");
			return {
				page: isSideSpecificBreak("page"),
				column: isSideSpecificBreak("column"),
				always: isSideSpecificBreak("always"),
				auto: isSideSpecificBreak("auto"),
				avoid: isSideSpecificBreak("avoid"),
				nullVal: isSideSpecificBreak(null),
				undef: isSideSpecificBreak(undefined),
			};
		});
		expect(result.page).toBe(false);
		expect(result.column).toBe(false);
		expect(result.always).toBe(false);
		expect(result.auto).toBe(false);
		expect(result.avoid).toBe(false);
		expect(result.nullVal).toBe(false);
		expect(result.undef).toBe(false);
	});
});

test.describe("requiredPageSide", () => {
	test("normalizes right and recto to 'right'", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { requiredPageSide } = await import("/src/resolvers/page-resolver.js");
			return { right: requiredPageSide("right"), recto: requiredPageSide("recto") };
		});
		expect(result.right).toBe("right");
		expect(result.recto).toBe("right");
	});

	test("normalizes left and verso to 'left'", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { requiredPageSide } = await import("/src/resolvers/page-resolver.js");
			return { left: requiredPageSide("left"), verso: requiredPageSide("verso") };
		});
		expect(result.left).toBe("left");
		expect(result.verso).toBe("left");
	});

	test("returns null for non-side-specific values", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { requiredPageSide } = await import("/src/resolvers/page-resolver.js");
			return {
				page: requiredPageSide("page"),
				auto: requiredPageSide("auto"),
				nullVal: requiredPageSide(null),
			};
		});
		expect(result.page).toBeNull();
		expect(result.auto).toBeNull();
		expect(result.nullVal).toBeNull();
	});
});

test.describe("resolveForcedBreakValue", () => {
	test("returns null for null break token", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { resolveForcedBreakValue } = await import("/src/resolvers/page-resolver.js");
			return resolveForcedBreakValue(null);
		});
		expect(result).toBeNull();
	});

	test("returns forcedBreakValue from a direct token", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { resolveForcedBreakValue } = await import("/src/resolvers/page-resolver.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const node = blockNode({ debugName: "A" });
			const token = BlockBreakToken.createBreakBefore(node, true, "right");
			const parent = new BlockBreakToken(blockNode({ debugName: "root" }));
			parent.childBreakTokens = [token];
			return resolveForcedBreakValue(parent);
		});
		expect(result).toBe("right");
	});

	test("returns null when no forced break value", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { resolveForcedBreakValue } = await import("/src/resolvers/page-resolver.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const node = blockNode({ debugName: "A" });
			const token = BlockBreakToken.createBreakBefore(node, true);
			const parent = new BlockBreakToken(blockNode({ debugName: "root" }));
			parent.childBreakTokens = [token];
			return resolveForcedBreakValue(parent);
		});
		expect(result).toBeNull();
	});
});

test.describe("resolveNextPageBreakBefore", () => {
	test("returns first child breakBefore when no break token", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { resolveNextPageBreakBefore } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const root = blockNode({
				children: [
					blockNode({ debugName: "A", breakBefore: "right" }),
					blockNode({ debugName: "B" }),
				],
			});
			return resolveNextPageBreakBefore(root, null);
		});
		expect(result).toBe("right");
	});

	test("returns breakBefore from isBreakBefore token node", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { resolveNextPageBreakBefore } = await import("/src/resolvers/page-resolver.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const childA = blockNode({ debugName: "A", blockSize: 50 });
			const childB = blockNode({ debugName: "B", blockSize: 50, breakBefore: "left" });
			const root = blockNode({ children: [childA, childB] });
			const token = new BlockBreakToken(root);
			const childToken = BlockBreakToken.createBreakBefore(childB, true, "left");
			token.childBreakTokens = [childToken];
			return resolveNextPageBreakBefore(root, token);
		});
		expect(result).toBe("left");
	});

	test("returns auto when first child has no break-before", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { resolveNextPageBreakBefore } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const root = blockNode({
				children: [blockNode({ debugName: "A" }), blockNode({ debugName: "B" })],
			});
			return resolveNextPageBreakBefore(root, null);
		});
		expect(result).toBe("auto");
	});
});

// forcedBreakValue on tokens

test.describe("forcedBreakValue on tokens", () => {
	test("createBreakBefore stores forcedBreakValue", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const node = blockNode({ debugName: "A" });
			const token = BlockBreakToken.createBreakBefore(node, true, "left");
			return { isForcedBreak: token.isForcedBreak, forcedBreakValue: token.forcedBreakValue };
		});
		expect(result.isForcedBreak).toBe(true);
		expect(result.forcedBreakValue).toBe("left");
	});

	test("createBreakBefore defaults forcedBreakValue to null", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const node = blockNode({ debugName: "A" });
			const token = BlockBreakToken.createBreakBefore(node, true);
			return token.forcedBreakValue;
		});
		expect(result).toBeNull();
	});

	test("break-before: right stores value through layout", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50 }),
					blockNode({ debugName: "B", blockSize: 50, breakBefore: "right" }),
				],
			});

			const resolver = new PageResolver([], { inlineSize: 600, blockSize: 1000 });
			const pages = createFragments(root, resolver);

			const forcedToken = pages[0].breakToken.childBreakTokens[0];
			return {
				isForcedBreak: forcedToken.isForcedBreak,
				forcedBreakValue: forcedToken.forcedBreakValue,
			};
		});
		expect(result.isForcedBreak).toBe(true);
		expect(result.forcedBreakValue).toBe("right");
	});

	test("break-after: left stores value through layout", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50, breakAfter: "left" }),
					blockNode({ debugName: "B", blockSize: 50 }),
				],
			});

			const resolver = new PageResolver([], { inlineSize: 600, blockSize: 1000 });
			const pages = createFragments(root, resolver);

			const forcedToken = pages[0].breakToken.childBreakTokens[0];
			return {
				isForcedBreak: forcedToken.isForcedBreak,
				forcedBreakValue: forcedToken.forcedBreakValue,
			};
		});
		expect(result.isForcedBreak).toBe(true);
		expect(result.forcedBreakValue).toBe("left");
	});
});

// Blank page insertion

test.describe("Blank page insertion", () => {
	test("break-before: left inserts a blank page when content is on a right page", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const SIZE = { inlineSize: 600, blockSize: 1000 };
			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50 }),
					blockNode({ debugName: "B", blockSize: 50, breakBefore: "left" }),
				],
			});

			const resolver = new PageResolver([], SIZE);
			const pages = createFragments(root, resolver);
			return {
				length: pages.length,
				page0Blank: pages[0].isBlank,
				page1Blank: pages[1].isBlank,
			};
		});
		expect(result.length).toBe(2);
		expect(result.page0Blank).toBe(false);
		expect(result.page1Blank).toBe(false);
	});

	test("break-before: right inserts a blank page when next page would be left", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const SIZE = { inlineSize: 600, blockSize: 1000 };
			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50 }),
					blockNode({ debugName: "B", blockSize: 50, breakBefore: "right" }),
				],
			});

			const resolver = new PageResolver([], SIZE);
			const pages = createFragments(root, resolver);
			return {
				length: pages.length,
				page0Blank: pages[0].isBlank,
				page1Blank: pages[1].isBlank,
				page2Blank: pages[2].isBlank,
			};
		});
		expect(result.length).toBe(3);
		expect(result.page0Blank).toBe(false);
		expect(result.page1Blank).toBe(true);
		expect(result.page2Blank).toBe(false);
	});

	test("break-before: recto works like right", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const SIZE = { inlineSize: 600, blockSize: 1000 };
			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50 }),
					blockNode({ debugName: "B", blockSize: 50, breakBefore: "recto" }),
				],
			});

			const resolver = new PageResolver([], SIZE);
			const pages = createFragments(root, resolver);
			return { length: pages.length, page1Blank: pages[1].isBlank };
		});
		expect(result.length).toBe(3);
		expect(result.page1Blank).toBe(true);
	});

	test("break-before: verso works like left", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const SIZE = { inlineSize: 600, blockSize: 1000 };
			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50 }),
					blockNode({ debugName: "B", blockSize: 50, breakBefore: "verso" }),
				],
			});

			const resolver = new PageResolver([], SIZE);
			const pages = createFragments(root, resolver);
			return {
				length: pages.length,
				page0Blank: pages[0].isBlank,
				page1Blank: pages[1].isBlank,
			};
		});
		expect(result.length).toBe(2);
		expect(result.page0Blank).toBe(false);
		expect(result.page1Blank).toBe(false);
	});

	test("no blank page when already on correct side", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const SIZE = { inlineSize: 600, blockSize: 1000 };
			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50 }),
					blockNode({ debugName: "B", blockSize: 50, breakBefore: "left" }),
					blockNode({ debugName: "C", blockSize: 50, breakBefore: "right" }),
				],
			});

			const resolver = new PageResolver([], SIZE);
			const pages = createFragments(root, resolver);
			return {
				length: pages.length,
				allNotBlank: pages.every((p) => !p.isBlank),
			};
		});
		expect(result.length).toBe(3);
		expect(result.allNotBlank).toBe(true);
	});

	test("break-after: right inserts a blank page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const SIZE = { inlineSize: 600, blockSize: 1000 };
			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50, breakAfter: "right" }),
					blockNode({ debugName: "B", blockSize: 50 }),
				],
			});

			const resolver = new PageResolver([], SIZE);
			const pages = createFragments(root, resolver);
			return { length: pages.length, page1Blank: pages[1].isBlank };
		});
		expect(result.length).toBe(3);
		expect(result.page1Blank).toBe(true);
	});

	test("blank pages are counted in the page sequence", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const SIZE = { inlineSize: 600, blockSize: 1000 };
			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50 }),
					blockNode({ debugName: "B", blockSize: 50, breakBefore: "right" }),
					blockNode({ debugName: "C", blockSize: 50, breakBefore: "right" }),
				],
			});

			const resolver = new PageResolver([], SIZE);
			const pages = createFragments(root, resolver);
			return {
				length: pages.length,
				blanks: pages.map((p) => p.isBlank),
			};
		});
		expect(result.length).toBe(5);
		expect(result.blanks[0]).toBe(false);
		expect(result.blanks[1]).toBe(true);
		expect(result.blanks[2]).toBe(false);
		expect(result.blanks[3]).toBe(true);
		expect(result.blanks[4]).toBe(false);
	});

	test("blank page has constraints from resolver", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const SIZE = { inlineSize: 600, blockSize: 1000 };
			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50 }),
					blockNode({ debugName: "B", blockSize: 50, breakBefore: "right" }),
				],
			});

			const resolver = new PageResolver([], SIZE);
			const pages = createFragments(root, resolver);
			const blankPage = pages[1];
			return {
				isBlank: blankPage.isBlank,
				hasConstraints: !!blankPage.constraints,
				inlineSize: blankPage.constraints.contentArea.inlineSize,
				blockSize: blankPage.constraints.contentArea.blockSize,
				constraintIsBlank: blankPage.constraints.isBlank,
			};
		});
		expect(result.isBlank).toBe(true);
		expect(result.hasConstraints).toBe(true);
		expect(result.inlineSize).toBe(600);
		expect(result.blockSize).toBe(1000);
		expect(result.constraintIsBlank).toBe(true);
	});

	test("break-before: page does NOT insert blank pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const SIZE = { inlineSize: 600, blockSize: 1000 };
			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50 }),
					blockNode({ debugName: "B", blockSize: 50, breakBefore: "page" }),
				],
			});

			const resolver = new PageResolver([], SIZE);
			const pages = createFragments(root, resolver);
			return {
				length: pages.length,
				allNotBlank: pages.every((p) => !p.isBlank),
			};
		});
		expect(result.length).toBe(2);
		expect(result.allNotBlank).toBe(true);
	});
});

// :blank pseudo-class matching

test.describe(":blank pseudo-class matching", () => {
	test("@page :blank rule matches blank pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");

			const resolver = new PageResolver(
				[new PageRule({ pseudoClasses: ["blank"], margin: { top: 100 } })],
				{ inlineSize: 600, blockSize: 1000 },
			);

			const normal = resolver.resolve(0, null, null, false);
			const blank = resolver.resolve(1, null, null, true);
			return {
				normalMarginTop: normal.margins.top,
				blankMarginTop: blank.margins.top,
				blankIsBlank: blank.isBlank,
			};
		});
		expect(result.normalMarginTop).toBe(0);
		expect(result.blankMarginTop).toBe(100);
		expect(result.blankIsBlank).toBe(true);
	});

	test("@page :blank:left matches only blank left pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");
			const resolver = new PageResolver(
				[new PageRule({ pseudoClasses: ["blank", "left"], margin: { top: 50 } })],
				{ inlineSize: 600, blockSize: 1000 },
			);
			return {
				blankLeft: resolver.resolve(1, null, null, true).margins.top,
				blankRight: resolver.resolve(0, null, null, true).margins.top,
				nonBlankLeft: resolver.resolve(1, null, null, false).margins.top,
			};
		});
		expect(result.blankLeft).toBe(50);
		expect(result.blankRight).toBe(0);
		expect(result.nonBlankLeft).toBe(0);
	});

	test("@page :blank does not match non-blank pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { PageRule, PageResolver } = await import("/src/resolvers/page-resolver.js");

			const resolver = new PageResolver(
				[new PageRule({ pseudoClasses: ["blank"], size: [400, 400] })],
				{ inlineSize: 600, blockSize: 1000 },
			);

			const c = resolver.resolve(0, null, null, false);
			return {
				inlineSize: c.contentArea.inlineSize,
				blockSize: c.contentArea.blockSize,
			};
		});
		expect(result.inlineSize).toBe(600);
		expect(result.blockSize).toBe(1000);
	});
});

// First page edge case

test.describe("First page blank page edge case", () => {
	test("first child with break-before: left inserts blank page 0 (page 0 is right)", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const SIZE = { inlineSize: 600, blockSize: 1000 };
			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50, breakBefore: "left" }),
					blockNode({ debugName: "B", blockSize: 50 }),
				],
			});

			const resolver = new PageResolver([], SIZE);
			const pages = createFragments(root, resolver);
			return {
				length: pages.length,
				page0Blank: pages[0].isBlank,
				page1Blank: pages[1].isBlank,
			};
		});
		expect(result.length).toBe(2);
		expect(result.page0Blank).toBe(true);
		expect(result.page1Blank).toBe(false);
	});

	test("first child with break-before: right does NOT insert blank (page 0 is right)", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const SIZE = { inlineSize: 600, blockSize: 1000 };
			const root = blockNode({
				children: [
					blockNode({ debugName: "A", blockSize: 50, breakBefore: "right" }),
					blockNode({ debugName: "B", blockSize: 50 }),
				],
			});

			const resolver = new PageResolver([], SIZE);
			const pages = createFragments(root, resolver);
			return {
				length: pages.length,
				page0Blank: pages[0].isBlank,
			};
		});
		expect(result.length).toBe(1);
		expect(result.page0Blank).toBe(false);
	});
});
