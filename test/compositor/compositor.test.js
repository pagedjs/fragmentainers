import { test, expect } from "../browser-fixture.js";

test.describe("hasBlockChildren", () => {
	test("returns false for empty childFragments", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const fragment = new Fragment(blockNode(), 100, []);
			return fragment.hasBlockChildren;
		});
		expect(result).toBe(false);
	});

	test("returns false when all children have null nodes (line fragments)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const lineFragment = new Fragment(null, 20);
			const fragment = new Fragment(blockNode(), 100, [lineFragment, lineFragment]);
			return fragment.hasBlockChildren;
		});
		expect(result).toBe(false);
	});

	test("returns true when at least one child has a node", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const lineFragment = new Fragment(null, 20);
			const blockChild = new Fragment(blockNode({ debugName: "child" }), 50);
			const fragment = new Fragment(blockNode(), 100, [lineFragment, blockChild]);
			return fragment.hasBlockChildren;
		});
		expect(result).toBe(true);
	});

	test("returns true when all children have nodes", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const child1 = new Fragment(blockNode({ debugName: "a" }), 50);
			const child2 = new Fragment(blockNode({ debugName: "b" }), 50);
			const fragment = new Fragment(blockNode(), 100, [child1, child2]);
			return fragment.hasBlockChildren;
		});
		expect(result).toBe(true);
	});
});

test.describe("empty container shell detection", () => {
	test("detects an empty container with pushed children", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { BlockBreakToken } = await import("/src/core/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const child = blockNode({ debugName: "child" });
			const container = blockNode({ debugName: "container", children: [child] });
			const fragment = new Fragment(container, 0, []);
			fragment.breakToken = new BlockBreakToken(container);
			fragment.breakToken.childBreakTokens = [BlockBreakToken.createBreakBefore(child)];

			return (
				fragment.childFragments.length === 0 &&
				fragment.breakToken !== null &&
				fragment.node.children?.length > 0
			);
		});
		expect(result).toBe(true);
	});

	test("does not flag a leaf node being sliced", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { BlockBreakToken } = await import("/src/core/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const leaf = blockNode({ debugName: "leaf" });
			const fragment = new Fragment(leaf, 200, []);
			fragment.breakToken = new BlockBreakToken(leaf);
			fragment.breakToken.consumedBlockSize = 200;

			return (
				fragment.childFragments.length === 0 &&
				fragment.breakToken !== null &&
				fragment.node.children?.length > 0
			);
		});
		expect(result).toBe(false);
	});

	test("does not flag a container with placed children", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { BlockBreakToken } = await import("/src/core/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const child = blockNode({ debugName: "child" });
			const container = blockNode({ debugName: "container", children: [child] });
			const childFrag = new Fragment(child, 50);
			const fragment = new Fragment(container, 50, [childFrag]);
			fragment.breakToken = new BlockBreakToken(container);

			return (
				fragment.childFragments.length === 0 &&
				fragment.breakToken !== null &&
				fragment.node.children?.length > 0
			);
		});
		expect(result).toBe(false);
	});

	test("does not flag a completed container (no break token)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const child = blockNode({ debugName: "child" });
			const container = blockNode({ debugName: "container", children: [child] });
			const childFrag = new Fragment(child, 50);
			const fragment = new Fragment(container, 50, [childFrag]);

			return (
				fragment.childFragments.length === 0 &&
				fragment.breakToken !== null &&
				fragment.node.children?.length > 0
			);
		});
		expect(result).toBe(false);
	});
});

