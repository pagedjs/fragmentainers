import { test, expect } from "../browser-fixture.js";

test.describe("hasBlockChildren", () => {
	test("returns false for empty childFragments", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const fragment = new Fragment(blockNode(), 100, []);
			return fragment.hasBlockChildren;
		});
		expect(result).toBe(false);
	});

	test("returns false when all children have null nodes (line fragments)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const lineFragment = new Fragment(null, 20);
			const fragment = new Fragment(blockNode(), 100, [lineFragment, lineFragment]);
			return fragment.hasBlockChildren;
		});
		expect(result).toBe(false);
	});

	test("returns true when at least one child has a node", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/fragmentation/fragment.js");
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
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const child1 = new Fragment(blockNode({ debugName: "a" }), 50);
			const child2 = new Fragment(blockNode({ debugName: "b" }), 50);
			const fragment = new Fragment(blockNode(), 100, [child1, child2]);
			return fragment.hasBlockChildren;
		});
		expect(result).toBe(true);
	});
});

test.describe("rendersNothing", () => {
	test("an empty container whose children were all pushed renders nothing", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { rendersNothing, Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const child = blockNode({ debugName: "child" });
			const container = blockNode({ debugName: "container", children: [child] });
			const fragment = new Fragment(container, 0, []);
			fragment.breakToken = new BlockBreakToken(container);
			fragment.breakToken.childBreakTokens = [BlockBreakToken.createBreakBefore(child)];

			return rendersNothing(fragment, null);
		});
		expect(result).toBe(true);
	});

	test("a leaf node being sliced renders", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { rendersNothing, Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const leaf = blockNode({ debugName: "leaf" });
			const fragment = new Fragment(leaf, 200, []);
			fragment.breakToken = new BlockBreakToken(leaf);
			fragment.breakToken.consumedBlockSize = 200;

			return rendersNothing(fragment, null);
		});
		expect(result).toBe(false);
	});

	test("a container with a placed child renders", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { rendersNothing, Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const child = blockNode({ debugName: "child" });
			const container = blockNode({ debugName: "container", children: [child] });
			const fragment = new Fragment(container, 50, [new Fragment(child, 50)]);
			fragment.breakToken = new BlockBreakToken(container);

			return rendersNothing(fragment, null);
		});
		expect(result).toBe(false);
	});

	test("a completed container renders", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { rendersNothing, Fragment } = await import("/src/fragmentation/fragment.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const child = blockNode({ debugName: "child" });
			const container = blockNode({ debugName: "container", children: [child] });

			return rendersNothing(new Fragment(container, 50, [new Fragment(child, 50)]), null);
		});
		expect(result).toBe(false);
	});

	test("a container renders nothing when every child renders nothing", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { rendersNothing, Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const grandchild = blockNode({ debugName: "grandchild" });
			const child = blockNode({ debugName: "child", children: [grandchild] });
			const container = blockNode({ debugName: "container", children: [child] });

			const childFragment = new Fragment(child, 0, []);
			childFragment.breakToken = new BlockBreakToken(child);
			childFragment.breakToken.childBreakTokens = [BlockBreakToken.createBreakBefore(grandchild)];

			const fragment = new Fragment(container, 0, [childFragment]);
			fragment.breakToken = new BlockBreakToken(container);
			fragment.breakToken.childBreakTokens = [childFragment.breakToken];

			return rendersNothing(fragment, null);
		});
		expect(result).toBe(true);
	});

	test("a block-clip slice of an emptied container renders", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { rendersNothing, Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const child = blockNode({ debugName: "child" });
			const container = blockNode({ debugName: "container", children: [child] });
			const fragment = new Fragment(container, 40, []);
			fragment.needsBlockClip = true;
			fragment.breakToken = new BlockBreakToken(container);

			return rendersNothing(fragment, null);
		});
		expect(result).toBe(false);
	});

	test("a box past its block-end renders its emptied box", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { rendersNothing, Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const container = blockNode({
				debugName: "container",
				element: document.createElement("div"),
			});
			const input = new BlockBreakToken(container);
			input.isAtBlockEnd = true;

			return rendersNothing(new Fragment(container, 0, []), input);
		});
		expect(result).toBe(false);
	});

	test("a box past its block-end with no element of its own renders nothing", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { rendersNothing, Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const container = blockNode({ debugName: "container" });
			const input = new BlockBreakToken(container);
			input.isAtBlockEnd = true;

			return rendersNothing(new Fragment(container, 0, []), input);
		});
		expect(result).toBe(true);
	});

	test("an inline node whose text all moved on renders nothing", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { rendersNothing, Fragment } = await import("/src/fragmentation/fragment.js");
			const { InlineBreakToken } = await import("/src/fragmentation/tokens.js");
			const { inlineNode, textToInlineItems } = await import("/test/fixtures/nodes.js");

			const node = inlineNode({ inlineItemsData: textToInlineItems("one two three") });
			const fragment = new Fragment(node, 0, []);
			fragment.breakToken = new InlineBreakToken(node);

			return rendersNothing(fragment, null);
		});
		expect(result).toBe(true);
	});

	test("an inline node renders the text between its offsets", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { rendersNothing, Fragment } = await import("/src/fragmentation/fragment.js");
			const { InlineBreakToken } = await import("/src/fragmentation/tokens.js");
			const { inlineNode, textToInlineItems } = await import("/test/fixtures/nodes.js");

			const node = inlineNode({ inlineItemsData: textToInlineItems("one two three") });
			const fragment = new Fragment(node, 20, []);
			fragment.breakToken = new InlineBreakToken(node);
			fragment.breakToken.textOffset = 7;

			return rendersNothing(fragment, null);
		});
		expect(result).toBe(false);
	});

	test("an inline node with no items renders nothing", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { rendersNothing, Fragment } = await import("/src/fragmentation/fragment.js");
			const { inlineNode } = await import("/test/fixtures/nodes.js");

			const node = inlineNode({ inlineItemsData: { items: [], textContent: "" } });

			return rendersNothing(new Fragment(node, 0, []), null);
		});
		expect(result).toBe(true);
	});
});

