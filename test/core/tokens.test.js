import { test, expect } from "../browser-fixture.js";

test.describe("BlockBreakToken", () => {
	test("createBreakBefore sets correct flags", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			const node = blockNode({ debugName: "pushed" });
			const token = BlockBreakToken.createBreakBefore(node, false);
			return {
				isBreakBefore: token.isBreakBefore,
				isForcedBreak: token.isForcedBreak,
				nodeIsSame: token.node === node,
			};
		});
		expect(result.isBreakBefore).toBe(true);
		expect(result.isForcedBreak).toBe(false);
		expect(result.nodeIsSame).toBe(true);
	});

	test("createBreakBefore with forced break", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			const token = BlockBreakToken.createBreakBefore(blockNode(), true);
			return { isBreakBefore: token.isBreakBefore, isForcedBreak: token.isForcedBreak };
		});
		expect(result.isBreakBefore).toBe(true);
		expect(result.isForcedBreak).toBe(true);
	});

	test("createRepeated sets correct flags", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			const token = BlockBreakToken.createRepeated(blockNode({ debugName: "thead" }), 3);
			return {
				isRepeated: token.isRepeated,
				sequenceNumber: token.sequenceNumber,
				childBreakTokens: token.childBreakTokens,
			};
		});
		expect(result.isRepeated).toBe(true);
		expect(result.sequenceNumber).toBe(3);
		expect(result.childBreakTokens).toEqual([]);
	});

	test("createForBreakInRepeatedFragment sets all fields", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			const token = BlockBreakToken.createForBreakInRepeatedFragment(blockNode(), 2, 150);
			return {
				isRepeated: token.isRepeated,
				sequenceNumber: token.sequenceNumber,
				consumedBlockSize: token.consumedBlockSize,
			};
		});
		expect(result.isRepeated).toBe(true);
		expect(result.sequenceNumber).toBe(2);
		expect(result.consumedBlockSize).toBe(150);
	});
});

test.describe("Break token equals", () => {
	test("compares block token state, children and algorithmData", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const root = blockNode({ debugName: "root" });
			const child = blockNode({ debugName: "child" });
			const other = blockNode({ debugName: "other" });

			const make = () => {
				const token = new BlockBreakToken(root);
				token.consumedBlockSize = 200;
				token.sequenceNumber = 1;
				const childToken = new BlockBreakToken(child);
				childToken.consumedBlockSize = 50;
				token.childBreakTokens = [childToken];
				return token;
			};

			const withData = (data) => {
				const token = make();
				token.algorithmData = data;
				return token;
			};

			const extra = make();
			extra.scratchNote = "hung on by a caller";

			const differentChildNode = make();
			differentChildNode.childBreakTokens = [new BlockBreakToken(other)];

			const differentChildSize = make();
			differentChildSize.childBreakTokens[0].consumedBlockSize = 60;

			const extraChild = make();
			extraChild.childBreakTokens.push(new BlockBreakToken(other));

			const consumed = make();
			consumed.consumedBlockSize = 201;

			const atBlockEnd = make();
			atBlockEnd.isAtBlockEnd = true;

			const shared = { columns: 3 };
			return {
				equal: make().equals(make()),
				differentConsumedBlockSize: consumed.equals(make()),
				differentChildNode: differentChildNode.equals(make()),
				differentChildConsumedBlockSize: differentChildSize.equals(make()),
				differentChildCount: extraChild.equals(make()),
				differentFlag: atBlockEnd.equals(make()),
				differentNode: make().equals(new BlockBreakToken(other)),
				adHocPropertyIgnored: extra.equals(make()),
				bothDataNull: make().equals(make()),
				oneDataNull: withData({ columns: 3 }).equals(make()),
				differentDataValue: withData({ columns: 3 }).equals(withData({ columns: 4 })),
				differentDataKeys: withData({ columns: 3 }).equals(withData({ rows: 3 })),
				equalDataValues: withData({ columns: 3 }).equals(withData({ columns: 3 })),
				// Shallow: a rebuilt nested object is a difference even when
				// its contents match.
				identicalNestedData: withData({ state: shared }).equals(withData({ state: shared })),
				rebuiltNestedData: withData({ state: { columns: 3 } }).equals(
					withData({ state: { columns: 3 } }),
				),
			};
		});

		expect(result).toEqual({
			equal: true,
			differentConsumedBlockSize: false,
			differentChildNode: false,
			differentChildConsumedBlockSize: false,
			differentChildCount: false,
			differentFlag: false,
			differentNode: false,
			adHocPropertyIgnored: true,
			bothDataNull: true,
			oneDataNull: false,
			differentDataValue: false,
			differentDataKeys: false,
			equalDataValues: true,
			identicalNestedData: true,
			rebuiltNestedData: false,
		});
	});

	test("compares inline token content position", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { BlockBreakToken, InlineBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const text = blockNode({ debugName: "text" });
			const make = () => {
				const token = new InlineBreakToken(text);
				token.itemIndex = 4;
				token.textOffset = 120;
				return token;
			};

			const offset = make();
			offset.textOffset = 121;
			const hyphenated = make();
			hyphenated.isHyphenated = true;
			const flagged = make();
			flagged.flags = 1;
			const trailingSpace = make();
			trailingSpace.hasTrailingCollapsibleSpace = true;

			const parent = new BlockBreakToken(blockNode({ debugName: "p" }));
			parent.childBreakTokens = [make()];
			const parentWithOffset = new BlockBreakToken(parent.node);
			parentWithOffset.childBreakTokens = [offset];

			return {
				equal: make().equals(make()),
				differentTextOffset: offset.equals(make()),
				differentHyphenation: hyphenated.equals(make()),
				differentFlags: flagged.equals(make()),
				differentTrailingSpace: trailingSpace.equals(make()),
				// A block token whose only difference is inside an inline child.
				throughParent: parentWithOffset.equals(parent),
			};
		});

		expect(result).toEqual({
			equal: true,
			differentTextOffset: false,
			differentHyphenation: false,
			differentFlags: false,
			differentTrailingSpace: false,
			throughParent: false,
		});
	});
});