test.describe("inline items data for compositor", () => {
	test("textToInlineItems creates kText items with correct offsets", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { textToInlineItems } = await import("/test/fixtures/nodes.js");
			const { INLINE_TEXT } = await import("/src/core/constants.js");

			const data = textToInlineItems("Hello world");
			return {
				textContent: data.textContent,
				itemsLength: data.items.length,
				type: data.items[0].type,
				typeMatch: data.items[0].type === INLINE_TEXT,
				startOffset: data.items[0].startOffset,
				endOffset: data.items[0].endOffset,
			};
		});
		expect(result.textContent).toBe("Hello world");
		expect(result.itemsLength).toBe(1);
		expect(result.typeMatch).toBe(true);
		expect(result.startOffset).toBe(0);
		expect(result.endOffset).toBe(11);
	});

	test("textToInlineItems splits on newlines with kControl", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { textToInlineItems } = await import("/test/fixtures/nodes.js");
			const { INLINE_TEXT, INLINE_CONTROL } = await import("/src/core/constants.js");

			const data = textToInlineItems("Line one\nLine two");
			return {
				itemsLength: data.items.length,
				item0Type: data.items[0].type === INLINE_TEXT,
				item0End: data.items[0].endOffset,
				item1Type: data.items[1].type === INLINE_CONTROL,
				item2Type: data.items[2].type === INLINE_TEXT,
				item2Start: data.items[2].startOffset,
				item2End: data.items[2].endOffset,
			};
		});
		expect(result.itemsLength).toBe(3);
		expect(result.item0Type).toBe(true);
		expect(result.item0End).toBe(8);
		expect(result.item1Type).toBe(true);
		expect(result.item2Type).toBe(true);
		expect(result.item2Start).toBe(9);
		expect(result.item2End).toBe(17);
	});

	test("inline break token offsets correctly slice text content", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { textToInlineItems } = await import("/test/fixtures/nodes.js");

			const data = textToInlineItems("The quick brown fox jumps over the lazy dog");
			const startOffset = 10;
			const endOffset = 25;
			return data.textContent.slice(startOffset, endOffset);
		});
		expect(result).toBe("brown fox jumps");
	});
});

test.describe("buildInlineContent", () => {
	test("composes simple text into a container", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { INLINE_TEXT } = await import("/src/core/constants.js");

			const items = [{ type: INLINE_TEXT, startOffset: 0, endOffset: 11 }];
			const textContent = "Hello world";
			const target = document.createElement("div");
			Fragment.buildInlineContent(items, textContent, 0, 11, target);
			return target.textContent;
		});
		expect(result).toBe("Hello world");
	});

	test("composes a sliced range from the middle of text", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { INLINE_TEXT } = await import("/src/core/constants.js");

			const textContent = "Hello world test content";
			const items = [{ type: INLINE_TEXT, startOffset: 0, endOffset: textContent.length }];
			const target = document.createElement("div");
			Fragment.buildInlineContent(items, textContent, 6, 16, target);
			return target.textContent;
		});
		expect(result).toBe("world test");
	});

	test("composes inline elements using open/close tag items", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { INLINE_TEXT, INLINE_OPEN_TAG, INLINE_CLOSE_TAG } =
				await import("/src/core/constants.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px";
			document.body.appendChild(container);

			const span = document.createElement("span");
			span.className = "highlight";
			container.appendChild(span);

			const textContent = "before inside after";
			const items = [
				{ type: INLINE_TEXT, startOffset: 0, endOffset: 7 },
				{ type: INLINE_OPEN_TAG, element: span, startOffset: 7, endOffset: 13 },
				{ type: INLINE_TEXT, startOffset: 7, endOffset: 13 },
				{ type: INLINE_CLOSE_TAG },
				{ type: INLINE_TEXT, startOffset: 13, endOffset: 19 },
			];

			const target = document.createElement("div");
			Fragment.buildInlineContent(items, textContent, 0, 19, target);

			const hasSpan = target.querySelector("span.highlight") !== null;
			const spanText = target.querySelector("span.highlight")?.textContent || "";
			const fullText = target.textContent;

			container.remove();
			return { fullText, hasSpan, spanText };
		});
		expect(result.fullText).toBe("before inside after");
		expect(result.hasSpan).toBe(true);
		expect(result.spanText).toBe("inside");
	});

	test("skips inline elements whose content is entirely past the visible range", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { INLINE_TEXT, INLINE_OPEN_TAG, INLINE_CLOSE_TAG } =
				await import("/src/core/constants.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px";
			document.body.appendChild(container);

			const italic = document.createElement("i");
			container.appendChild(italic);

			const textContent = "before break after the break";
			const items = [
				{ type: INLINE_TEXT, startOffset: 0, endOffset: 13 },
				{ type: INLINE_OPEN_TAG, element: italic, startOffset: 13, endOffset: 28 },
				{ type: INLINE_TEXT, startOffset: 13, endOffset: 28 },
				{ type: INLINE_CLOSE_TAG },
			];

			const target = document.createElement("div");
			Fragment.buildInlineContent(items, textContent, 0, 13, target);

			const out = {
				textContent: target.textContent,
				hasItalic: target.querySelector("i") !== null,
			};
			container.remove();
			return out;
		});
		expect(result.textContent).toBe("before break");
		expect(result.hasItalic).toBe(false);
	});

	test("skips inline elements whose content is entirely before the visible range", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { INLINE_TEXT, INLINE_OPEN_TAG, INLINE_CLOSE_TAG } =
				await import("/src/core/constants.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px";
			document.body.appendChild(container);

			const bold = document.createElement("b");
			container.appendChild(bold);

			const textContent = "before break after the break";
			const items = [
				{ type: INLINE_OPEN_TAG, element: bold, startOffset: 0, endOffset: 13 },
				{ type: INLINE_TEXT, startOffset: 0, endOffset: 13 },
				{ type: INLINE_CLOSE_TAG },
				{ type: INLINE_TEXT, startOffset: 13, endOffset: 28 },
			];

			const target = document.createElement("div");
			Fragment.buildInlineContent(items, textContent, 13, 28, target);

			const out = {
				textContent: target.textContent,
				hasBold: target.querySelector("b") !== null,
			};
			container.remove();
			return out;
		});
		expect(result.textContent).toBe("after the break");
		expect(result.hasBold).toBe(false);
	});

	test("composes a break element for INLINE_CONTROL items", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { INLINE_TEXT, INLINE_CONTROL } = await import("/src/core/constants.js");

			const textContent = "line one\nline two";
			const items = [
				{ type: INLINE_TEXT, startOffset: 0, endOffset: 8 },
				{ type: INLINE_CONTROL, startOffset: 8, endOffset: 9 },
				{ type: INLINE_TEXT, startOffset: 9, endOffset: 17 },
			];
			const target = document.createElement("div");
			Fragment.buildInlineContent(items, textContent, 0, 17, target);
			return {
				hasBr: target.querySelector("br") !== null,
				textContent: target.textContent,
			};
		});
		expect(result.hasBr).toBe(true);
		expect(result.textContent).toBe("line oneline two");
	});
});