test.describe("inline items data for compositor", () => {
	test("textToInlineItems creates kText items with correct offsets", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { textToInlineItems } = await import("/test/fixtures/nodes.js");
			const { INLINE_TEXT } = await import("/src/measurement/collect-inlines.js");

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
			const { INLINE_TEXT, INLINE_CONTROL } = await import("/src/measurement/collect-inlines.js");

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
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { INLINE_TEXT } = await import("/src/measurement/collect-inlines.js");

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
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { INLINE_TEXT } = await import("/src/measurement/collect-inlines.js");

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
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { INLINE_TEXT, INLINE_OPEN_TAG, INLINE_CLOSE_TAG } =
				await import("/src/measurement/collect-inlines.js");

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
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { INLINE_TEXT, INLINE_OPEN_TAG, INLINE_CLOSE_TAG } =
				await import("/src/measurement/collect-inlines.js");

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
		// Raw slice — trim only fires when hasTrailingCollapsibleSpace=true
		expect(result.textContent).toBe("before break ");
		expect(result.hasItalic).toBe(false);
	});

	test("skips inline elements whose content is entirely before the visible range", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { INLINE_TEXT, INLINE_OPEN_TAG, INLINE_CLOSE_TAG } =
				await import("/src/measurement/collect-inlines.js");

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
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { INLINE_TEXT, INLINE_CONTROL } = await import("/src/measurement/collect-inlines.js");

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
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

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
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

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
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { splitTextBlock } = await import("/test/fixtures/fragments.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

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

			const childFrag = splitTextBlock(childNodes[0], 50);
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

	test("applies resolved text-align-last on split fragments with text-align: justify", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { splitTextBlock } = await import("/test/fixtures/fragments.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

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

			const childFrag = splitTextBlock(childNodes[0], 50);
			const rootFragment = new Fragment(outerNode, 50, [childFrag]);

			const docFrag = rootFragment.build(null);
			const composed = docFrag.childNodes[0];

			const out = {
				hasSplitTo: composed.hasAttribute("data-split-to"),
				alignLast: composed.dataset.alignLast,
				styleAlignLast: composed.style.getPropertyValue("text-align-last"),
			};
			container.remove();
			return out;
		});
		expect(result.hasSplitTo).toBe(true);
		expect(result.alignLast).toBe("justify");
		expect(result.styleAlignLast).toBe("");
	});

	test("applies explicit text-align-last on the deepest split element", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { splitTextBlock } = await import("/test/fixtures/fragments.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px";
			document.body.appendChild(container);

			const outer = document.createElement("div");
			const child = document.createElement("div");
			child.style.textAlign = "left";
			child.style.textAlignLast = "center";
			child.textContent = "Centered final split line";
			outer.appendChild(child);
			container.appendChild(outer);

			const outerNode = new DOMLayoutNode(outer);
			const childNodes = outerNode.children;

			const childFrag = splitTextBlock(childNodes[0], 50);
			const rootFragment = new Fragment(outerNode, 50, [childFrag]);

			const docFrag = rootFragment.build(null);
			const composed = docFrag.childNodes[0];

			const out = {
				hasSplitTo: composed.hasAttribute("data-split-to"),
				alignLast: composed.dataset.alignLast,
				stylePriority: composed.style.getPropertyPriority("text-align-last"),
			};
			container.remove();
			return out;
		});

		expect(result.hasSplitTo).toBe(true);
		expect(result.alignLast).toBe("center");
		// The author's own inline text-align-last is cloned along; only the
		// compositor's !important declaration must be gone.
		expect(result.stylePriority).toBe("");
	});

	test("sets data-align-last only on the deepest split element", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { splitTextBlock } = await import("/test/fixtures/fragments.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px";
			document.body.appendChild(container);

			const root = document.createElement("div");
			const section = document.createElement("section");
			const wrapper = document.createElement("div");
			const paragraph = document.createElement("p");
			section.style.textAlign = "justify";
			paragraph.textContent = "Justified content that breaks inside a nested element";
			wrapper.appendChild(paragraph);
			section.appendChild(wrapper);
			root.appendChild(section);
			container.appendChild(root);

			const rootNode = new DOMLayoutNode(root);
			const sectionNode = rootNode.children[0];
			const wrapperNode = sectionNode.children[0];
			const paragraphNode = wrapperNode.children[0];

			const paragraphFrag = splitTextBlock(paragraphNode, 50);
			const paragraphToken = paragraphFrag.breakToken;
			const wrapperToken = new BlockBreakToken(wrapperNode);
			wrapperToken.childBreakTokens = [paragraphToken];
			const sectionToken = new BlockBreakToken(sectionNode);
			sectionToken.childBreakTokens = [wrapperToken];

			const wrapperFrag = new Fragment(wrapperNode, 50, [paragraphFrag]);
			wrapperFrag.breakToken = wrapperToken;
			const sectionFrag = new Fragment(sectionNode, 50, [wrapperFrag]);
			sectionFrag.breakToken = sectionToken;
			const rootFragment = new Fragment(rootNode, 50, [sectionFrag]);

			const docFrag = rootFragment.build(null);
			const composedSection = docFrag.childNodes[0];
			const composedWrapper = composedSection.firstElementChild;
			const composedParagraph = composedWrapper.firstElementChild;

			const out = {
				sectionHasSplitTo: composedSection.hasAttribute("data-split-to"),
				sectionAlignLast: composedSection.dataset.alignLast,
				wrapperHasSplitTo: composedWrapper.hasAttribute("data-split-to"),
				wrapperAlignLast: composedWrapper.dataset.alignLast,
				paragraphHasSplitTo: composedParagraph.hasAttribute("data-split-to"),
				paragraphAlignLast: composedParagraph.dataset.alignLast,
				paragraphStyleAlignLast: composedParagraph.style.getPropertyValue("text-align-last"),
			};
			container.remove();
			return out;
		});

		expect(result.sectionHasSplitTo).toBe(true);
		expect(result.sectionAlignLast).toBe(undefined);
		expect(result.wrapperHasSplitTo).toBe(true);
		expect(result.wrapperAlignLast).toBe(undefined);
		expect(result.paragraphHasSplitTo).toBe(true);
		expect(result.paragraphAlignLast).toBe("justify");
		expect(result.paragraphStyleAlignLast).toBe("");
	});

	test("does not set data-align-last when text-align is not justify", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { splitTextBlock } = await import("/test/fixtures/fragments.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

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

			const childFrag = splitTextBlock(childNodes[0], 50);
			const rootFragment = new Fragment(outerNode, 50, [childFrag]);

			const docFrag = rootFragment.build(null);
			const composed = docFrag.childNodes[0];

			const out = {
				hasSplitTo: composed.hasAttribute("data-split-to"),
				hasAlignLast: composed.hasAttribute("data-align-last"),
				alignLast: composed.dataset.alignLast,
				styleAlignLast: composed.style.getPropertyValue("text-align-last"),
			};
			container.remove();
			return out;
		});
		expect(result.hasSplitTo).toBe(true);
		expect(result.hasAlignLast).toBe(false);
		expect(result.alignLast).toBe(undefined);
		expect(result.styleAlignLast).toBe("");
	});

	test("sets data-align-last after element is detached from DOM", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { splitTextBlock } = await import("/test/fixtures/fragments.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

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

			const childFrag = splitTextBlock(childNodes[0], 50);
			const rootFragment = new Fragment(outerNode, 50, [childFrag]);

			const docFrag = rootFragment.build(null);
			const composed = docFrag.childNodes[0];

			const out = {
				hasSplitTo: composed.hasAttribute("data-split-to"),
				alignLast: composed.dataset.alignLast,
				styleAlignLast: composed.style.getPropertyValue("text-align-last"),
			};
			container.remove();
			return out;
		});
		expect(result.hasSplitTo).toBe(true);
		expect(result.alignLast).toBe("justify");
		expect(result.styleAlignLast).toBe("");
	});

	test("sets data-truncate-margin on fragment with truncateMarginBlockStart", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

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
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

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
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

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

// The <ol> starts 160px down a 200px page: its block-start padding and border
// fit, but no line does, so its first fragment composes to nothing and the
// decorations belong to the slice on page 2.
const SHELL_CSS = `
	@page { size: 300px 200px; margin: 0; }
	body, div, ol, li, p { margin: 0; }
	* { font: 16px/20px monospace; }
	ol { padding-top: 20px; border-top: 4px solid red; padding-left: 30px; }
`;
const SHELL_HTML =
	'<div style="height:160px"></div>' +
	"<ol><li>alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi</li></ol>";

test.describe("block-start decorations across fragmentainers", () => {
	test("a box whose first slice is an empty shell resumes without data-split-from", async ({
		page,
	}) => {
		const result = await page.evaluate(
			async ({ css, html }) => {
				const { Fragmenter, PageResolver } = await import("/src/index.js");
				const sheet = new CSSStyleSheet();
				sheet.replaceSync(css);
				const template = document.createElement("template");
				template.innerHTML = html;
				const flow = new Fragmenter(template.content, {
					resolver: PageResolver.fromStyleSheets([sheet]),
					styles: [sheet],
				});

				// stop: 0 runs layout without composing anything.
				const ctx = flow.flow({ start: 0, stop: 0 });
				const olToken = ctx.fragments[0].breakToken.childBreakTokens[0];
				const recorded = {
					tag: olToken.node.element.tagName,
					consumedBlockSize: olToken.consumedBlockSize,
					isAtBlockEnd: olToken.isAtBlockEnd,
				};

				const pages = [];
				for (let i = 0; i < ctx.fragmentainerCount; i++) {
					pages.push(ctx.createFragmentainer(i).innerHTML);
				}
				flow.destroy();
				return { recorded, pages };
			},
			{ css: SHELL_CSS, html: SHELL_HTML },
		);

		expect(result.recorded).toEqual({
			tag: "OL",
			consumedBlockSize: 0,
			isAtBlockEnd: false,
		});
		expect(result.pages.length).toBe(2);
		expect(result.pages[0]).not.toContain("<ol");
		expect(result.pages[1]).toContain("<ol");
		expect(result.pages[1]).not.toContain("data-split-from");
	});

	test("composing a subrange gives the same result as composing the whole flow", async ({
		page,
	}) => {
		const result = await page.evaluate(
			async ({ css, html }) => {
				const { Fragmenter, PageResolver } = await import("/src/index.js");

				function snapshot(token) {
					if (!token) return null;
					const entry = {};
					for (const [key, value] of Object.entries(token)) {
						if (key === "node" || key === "childBreakTokens") continue;
						if (value === null || typeof value !== "object") entry[key] = value;
					}
					entry.children = token.childBreakTokens?.map(snapshot) ?? null;
					return entry;
				}

				function start(range) {
					const sheet = new CSSStyleSheet();
					sheet.replaceSync(css);
					const template = document.createElement("template");
					template.innerHTML = html;
					const flow = new Fragmenter(template.content, {
						resolver: PageResolver.fromStyleSheets([sheet]),
						styles: [sheet],
					});
					return { flow, ctx: flow.flow(range) };
				}

				const whole = start({ start: 0, stop: 0 });
				const beforeCompose = whole.ctx.fragments.map((f) => snapshot(f.breakToken));
				const wholePages = [];
				for (let i = 0; i < whole.ctx.fragmentainerCount; i++) {
					wholePages.push(whole.ctx.createFragmentainer(i).innerHTML);
				}
				const afterCompose = whole.ctx.fragments.map((f) => snapshot(f.breakToken));
				whole.flow.destroy();

				const subrange = start({ start: 1 });
				const subrangePage = subrange.ctx[0].innerHTML;
				subrange.flow.destroy();

				return {
					tokensUnchanged: JSON.stringify(beforeCompose) === JSON.stringify(afterCompose),
					wholePage: wholePages[1],
					subrangePage,
				};
			},
			{ css: SHELL_CSS, html: SHELL_HTML },
		);

		expect(result.tokensUnchanged).toBe(true);
		expect(result.subrangePage).toBe(result.wholePage);
		expect(result.subrangePage).not.toContain("data-split-from");
	});

	test("a box resumed after an empty shell is still marked as split", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const host = document.createElement("div");
			host.style.cssText = "position:absolute;left:-9999px";
			host.innerHTML = "<section><p>Alpha</p><p>Beta</p></section>";
			document.body.appendChild(host);

			const rootNode = new DOMLayoutNode(host);
			const sectionNode = rootNode.children[0];
			const [alpha, beta] = sectionNode.children;

			// Page 1: the section renders, showing its first paragraph.
			const section1 = new Fragment(sectionNode, 20, [new Fragment(alpha, 20)]);
			section1.breakToken = new BlockBreakToken(sectionNode);
			section1.breakToken.consumedBlockSize = 20;
			section1.breakToken.childBreakTokens = [BlockBreakToken.createBreakBefore(beta)];
			const page1 = new Fragment(rootNode, 20, [section1]);
			page1.breakToken = new BlockBreakToken(rootNode);
			page1.breakToken.consumedBlockSize = 20;
			page1.breakToken.childBreakTokens = [section1.breakToken];

			// Page 2: the second paragraph found no room, so the section is a shell.
			// consumedBlockSize is cumulative: page 1's extent stays on the token.
			const beta2 = new Fragment(beta, 0, []);
			beta2.breakToken = new BlockBreakToken(beta);
			const section2 = new Fragment(sectionNode, 0, [beta2]);
			section2.breakToken = new BlockBreakToken(sectionNode);
			section2.breakToken.consumedBlockSize = 20;
			section2.breakToken.childBreakTokens = [beta2.breakToken];
			const page2 = new Fragment(rootNode, 0, [section2]);
			page2.breakToken = new BlockBreakToken(rootNode);
			page2.breakToken.consumedBlockSize = 20;
			page2.breakToken.childBreakTokens = [section2.breakToken];

			// Page 3: the section resumes with the second paragraph.
			const page3 = new Fragment(rootNode, 20, [
				new Fragment(sectionNode, 20, [new Fragment(beta, 20)]),
			]);

			// A section whose first slice was a shell: nothing was placed, so
			// BlockContainerAlgorithm left the token at zero extent.
			const shellFirstToken = new BlockBreakToken(rootNode);
			shellFirstToken.childBreakTokens = [new BlockBreakToken(sectionNode)];
			const afterShellFirst = new Fragment(rootNode, 20, [
				new Fragment(sectionNode, 20, [new Fragment(alpha, 20)]),
			]);

			const compose = (fragment, inputBreakToken) => {
				const holder = document.createElement("div");
				holder.appendChild(fragment.build(inputBreakToken));
				return holder.innerHTML;
			};
			const pages = [
				compose(page1, null),
				compose(page2, page1.breakToken),
				compose(page3, page2.breakToken),
			];

			const out = {
				pages,
				betaHasChildren: beta.children.length > 0,
				afterShellFirst: compose(afterShellFirst, shellFirstToken),
			};
			host.remove();
			return out;
		});

		expect(result.betaHasChildren).toBe(true);
		expect(result.pages[0]).toContain("<p>Alpha</p>");
		expect(result.pages[0]).not.toContain("data-split-from");
		expect(result.pages[1]).toBe("");
		expect(result.pages[2]).toContain('<section data-split-from=""');
		expect(result.afterShellFirst).toContain("<section");
		expect(result.afterShellFirst).not.toContain("data-split-from");
	});
});
