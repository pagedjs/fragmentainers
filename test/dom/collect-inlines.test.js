import { test, expect } from "../browser-fixture.js";

test.describe("collectInlineItems", () => {
	test("collects plain text as a single INLINE_TEXT item", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectInlineItems } = await import("/src/measurement/collect-inlines.js");
			const { INLINE_TEXT } = await import("/src/measurement/collect-inlines.js");
			const container = document.createElement("div");
			document.body.appendChild(container);
			container.innerHTML = "<p>Hello world</p>";
			const p = container.querySelector("p");
			const { items, textContent } = collectInlineItems(p.childNodes);
			container.remove();
			return {
				length: items.length,
				type: items[0].type,
				startOffset: items[0].startOffset,
				endOffset: items[0].endOffset,
				textContent,
				INLINE_TEXT,
			};
		});

		expect(result.length).toBe(1);
		expect(result.type).toBe(result.INLINE_TEXT);
		expect(result.startOffset).toBe(0);
		expect(result.endOffset).toBe(11);
		expect(result.textContent).toBe("Hello world");
	});

	test("collects mixed inline elements with open/close tags", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectInlineItems } = await import("/src/measurement/collect-inlines.js");
			const { INLINE_TEXT, INLINE_OPEN_TAG, INLINE_CLOSE_TAG } =
				await import("/src/measurement/collect-inlines.js");
			const container = document.createElement("div");
			document.body.appendChild(container);
			container.innerHTML = "<p>Hello <em>world</em></p>";
			const p = container.querySelector("p");
			const { items } = collectInlineItems(p.childNodes);
			container.remove();
			return {
				length: items.length,
				types: items.map((i) => i.type),
				tag1: items[1].element.tagName.toLowerCase(),
				tag3: items[3].element.tagName.toLowerCase(),
				INLINE_TEXT,
				INLINE_OPEN_TAG,
				INLINE_CLOSE_TAG,
			};
		});

		expect(result.length).toBe(4);
		expect(result.types[0]).toBe(result.INLINE_TEXT);
		expect(result.types[1]).toBe(result.INLINE_OPEN_TAG);
		expect(result.tag1).toBe("em");
		expect(result.types[2]).toBe(result.INLINE_TEXT);
		expect(result.types[3]).toBe(result.INLINE_CLOSE_TAG);
		expect(result.tag3).toBe("em");
	});

	test("collects <br> as INLINE_CONTROL", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectInlineItems } = await import("/src/measurement/collect-inlines.js");
			const { INLINE_TEXT, INLINE_CONTROL } = await import("/src/measurement/collect-inlines.js");
			const container = document.createElement("div");
			document.body.appendChild(container);
			container.innerHTML = "<p>Line one<br>Line two</p>";
			const p = container.querySelector("p");
			const { items, textContent } = collectInlineItems(p.childNodes);
			container.remove();
			return {
				length: items.length,
				types: items.map((i) => i.type),
				brTag: items[1].domNode.tagName.toLowerCase(),
				textContent,
				INLINE_TEXT,
				INLINE_CONTROL,
			};
		});

		expect(result.length).toBe(3);
		expect(result.types[0]).toBe(result.INLINE_TEXT);
		expect(result.types[1]).toBe(result.INLINE_CONTROL);
		expect(result.brTag).toBe("br");
		expect(result.types[2]).toBe(result.INLINE_TEXT);
		expect(result.textContent).toBe("Line one\nLine two");
	});

	test("skips display:none elements", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectInlineItems } = await import("/src/measurement/collect-inlines.js");
			const { INLINE_TEXT } = await import("/src/measurement/collect-inlines.js");
			const container = document.createElement("div");
			document.body.appendChild(container);
			container.innerHTML = '<p>visible<span style="display:none">hidden</span></p>';
			const p = container.querySelector("p");
			const { items, textContent } = collectInlineItems(p.childNodes);
			container.remove();
			return {
				length: items.length,
				type: items[0].type,
				textContent,
				INLINE_TEXT,
			};
		});

		expect(result.length).toBe(1);
		expect(result.type).toBe(result.INLINE_TEXT);
		expect(result.textContent).toBe("visible");
	});

	test("collects inline-block as INLINE_ATOMIC", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectInlineItems } = await import("/src/measurement/collect-inlines.js");
			const { INLINE_TEXT, INLINE_ATOMIC } = await import("/src/measurement/collect-inlines.js");
			const container = document.createElement("div");
			document.body.appendChild(container);
			container.innerHTML = '<p>text<span style="display:inline-block">box</span></p>';
			const p = container.querySelector("p");
			const { items } = collectInlineItems(p.childNodes);
			container.remove();
			return {
				length: items.length,
				types: items.map((i) => i.type),
				tag: items[1].element.tagName.toLowerCase(),
				INLINE_TEXT,
				INLINE_ATOMIC,
			};
		});

		expect(result.length).toBe(2);
		expect(result.types[0]).toBe(result.INLINE_TEXT);
		expect(result.types[1]).toBe(result.INLINE_ATOMIC);
		expect(result.tag).toBe("span");
	});

	test("includes whitespace-only text nodes", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectInlineItems } = await import("/src/measurement/collect-inlines.js");
			const { INLINE_TEXT } = await import("/src/measurement/collect-inlines.js");
			const container = document.createElement("div");
			document.body.appendChild(container);
			container.innerHTML = "<p><em>a</em> <em>b</em></p>";
			const p = container.querySelector("p");
			const { items } = collectInlineItems(p.childNodes);
			container.remove();
			const textItems = items.filter((i) => i.type === INLINE_TEXT);
			return {
				textItemsLength: textItems.length,
				whitespaceSize: textItems[1].endOffset - textItems[1].startOffset,
			};
		});

		// OPEN + TEXT("a") + CLOSE + TEXT(" ") + OPEN + TEXT("b") + CLOSE
		expect(result.textItemsLength).toBe(3);
		expect(result.whitespaceSize).toBe(1);
	});

	test("collects items from an array of nodes", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectInlineItems } = await import("/src/measurement/collect-inlines.js");
			const { INLINE_TEXT, INLINE_OPEN_TAG, INLINE_CLOSE_TAG } =
				await import("/src/measurement/collect-inlines.js");
			const container = document.createElement("div");
			document.body.appendChild(container);
			container.innerHTML = "hello<span>world</span>!";
			const nodes = Array.from(container.childNodes);
			const { items, textContent } = collectInlineItems(nodes);
			container.remove();
			return {
				types: items.map((i) => i.type),
				textContent,
				INLINE_TEXT,
				INLINE_OPEN_TAG,
				INLINE_CLOSE_TAG,
			};
		});

		expect(result.types[0]).toBe(result.INLINE_TEXT);
		expect(result.types[1]).toBe(result.INLINE_OPEN_TAG);
		expect(result.types[2]).toBe(result.INLINE_TEXT);
		expect(result.types[3]).toBe(result.INLINE_CLOSE_TAG);
		expect(result.types[4]).toBe(result.INLINE_TEXT);
		expect(result.textContent).toBe("helloworld!");
	});
});
