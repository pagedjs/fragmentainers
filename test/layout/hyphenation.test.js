import { test, expect } from "../browser-fixture.js";

test.describe("Inline hyphenation lang propagation", () => {
	test("content-measure propagates document lang so hyphens:auto hyphenates", async ({ page }) => {
		const result = await page.evaluate(async () => {
			await import("/src/components/content-measure.js");

			const originalLang = document.documentElement.lang;
			document.documentElement.setAttribute("lang", "en");

			const longWord = "antidisestablishmentarianism";
			const text = `${longWord} ${longWord} ${longWord}`;
			const sharedStyle =
				"width: 150px; font: 24px serif; line-height: 28px; margin: 0; padding: 0; hyphens: auto; -webkit-hyphens: auto; position: absolute; left: -9999px; top: 0;";

			const refP = document.createElement("p");
			refP.style.cssText = sharedStyle;
			refP.lang = "en";
			refP.textContent = text;
			document.body.appendChild(refP);
			const expectedHyphenatedHeight = refP.getBoundingClientRect().height;
			refP.remove();

			function measureInShadow() {
				const host = document.createElement("content-measure");
				document.body.appendChild(host);
				host.style.width = "150px";
				const slot = host.setupEmpty([]);
				const p = document.createElement("p");
				p.style.cssText = sharedStyle;
				p.textContent = text;
				slot.appendChild(p);
				void host.offsetHeight;
				const h = p.getBoundingClientRect().height;
				host.remove();
				return h;
			}

			const shadowHeight = measureInShadow();

			if (originalLang) document.documentElement.setAttribute("lang", originalLang);
			else document.documentElement.removeAttribute("lang");

			return {
				expectedHyphenatedHeight,
				shadowHeight,
			};
		});

		console.log("lang propagation result:", JSON.stringify(result, null, 2));

		expect(result.shadowHeight).toBe(result.expectedHyphenatedHeight);
	});

	test("FragmentedFlow produces multi-page output for hyphenated long words", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");

			const originalLang = document.documentElement.lang;
			document.documentElement.setAttribute("lang", "en");

			const frag = document.createDocumentFragment();
			const p = document.createElement("p");
			p.style.cssText =
				"width: 150px; font: 24px serif; line-height: 28px; margin: 0; padding: 0; hyphens: auto; -webkit-hyphens: auto;";
			p.textContent =
				"antidisestablishmentarianism antidisestablishmentarianism antidisestablishmentarianism";
			frag.appendChild(p);

			const flow = new FragmentedFlow(frag, { width: 150, height: 60 });

			const containers = [];
			for (const el of flow) {
				containers.push(el);
				if (containers.length > 30) break;
			}

			if (originalLang) document.documentElement.setAttribute("lang", originalLang);
			else document.documentElement.removeAttribute("lang");

			flow.destroy();

			return { pageCount: containers.length };
		});

		expect(result.pageCount).toBeGreaterThan(3);
		expect(result.pageCount).toBeLessThan(10);
	});
});

