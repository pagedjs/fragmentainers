import { test, expect } from "../browser-fixture.js";

test.describe("DOMLayoutNode", () => {
	test.describe("debugName", () => {
		test("formats tag#id.class1.class2", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				div.id = "foo";
				div.className = "bar baz";
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const debugName = node.debugName;
				container.remove();
				return { debugName };
			});
			expect(result.debugName).toBe("div#foo.bar.baz");
		});

		test("formats tag only when no id or class", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const p = document.createElement("p");
				container.appendChild(p);
				const node = new DOMLayoutNode(p);
				const debugName = node.debugName;
				container.remove();
				return { debugName };
			});
			expect(result.debugName).toBe("p");
		});
	});

	test.describe("classification", () => {
		test("img is a replaced element", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const img = document.createElement("img");
				container.appendChild(img);
				const node = new DOMLayoutNode(img);
				const isReplacedElement = node.isReplacedElement;
				container.remove();
				return { isReplacedElement };
			});
			expect(result.isReplacedElement).toBe(true);
		});

		test("div is not a replaced element", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const isReplacedElement = node.isReplacedElement;
				container.remove();
				return { isReplacedElement };
			});
			expect(result.isReplacedElement).toBe(false);
		});

		test("overflow-y: scroll is scrollable", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				div.style.overflowY = "scroll";
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const isScrollable = node.isScrollable;
				container.remove();
				return { isScrollable };
			});
			expect(result.isScrollable).toBe(true);
		});

		test("explicit height means hasExplicitBlockSize", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				div.style.height = "100px";
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const hasExplicitBlockSize = node.hasExplicitBlockSize;
				container.remove();
				return { hasExplicitBlockSize };
			});
			expect(result.hasExplicitBlockSize).toBe(true);
		});

		test("auto height means no explicit block size", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const hasExplicitBlockSize = node.hasExplicitBlockSize;
				container.remove();
				return { hasExplicitBlockSize };
			});
			expect(result.hasExplicitBlockSize).toBe(false);
		});

		test("display: flex is a flex container", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				div.style.display = "flex";
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const isFlexContainer = node.isFlexContainer;
				container.remove();
				return { isFlexContainer };
			});
			expect(result.isFlexContainer).toBe(true);
		});

		test("display: grid is a grid container", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				div.style.display = "grid";
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const isGridContainer = node.isGridContainer;
				container.remove();
				return { isGridContainer };
			});
			expect(result.isGridContainer).toBe(true);
		});

		test("column-count: 3 is a multicol container", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				div.style.columnCount = "3";
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const isMulticolContainer = node.isMulticolContainer;
				container.remove();
				return { isMulticolContainer };
			});
			expect(result.isMulticolContainer).toBe(true);
		});

		test("overflow: hidden sets hasOverflowHidden", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				div.style.overflow = "hidden";
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const hasOverflowHidden = node.hasOverflowHidden;
				container.remove();
				return { hasOverflowHidden };
			});
			expect(result.hasOverflowHidden).toBe(true);
		});
	});

	test.describe("box model", () => {
		test("returns margin, padding, and border block-start values", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				div.style.margin = "10px";
				div.style.padding = "20px";
				div.style.border = "5px solid black";
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const marginBlockStart = node.marginBlockStart;
				const paddingBlockStart = node.paddingBlockStart;
				const borderBlockStart = node.borderBlockStart;
				container.remove();
				return { marginBlockStart, paddingBlockStart, borderBlockStart };
			});
			expect(result.marginBlockStart).toBe(10);
			expect(result.paddingBlockStart).toBe(20);
			expect(result.borderBlockStart).toBe(5);
		});

		test("returns margin, padding, and border block-end values", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				div.style.margin = "10px";
				div.style.padding = "20px";
				div.style.border = "5px solid black";
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const marginBlockEnd = node.marginBlockEnd;
				const paddingBlockEnd = node.paddingBlockEnd;
				const borderBlockEnd = node.borderBlockEnd;
				container.remove();
				return { marginBlockEnd, paddingBlockEnd, borderBlockEnd };
			});
			expect(result.marginBlockEnd).toBe(10);
			expect(result.paddingBlockEnd).toBe(20);
			expect(result.borderBlockEnd).toBe(5);
		});
	});

	test.describe("children", () => {
		test("returns DOMLayoutNode children for block children", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const parent = document.createElement("div");
				parent.innerHTML = "<div>A</div><div>B</div>";
				container.appendChild(parent);
				const node = new DOMLayoutNode(parent);
				const childrenLength = node.children.length;
				const child0IsDOMLayoutNode = node.children[0] instanceof DOMLayoutNode;
				const child1IsDOMLayoutNode = node.children[1] instanceof DOMLayoutNode;
				container.remove();
				return { childrenLength, child0IsDOMLayoutNode, child1IsDOMLayoutNode };
			});
			expect(result.childrenLength).toBe(2);
			expect(result.child0IsDOMLayoutNode).toBe(true);
			expect(result.child1IsDOMLayoutNode).toBe(true);
		});

		test("skips display:none children", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const parent = document.createElement("div");
				parent.innerHTML = '<div>A</div><div style="display:none">B</div>';
				container.appendChild(parent);
				const node = new DOMLayoutNode(parent);
				const childrenLength = node.children.length;
				container.remove();
				return { childrenLength };
			});
			expect(result.childrenLength).toBe(1);
		});

		test("skips script tags", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const parent = document.createElement("div");
				parent.innerHTML = "<div>A</div><script>var x=1;</script>";
				container.appendChild(parent);
				const node = new DOMLayoutNode(parent);
				const childrenLength = node.children.length;
				container.remove();
				return { childrenLength };
			});
			expect(result.childrenLength).toBe(1);
		});

		test("skips style tags", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const parent = document.createElement("div");
				parent.innerHTML = "<div>A</div><style>.x{}</style>";
				container.appendChild(parent);
				const node = new DOMLayoutNode(parent);
				const childrenLength = node.children.length;
				container.remove();
				return { childrenLength };
			});
			expect(result.childrenLength).toBe(1);
		});

		test("wraps mixed inline/block content with AnonymousBlockNode", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const { AnonymousBlockNode } = await import("/src/layout/anonymous-block-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const parent = document.createElement("div");
				parent.innerHTML = "Some text <div>block</div> more text";
				container.appendChild(parent);
				const node = new DOMLayoutNode(parent);
				const childrenLength = node.children.length;
				const child0IsAnonymousBlockNode = node.children[0] instanceof AnonymousBlockNode;
				const child1IsDOMLayoutNode = node.children[1] instanceof DOMLayoutNode;
				const child2IsAnonymousBlockNode = node.children[2] instanceof AnonymousBlockNode;
				container.remove();
				return {
					childrenLength,
					child0IsAnonymousBlockNode,
					child1IsDOMLayoutNode,
					child2IsAnonymousBlockNode,
				};
			});
			expect(result.childrenLength).toBe(3);
			expect(result.child0IsAnonymousBlockNode).toBe(true);
			expect(result.child1IsDOMLayoutNode).toBe(true);
			expect(result.child2IsAnonymousBlockNode).toBe(true);
		});
	});

	test.describe("blockSize", () => {
		test("returns the height of an element", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				div.style.height = "200px";
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const blockSize = node.blockSize;
				container.remove();
				return { blockSize };
			});
			expect(result.blockSize).toBe(200);
		});
	});

	test.describe("isInlineFormattingContext", () => {
		test("is true for a paragraph with text", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const p = document.createElement("p");
				p.textContent = "Hello world";
				container.appendChild(p);
				const node = new DOMLayoutNode(p);
				const isInlineFormattingContext = node.isInlineFormattingContext;
				container.remove();
				return { isInlineFormattingContext };
			});
			expect(result.isInlineFormattingContext).toBe(true);
		});

		test("is false for a div with block children", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				div.innerHTML = "<div>block</div>";
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const isInlineFormattingContext = node.isInlineFormattingContext;
				container.remove();
				return { isInlineFormattingContext };
			});
			expect(result.isInlineFormattingContext).toBe(false);
		});

		test("is false for a replaced element", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const img = document.createElement("img");
				container.appendChild(img);
				const node = new DOMLayoutNode(img);
				const isInlineFormattingContext = node.isInlineFormattingContext;
				container.remove();
				return { isInlineFormattingContext };
			});
			expect(result.isInlineFormattingContext).toBe(false);
		});
	});

	test.describe("inlineItemsData", () => {
		test("collects items with correct types for mixed inline content", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const { INLINE_TEXT, INLINE_OPEN_TAG, INLINE_CLOSE_TAG } =
					await import("/src/measurement/collect-inlines.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const p = document.createElement("p");
				p.innerHTML = "Hello <em>world</em>";
				container.appendChild(p);
				const node = new DOMLayoutNode(p);
				const data = node.inlineItemsData;
				const isNotNull = data !== null;
				const textContent = data ? data.textContent : null;
				const types = data ? data.items.map((item) => item.type) : [];
				const hasInlineText = types.includes(INLINE_TEXT);
				const hasInlineOpenTag = types.includes(INLINE_OPEN_TAG);
				const hasInlineCloseTag = types.includes(INLINE_CLOSE_TAG);
				container.remove();
				return { isNotNull, textContent, hasInlineText, hasInlineOpenTag, hasInlineCloseTag };
			});
			expect(result.isNotNull).toBe(true);
			expect(result.textContent).toBe("Hello world");
			expect(result.hasInlineText).toBe(true);
			expect(result.hasInlineOpenTag).toBe(true);
			expect(result.hasInlineCloseTag).toBe(true);
		});

		test("returns null for non-IFC elements", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				div.innerHTML = "<div>block</div>";
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const isNull = node.inlineItemsData === null;
				container.remove();
				return { isNull };
			});
			expect(result.isNull).toBe(true);
		});
	});

	test.describe("fragmentation properties", () => {
		test("reads break-before", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				div.style.breakBefore = "page";
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const breakBefore = node.breakBefore;
				container.remove();
				return { breakBefore };
			});
			expect(result.breakBefore).toBe("page");
		});

		test("reads break-after", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				div.style.breakAfter = "column";
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const breakAfter = node.breakAfter;
				container.remove();
				return { breakAfter };
			});
			expect(result.breakAfter).toBe("column");
		});

		test("reads break-inside", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				div.style.breakInside = "avoid";
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const breakInside = node.breakInside;
				container.remove();
				return { breakInside };
			});
			expect(result.breakInside).toBe("avoid");
		});

		test("reads orphans", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				div.style.orphans = "3";
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const orphans = node.orphans;
				container.remove();
				return { orphans };
			});
			expect(result.orphans).toBe(3);
		});

		test("reads widows", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				div.style.widows = "4";
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const widows = node.widows;
				container.remove();
				return { widows };
			});
			expect(result.widows).toBe(4);
		});

		test("defaults orphans to 2", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const orphans = node.orphans;
				container.remove();
				return { orphans };
			});
			expect(result.orphans).toBe(2);
		});

		test("defaults breakBefore to auto", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
				const container = document.createElement("div");
				document.body.appendChild(container);
				const div = document.createElement("div");
				container.appendChild(div);
				const node = new DOMLayoutNode(div);
				const breakBefore = node.breakBefore;
				container.remove();
				return { breakBefore };
			});
			expect(result.breakBefore).toBe("auto");
		});
	});
});

