import { test, expect } from "../browser-fixture.js";

test.describe("locate", () => {
	test("locates a fresh block element in its top-level fragment", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { locate } = await import("/src/fragmentation/locate.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const rootElement = document.createElement("div");
			const target = document.createElement("section");
			rootElement.appendChild(target);
			const rootNode = blockNode({ element: rootElement });
			const targetNode = blockNode({ element: target });
			const top = new Fragment(rootNode, 100, [new Fragment(targetNode, 50)]);
			const locations = locate([top], target);
			return locations.map((location) => ({
				index: location.index,
				isTop: location.fragment === top,
				isContinuation: location.isContinuation,
			}));
		});

		expect(result).toEqual([{ index: 0, isTop: true, isContinuation: false }]);
	});

	test("reports a split block once per fragmentainer in order", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { locate } = await import("/src/fragmentation/locate.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const rootElement = document.createElement("div");
			const target = document.createElement("section");
			rootElement.appendChild(target);
			const rootNode = blockNode({ element: rootElement });
			const targetNode = blockNode({ element: target });

			const targetToken = new BlockBreakToken(targetNode);
			const rootToken = new BlockBreakToken(rootNode);
			rootToken.childBreakTokens = [targetToken];
			const firstTarget = new Fragment(targetNode, 50);
			firstTarget.breakToken = targetToken;
			const first = new Fragment(rootNode, 100, [firstTarget]);
			first.breakToken = rootToken;
			const second = new Fragment(rootNode, 100, [new Fragment(targetNode, 50)]);

			return locate([first, second], target, { indexOffset: 4 }).map((location) => ({
				index: location.index,
				first: location.fragment === first,
				second: location.fragment === second,
				isContinuation: location.isContinuation,
			}));
		});

		expect(result).toEqual([
			{ index: 4, first: true, second: false, isContinuation: false },
			{ index: 5, first: false, second: true, isContinuation: true },
		]);
	});

	test("keeps a break-before child fresh under a continued ancestor", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { locate } = await import("/src/fragmentation/locate.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const rootElement = document.createElement("div");
			const target = document.createElement("section");
			rootElement.appendChild(target);
			const rootNode = blockNode({ element: rootElement });
			const targetNode = blockNode({ element: target });
			const rootToken = new BlockBreakToken(rootNode);
			rootToken.childBreakTokens = [BlockBreakToken.createBreakBefore(targetNode)];
			const previous = new Fragment(rootNode, 100);
			previous.breakToken = rootToken;
			const current = new Fragment(rootNode, 100, [new Fragment(targetNode, 50)]);

			return locate([current], target, { previous, indexOffset: 7 }).map((location) => ({
				index: location.index,
				isContinuation: location.isContinuation,
			}));
		});

		expect(result).toEqual([{ index: 7, isContinuation: false }]);
	});

	test("uses descendant fragments and leaf cloning as safe fallbacks", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { locate } = await import("/src/fragmentation/locate.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const root = document.createElement("div");
			const boxlessTarget = document.createElement("div");
			const representedChild = document.createElement("section");
			boxlessTarget.appendChild(representedChild);
			root.appendChild(boxlessTarget);
			const nestedTarget = document.createElement("em");
			const leaf = document.createElement("div");
			leaf.appendChild(nestedTarget);
			root.appendChild(leaf);

			const first = new Fragment(
				blockNode({ element: root }),
				100,
				[new Fragment(blockNode({ element: representedChild }), 40)],
			);
			const second = new Fragment(blockNode({ element: leaf }), 40);
			return {
				boxless: locate([first], boxlessTarget).map(({ index }) => index),
				nested: locate([second], nestedTarget).map(({ index }) => index),
			};
		});

		expect(result).toEqual({ boxless: [0], nested: [0] });
	});

	test("locates an inline span across real line and page fragments", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { locate } = await import("/src/fragmentation/locate.js");
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const host = document.createElement("div");
			host.style.cssText = "position:absolute;left:-9999px;top:0";
			const text = Array.from({ length: 80 }, () => "word").join(" ");
			host.innerHTML = `<p style="width:160px;font:16px monospace;line-height:20px;margin:0;padding:0"><span>${text}</span></p>`;
			document.body.appendChild(host);
			const paragraph = host.firstElementChild;
			const target = paragraph.firstElementChild;
			const fragments = createFragments(
				new DOMLayoutNode(paragraph),
				new ConstraintSpace({
					availableInlineSize: 160,
					availableBlockSize: 60,
					fragmentainerBlockSize: 60,
					fragmentationType: "page",
				}),
			);
			const locations = locate(fragments, target).map(({ index, isContinuation }) => ({
				index,
				isContinuation,
			}));
			host.remove();
			return { fragmentCount: fragments.length, locations };
		});

		expect(result.fragmentCount).toBeGreaterThan(1);
		expect(result.locations).toHaveLength(result.fragmentCount);
		expect(result.locations[0]).toEqual({ index: 0, isContinuation: false });
		for (const location of result.locations.slice(1)) {
			expect(location.isContinuation).toBe(true);
		}
	});

	test("keeps an inline target fresh when it starts after the page input offset", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { locate } = await import("/src/fragmentation/locate.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { InlineBreakToken, BlockBreakToken } = await import(
				"/src/fragmentation/tokens.js"
			);
			const { collectInlineItems } = await import("/src/measurement/collect-inlines.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const paragraph = document.createElement("p");
			paragraph.innerHTML = "before<span>target</span>after";
			document.body.appendChild(paragraph);
			const target = paragraph.querySelector("span");
			const inlineNode = blockNode({
				isInlineNode: true,
				inlineItemsData: collectInlineItems(paragraph.childNodes),
			});
			const rootNode = blockNode({ element: paragraph });
			const inlineInput = new InlineBreakToken(inlineNode);
			inlineInput.textOffset = 3;
			const rootInput = new BlockBreakToken(rootNode);
			rootInput.childBreakTokens = [inlineInput];
			const previous = new Fragment(rootNode, 20);
			previous.breakToken = rootInput;
			const current = new Fragment(rootNode, 20, [new Fragment(inlineNode, 20)]);
			const locations = locate([current], target, { previous });
			paragraph.remove();
			return locations.map(({ isContinuation }) => isContinuation);
		});

		expect(result).toEqual([false]);
	});

	test("locates a descendant inside an atomic inline only in its interval", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { locate } = await import("/src/fragmentation/locate.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { InlineBreakToken, BlockBreakToken } = await import(
				"/src/fragmentation/tokens.js"
			);
			const { collectInlineItems } = await import("/src/measurement/collect-inlines.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const paragraph = document.createElement("p");
			paragraph.innerHTML = 'aa<span style="display:inline-block"><b>atomic</b></span>zz';
			document.body.appendChild(paragraph);
			const target = paragraph.querySelector("b");
			const inlineNode = blockNode({
				isInlineNode: true,
				inlineItemsData: collectInlineItems(paragraph.childNodes),
			});
			const rootNode = blockNode({ element: paragraph });
			const inlineToken = new InlineBreakToken(inlineNode);
			inlineToken.textOffset = 2;
			const rootToken = new BlockBreakToken(rootNode);
			rootToken.childBreakTokens = [inlineToken];
			const firstInline = new Fragment(inlineNode, 20);
			firstInline.breakToken = inlineToken;
			const first = new Fragment(rootNode, 20, [firstInline]);
			first.breakToken = rootToken;
			const second = new Fragment(rootNode, 20, [new Fragment(inlineNode, 20)]);
			const locations = locate([first, second], target);
			paragraph.remove();
			return locations.map(({ index, isContinuation }) => ({ index, isContinuation }));
		});

		expect(result).toEqual([{ index: 1, isContinuation: false }]);
	});

	test("uses distinct tokens for duplicate anonymous child nodes", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { locate } = await import("/src/fragmentation/locate.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { InlineBreakToken, BlockBreakToken } = await import(
				"/src/fragmentation/tokens.js"
			);
			const { collectInlineItems } = await import("/src/measurement/collect-inlines.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const paragraph = document.createElement("p");
			paragraph.innerHTML = "aa<span>target</span>";
			document.body.appendChild(paragraph);
			const target = paragraph.querySelector("span");
			const inlineNode = blockNode({
				isInlineNode: true,
				inlineItemsData: collectInlineItems(paragraph.childNodes),
			});
			const rootNode = blockNode({ element: paragraph });
			const firstInput = new InlineBreakToken(inlineNode);
			firstInput.textOffset = 0;
			const secondInput = new InlineBreakToken(inlineNode);
			secondInput.textOffset = 5;
			const rootInput = new BlockBreakToken(rootNode);
			rootInput.childBreakTokens = [firstInput, secondInput];
			const previous = new Fragment(rootNode, 20);
			previous.breakToken = rootInput;

			const firstOutput = new InlineBreakToken(inlineNode);
			firstOutput.textOffset = 2;
			const firstChild = new Fragment(inlineNode, 20);
			firstChild.breakToken = firstOutput;
			const secondChild = new Fragment(inlineNode, 20);
			const current = new Fragment(rootNode, 20, [firstChild, secondChild]);
			const locations = locate([current], target, { previous });
			paragraph.remove();
			return locations.map(({ isContinuation }) => isContinuation);
		});

		expect(result).toEqual([true]);
	});

	test("returns an empty list for an absent element", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { locate } = await import("/src/fragmentation/locate.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			const present = document.createElement("div");
			const absent = document.createElement("aside");
			return locate([new Fragment(blockNode({ element: present }), 20)], absent);
		});

		expect(result).toEqual([]);
	});

	test("does not report source targets on inserted blank pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const template = document.createElement("template");
			template.innerHTML = `<div style="height:50px;margin:0">first</div>
				<div id="target" style="height:50px;margin:0;break-before:right">target</div>`;
			const target = template.content.querySelector("#target");
			const layout = new Fragmenter(template.content, {
				resolver: new PageResolver([], { inlineSize: 300, blockSize: 100 }),
			});
			const context = layout.flow();
			const value = {
				blank: context.fragments.map((fragment) => fragment.isBlank),
				locations: context.locate(target).map(({ index }) => index),
			};
			layout.destroy();
			return value;
		});

		expect(result).toEqual({ blank: [false, true, false], locations: [2] });
	});
});