test.describe("Inline break offset normalization", () => {
	test("hyphenated break points to the first char of the next line (no off-by-one)", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-request.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { measureLines } = await import("/src/measurement/line-box.js");

			const originalLang = document.documentElement.lang;
			document.documentElement.setAttribute("lang", "en");

			// Render a reference paragraph and find where line 2 starts in the
			// source text. The value should match what the layout algorithm
			// produces as `breakToken.textOffset`.
			const container = document.createElement("div");
			container.style.cssText = "position: absolute; left: -9999px; top: 0;";
			document.body.appendChild(container);

			const text = "antidisestablishmentarianism";
			const sharedStyle =
				"width: 150px; font: 24px serif; line-height: 28px; margin: 0; padding: 0; hyphens: auto; -webkit-hyphens: auto;";

			const refP = document.createElement("p");
			refP.style.cssText = sharedStyle;
			refP.lang = "en";
			refP.textContent = text;
			container.appendChild(refP);
			void refP.offsetHeight;

			const refTops = measureLines(refP).tops;
			const refTextNode = refP.firstChild;
			const range = document.createRange();
			let expectedBreakOffset = -1;
			for (let i = 0; i < text.length; i++) {
				range.setStart(refTextNode, i);
				range.setEnd(refTextNode, i + 1);
				const rects = range.getClientRects();
				let maxTop = -Infinity;
				for (const r of rects) if (r.top > maxTop) maxTop = r.top;
				if (maxTop >= refTops[1]) {
					expectedBreakOffset = i;
					break;
				}
			}

			// Fragment an equivalent paragraph at a height that forces a break
			// after line 1 (28px fits exactly one 28px-tall line).
			const layoutP = document.createElement("p");
			layoutP.style.cssText = sharedStyle;
			layoutP.lang = "en";
			layoutP.textContent = text;
			container.appendChild(layoutP);
			void layoutP.offsetHeight;

			const root = new DOMLayoutNode(layoutP);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 150,
					availableBlockSize: 28,
					fragmentainerBlockSize: 28,
					fragmentationType: "page",
				}),
			);
			const breakToken = pages[0].breakToken;

			container.remove();
			if (originalLang) document.documentElement.setAttribute("lang", originalLang);
			else document.documentElement.removeAttribute("lang");

			return {
				expectedBreakOffset,
				breakTokenTextOffset: breakToken?.textOffset,
				isHyphenated: breakToken?.isHyphenated,
				refLineCount: refTops.length,
				page1Text: text.slice(0, breakToken?.textOffset ?? 0),
				expectedPage1Text: text.slice(0, expectedBreakOffset),
			};
		});

		expect(result.refLineCount).toBeGreaterThan(1);
		expect(result.expectedBreakOffset).toBeGreaterThan(0);
		expect(result.breakTokenTextOffset).toBe(result.expectedBreakOffset);
		expect(result.isHyphenated).toBe(true);
		expect(result.page1Text).toBe(result.expectedPage1Text);
	});

	test("trailing collapsible space is flagged and trimmed at render time", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");

			const frag = document.createDocumentFragment();
			const p = document.createElement("p");
			p.style.cssText =
				"width: 200px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;";
			// "test" is 4 chars at ~9.6px each in 16px monospace → ~38px.
			// Width 200px fits several words per line; height 40px gives 2 lines
			// per page, so the break falls at a word boundary.
			p.textContent = Array.from({ length: 12 }, () => "test").join(" ");
			frag.appendChild(p);

			const flow = new FragmentedFlow(frag, { width: 200, height: 40 });

			const pages = [];
			for (const el of flow) {
				pages.push(el);
				if (pages.length >= 2) break;
			}

			const page1 = pages[0];
			const page1Text = (page1.shadowRoot || page1).textContent;

			flow.destroy();

			return {
				pageCount: pages.length,
				page1Text,
				endsWithSpace: /\s$/.test(page1Text),
			};
		});

		expect(result.pageCount).toBeGreaterThanOrEqual(2);
		expect(result.page1Text.length).toBeGreaterThan(0);
		expect(result.endsWithSpace).toBe(false);
	});

	test("white-space policy propagates onto inline items", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectInlineItems, INLINE_TEXT } = await import(
				"/src/measurement/collect-inlines.js"
			);
			const container = document.createElement("div");
			container.style.cssText = "position: absolute; left: -9999px; top: 0;";
			document.body.appendChild(container);

			const p = document.createElement("p");
			p.style.cssText = "white-space: pre; font: 16px monospace;";
			p.textContent = "hello world";
			container.appendChild(p);

			const { items } = collectInlineItems(p.childNodes);
			const textItem = items.find((it) => it.type === INLINE_TEXT);

			container.remove();
			return { whiteSpace: textItem?.whiteSpace };
		});

		expect(result.whiteSpace).toBe("pre");
	});
});