test.describe("Fragment.build", () => {
	test("builds child fragments as cloned elements", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { DOMLayoutNode } = await import("/src/dom/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px";
			document.body.appendChild(container);

			const outer = document.createElement("div");
			const child1 = document.createElement("div");
			child1.textContent = "First";
			const child2 = document.createElement("div");
			child2.textContent = "Second";
			outer.appendChild(child1);
			outer.appendChild(child2);
			container.appendChild(outer);

			const outerNode = new DOMLayoutNode(outer);
			const childNodes = outerNode.children;

			const childFrag1 = new Fragment(childNodes[0], 20);
			const childFrag2 = new Fragment(childNodes[1], 20);
			const rootFragment = new Fragment(outerNode, 40, [childFrag1, childFrag2]);

			const docFrag = rootFragment.build(null);

			const out = {
				childCount: docFrag.childNodes.length,
				tag0: docFrag.childNodes[0].tagName,
				text0: docFrag.childNodes[0].textContent,
				tag1: docFrag.childNodes[1].tagName,
				text1: docFrag.childNodes[1].textContent,
			};
			container.remove();
			return out;
		});
		expect(result.childCount).toBe(2);
		expect(result.tag0).toBe("DIV");
		expect(result.text0).toBe("First");
		expect(result.tag1).toBe("DIV");
		expect(result.text1).toBe("Second");
	});

	test("skips null-node children (line fragments)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { DOMLayoutNode } = await import("/src/dom/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px";
			document.body.appendChild(container);

			const outer = document.createElement("div");
			const child = document.createElement("p");
			child.textContent = "Content";
			outer.appendChild(child);
			container.appendChild(outer);

			const outerNode = new DOMLayoutNode(outer);
			const childNodes = outerNode.children;

			const lineFrag = new Fragment(null, 20);
			const childFrag = new Fragment(childNodes[0], 30);
			const rootFragment = new Fragment(outerNode, 50, [lineFrag, childFrag]);

			const docFrag = rootFragment.build(null);

			const out = {
				childCount: docFrag.childNodes.length,
				tag0: docFrag.childNodes[0].tagName,
				text0: docFrag.childNodes[0].textContent,
			};
			container.remove();
			return out;
		});
		expect(result.childCount).toBe(1);
		expect(result.tag0).toBe("P");
		expect(result.text0).toBe("Content");
	});

	test("sets data-split-to when fragment has a break token", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { BlockBreakToken } = await import("/src/core/tokens.js");
			const { DOMLayoutNode } = await import("/src/dom/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px";
			document.body.appendChild(container);

			const outer = document.createElement("div");
			const child = document.createElement("div");
			child.textContent = "Split content";
			outer.appendChild(child);
			container.appendChild(outer);

			const outerNode = new DOMLayoutNode(outer);
			const childNodes = outerNode.children;

			const childFrag = new Fragment(childNodes[0], 50);
			childFrag.breakToken = new BlockBreakToken(childNodes[0]);
			const rootFragment = new Fragment(outerNode, 50, [childFrag]);

			const docFrag = rootFragment.build(null);

			const out = {
				childCount: docFrag.childNodes.length,
				hasSplitTo: docFrag.childNodes[0].hasAttribute("data-split-to"),
			};
			container.remove();
			return out;
		});
		expect(result.childCount).toBe(1);
		expect(result.hasSplitTo).toBe(true);
	});

	test("sets data-justify-last on split fragments with text-align: justify", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { BlockBreakToken } = await import("/src/core/tokens.js");
			const { DOMLayoutNode } = await import("/src/dom/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px";
			document.body.appendChild(container);

			const outer = document.createElement("div");
			const child = document.createElement("div");
			child.style.textAlign = "justify";
			child.textContent = "Justified content that breaks across pages";
			outer.appendChild(child);
			container.appendChild(outer);

			const outerNode = new DOMLayoutNode(outer);
			const childNodes = outerNode.children;

			const childFrag = new Fragment(childNodes[0], 50);
			childFrag.breakToken = new BlockBreakToken(childNodes[0]);
			const rootFragment = new Fragment(outerNode, 50, [childFrag]);

			const docFrag = rootFragment.build(null);
			const composed = docFrag.childNodes[0];

			const out = {
				hasSplitTo: composed.hasAttribute("data-split-to"),
				hasJustifyLast: composed.hasAttribute("data-justify-last"),
			};
			container.remove();
			return out;
		});
		expect(result.hasSplitTo).toBe(true);
		expect(result.hasJustifyLast).toBe(true);
	});

	test("does not set data-justify-last when text-align is not justify", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { BlockBreakToken } = await import("/src/core/tokens.js");
			const { DOMLayoutNode } = await import("/src/dom/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px";
			document.body.appendChild(container);

			const outer = document.createElement("div");
			const child = document.createElement("div");
			child.style.textAlign = "left";
			child.textContent = "Left-aligned content";
			outer.appendChild(child);
			container.appendChild(outer);

			const outerNode = new DOMLayoutNode(outer);
			const childNodes = outerNode.children;

			const childFrag = new Fragment(childNodes[0], 50);
			childFrag.breakToken = new BlockBreakToken(childNodes[0]);
			const rootFragment = new Fragment(outerNode, 50, [childFrag]);

			const docFrag = rootFragment.build(null);
			const composed = docFrag.childNodes[0];

			const out = {
				hasSplitTo: composed.hasAttribute("data-split-to"),
				hasJustifyLast: composed.hasAttribute("data-justify-last"),
			};
			container.remove();
			return out;
		});
		expect(result.hasSplitTo).toBe(true);
		expect(result.hasJustifyLast).toBe(false);
	});

	test("sets data-justify-last after element is detached from DOM", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { BlockBreakToken } = await import("/src/core/tokens.js");
			const { DOMLayoutNode } = await import("/src/dom/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px";
			document.body.appendChild(container);

			const outer = document.createElement("div");
			const child = document.createElement("div");
			child.style.textAlign = "justify";
			child.textContent = "Justified content";
			outer.appendChild(child);
			container.appendChild(outer);

			const outerNode = new DOMLayoutNode(outer);
			const childNodes = outerNode.children;
			// Access a style property to trigger #getStyle() while attached
			void childNodes[0].breakBefore;

			// Detach
			container.removeChild(outer);

			const childFrag = new Fragment(childNodes[0], 50);
			childFrag.breakToken = new BlockBreakToken(childNodes[0]);
			const rootFragment = new Fragment(outerNode, 50, [childFrag]);

			const docFrag = rootFragment.build(null);
			const composed = docFrag.childNodes[0];

			const out = {
				hasSplitTo: composed.hasAttribute("data-split-to"),
				hasJustifyLast: composed.hasAttribute("data-justify-last"),
			};
			container.remove();
			return out;
		});
		expect(result.hasSplitTo).toBe(true);
		expect(result.hasJustifyLast).toBe(true);
	});

	test("sets data-truncate-margin on fragment with truncateMarginBlockStart", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { DOMLayoutNode } = await import("/src/dom/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px";
			document.body.appendChild(container);

			const outer = document.createElement("div");
			const child = document.createElement("div");
			child.style.marginTop = "20px";
			child.textContent = "Content";
			outer.appendChild(child);
			container.appendChild(outer);

			const outerNode = new DOMLayoutNode(outer);
			const childNodes = outerNode.children;

			const childFrag = new Fragment(childNodes[0], 50);
			childFrag.truncateMarginBlockStart = true;
			const rootFragment = new Fragment(outerNode, 50, [childFrag]);

			const docFrag = rootFragment.build(null);
			const composed = docFrag.childNodes[0];

			const out = {
				hasTruncateMargin: composed.hasAttribute("data-truncate-margin"),
			};
			container.remove();
			return out;
		});
		expect(result.hasTruncateMargin).toBe(true);
	});

	test("does not set data-truncate-margin when truncateMarginBlockStart is false", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { DOMLayoutNode } = await import("/src/dom/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px";
			document.body.appendChild(container);

			const outer = document.createElement("div");
			const child = document.createElement("div");
			child.textContent = "Content";
			outer.appendChild(child);
			container.appendChild(outer);

			const outerNode = new DOMLayoutNode(outer);
			const childNodes = outerNode.children;

			const childFrag = new Fragment(childNodes[0], 50);
			const rootFragment = new Fragment(outerNode, 50, [childFrag]);

			const docFrag = rootFragment.build(null);
			const composed = docFrag.childNodes[0];

			const out = {
				hasTruncateMargin: composed.hasAttribute("data-truncate-margin"),
			};
			container.remove();
			return out;
		});
		expect(result.hasTruncateMargin).toBe(false);
	});

	test("sets data-truncate-margin-end on fragment with truncateMarginBlockEnd", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/core/fragment.js");
			const { DOMLayoutNode } = await import("/src/dom/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px";
			document.body.appendChild(container);

			const outer = document.createElement("div");
			const child = document.createElement("div");
			child.style.marginBottom = "20px";
			child.textContent = "Content";
			outer.appendChild(child);
			container.appendChild(outer);

			const outerNode = new DOMLayoutNode(outer);
			const childNodes = outerNode.children;

			const childFrag = new Fragment(childNodes[0], 50);
			childFrag.truncateMarginBlockEnd = true;
			const rootFragment = new Fragment(outerNode, 50, [childFrag]);

			const docFrag = rootFragment.build(null);
			const composed = docFrag.childNodes[0];

			const out = {
				hasTruncateMarginEnd: composed.hasAttribute("data-truncate-margin-end"),
			};
			container.remove();
			return out;
		});
		expect(result.hasTruncateMarginEnd).toBe(true);
	});
});