test.describe("Break token tree", () => {
	test("builds a sparse tree mirroring the box tree", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const child2 = blockNode({ debugName: "child2" });
			const grandchild = blockNode({ debugName: "grandchild" });

			const grandchildToken = new BlockBreakToken(grandchild);
			grandchildToken.consumedBlockSize = 50;

			const child2Token = new BlockBreakToken(child2);
			child2Token.consumedBlockSize = 100;
			child2Token.childBreakTokens = [grandchildToken];

			const rootToken = new BlockBreakToken(blockNode({ debugName: "root" }));
			rootToken.consumedBlockSize = 200;
			rootToken.childBreakTokens = [child2Token];

			return {
				childCount: rootToken.childBreakTokens.length,
				firstChildIsChild2: rootToken.childBreakTokens[0].node === child2,
				grandchildIsGrandchild:
					rootToken.childBreakTokens[0].childBreakTokens[0].node === grandchild,
			};
		});
		expect(result.childCount).toBe(1);
		expect(result.firstChildIsChild2).toBe(true);
		expect(result.grandchildIsGrandchild).toBe(true);
	});

	test("contains inline break token as leaf", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { BlockBreakToken, InlineBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const paragraph = blockNode({ debugName: "p" });
			const inlineNode = blockNode({ debugName: "text" });

			const inlineToken = new InlineBreakToken(inlineNode);
			inlineToken.itemIndex = 12;
			inlineToken.textOffset = 347;

			const pToken = new BlockBreakToken(paragraph);
			pToken.consumedBlockSize = 280;
			pToken.childBreakTokens = [inlineToken];

			const leaf = pToken.childBreakTokens[0];
			return { type: leaf.type, itemIndex: leaf.itemIndex, textOffset: leaf.textOffset };
		});
		expect(result.type).toBe("inline");
		expect(result.itemIndex).toBe(12);
		expect(result.textOffset).toBe(347);
	});
});

test.describe("findChildBreakToken", () => {
	test("returns null when parent is null", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { findChildBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			return findChildBreakToken(null, blockNode());
		});
		expect(result).toBe(null);
	});

	test("returns null when child has no token", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { findChildBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			const parent = new BlockBreakToken(blockNode());
			return findChildBreakToken(parent, blockNode());
		});
		expect(result).toBe(null);
	});

	test("finds the correct child token", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { findChildBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const childA = blockNode({ debugName: "A" });
			const childB = blockNode({ debugName: "B" });
			const tokenB = new BlockBreakToken(childB);

			const parent = new BlockBreakToken(blockNode());
			parent.childBreakTokens = [tokenB];

			return {
				findA: findChildBreakToken(parent, childA),
				findBIsTokenB: findChildBreakToken(parent, childB) === tokenB,
			};
		});
		expect(result.findA).toBe(null);
		expect(result.findBIsTokenB).toBe(true);
	});
});

test.describe("isMonolithic", () => {
	test("replaced elements are monolithic", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { isMonolithic } = await import("/src/layout/layout-helpers.js");
			const { replacedNode } = await import("/test/fixtures/nodes.js");
			return isMonolithic(replacedNode());
		});
		expect(result).toBe(true);
	});

	test("scrollable elements are monolithic", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { isMonolithic } = await import("/src/layout/layout-helpers.js");
			const { scrollableNode } = await import("/test/fixtures/nodes.js");
			return isMonolithic(scrollableNode());
		});
		expect(result).toBe(true);
	});

	test("overflow:hidden with explicit height is monolithic", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { isMonolithic } = await import("/src/layout/layout-helpers.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			return isMonolithic(blockNode({ hasOverflowHidden: true, hasExplicitBlockSize: true }));
		});
		expect(result).toBe(true);
	});

	test("overflow:hidden without explicit height is not monolithic", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { isMonolithic } = await import("/src/layout/layout-helpers.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			return isMonolithic(blockNode({ hasOverflowHidden: true, hasExplicitBlockSize: false }));
		});
		expect(result).toBe(false);
	});

	test("normal block is not monolithic", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { isMonolithic } = await import("/src/layout/layout-helpers.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			return isMonolithic(blockNode());
		});
		expect(result).toBe(false);
	});
});