test.describe("AnonymousBlockNode", () => {
	test("has debugName [anon]", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { AnonymousBlockNode } = await import("/src/layout/anonymous-block-node.js");
			const container = document.createElement("div");
			document.body.appendChild(container);
			const parent = document.createElement("div");
			const text = document.createTextNode("hello");
			parent.appendChild(text);
			container.appendChild(parent);
			const anon = new AnonymousBlockNode(parent, [text]);
			const debugName = anon.debugName;
			container.remove();
			return { debugName };
		});
		expect(result.debugName).toBe("[anon]");
	});

	test("is an inline formatting context", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { AnonymousBlockNode } = await import("/src/layout/anonymous-block-node.js");
			const container = document.createElement("div");
			document.body.appendChild(container);
			const parent = document.createElement("div");
			const text = document.createTextNode("hello");
			parent.appendChild(text);
			container.appendChild(parent);
			const anon = new AnonymousBlockNode(parent, [text]);
			const isInlineFormattingContext = anon.isInlineFormattingContext;
			container.remove();
			return { isInlineFormattingContext };
		});
		expect(result.isInlineFormattingContext).toBe(true);
	});

	test("has neutral box model values", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { AnonymousBlockNode } = await import("/src/layout/anonymous-block-node.js");
			const anon = new AnonymousBlockNode(document.createElement("div"), []);
			return {
				marginBlockStart: anon.marginBlockStart,
				marginBlockEnd: anon.marginBlockEnd,
				paddingBlockStart: anon.paddingBlockStart,
				paddingBlockEnd: anon.paddingBlockEnd,
				borderBlockStart: anon.borderBlockStart,
				borderBlockEnd: anon.borderBlockEnd,
			};
		});
		expect(result.marginBlockStart).toBe(0);
		expect(result.marginBlockEnd).toBe(0);
		expect(result.paddingBlockStart).toBe(0);
		expect(result.paddingBlockEnd).toBe(0);
		expect(result.borderBlockStart).toBe(0);
		expect(result.borderBlockEnd).toBe(0);
	});

	test("has no element", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { AnonymousBlockNode } = await import("/src/layout/anonymous-block-node.js");
			const anon = new AnonymousBlockNode(document.createElement("div"), []);
			return { elementIsNull: anon.element === null };
		});
		expect(result.elementIsNull).toBe(true);
	});

	test("collects inlineItemsData from child nodes", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { AnonymousBlockNode } = await import("/src/layout/anonymous-block-node.js");
			const container = document.createElement("div");
			document.body.appendChild(container);
			const parent = document.createElement("div");
			const text = document.createTextNode("hello");
			parent.appendChild(text);
			container.appendChild(parent);
			const anon = new AnonymousBlockNode(parent, [text]);
			const data = anon.inlineItemsData;
			const isNotNull = data !== null;
			const textContent = data ? data.textContent : null;
			container.remove();
			return { isNotNull, textContent };
		});
		expect(result.isNotNull).toBe(true);
		expect(result.textContent).toBe("hello");
	});
});
