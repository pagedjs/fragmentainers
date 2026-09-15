import { test, expect } from "../browser-fixture.js";

test("inline ranges are reused across fragments but refreshed for each location request", async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { locate } = await import("/src/fragmentation/locate.js");
		const { INLINE_TEXT } = await import("/src/measurement/collect-inlines.js");
		const { BREAK_TOKEN_INLINE } = await import("/src/fragmentation/tokens.js");
		const target = document.createElement("span");
		target.textContent = "abcdefgh";
		const data = { textContent: "abcdefgh", items: [{ type: INLINE_TEXT, domNode: target.firstChild, startOffset: 0, endOffset: 8 }] };
		const fragments = Array.from({ length: 8 }, (_, index) => ({
			node: { isInlineNode: true, inlineItemsData: data },
			breakToken: index < 7 ? { type: BREAK_TOKEN_INLINE, textOffset: index + 1 } : null,
		}));
		let calls = 0;
		const contains = target.contains.bind(target);
		target.contains = (node) => { calls++; return contains(node); };
		const first = locate(fragments, target).map(({ index }) => index);
		const firstCalls = calls;
		target.replaceChildren();
		calls = 0;
		const second = locate(fragments, target);
		return { first, firstCalls, second, secondCalls: calls };
	});
	expect(result).toEqual({ first: [0, 1, 2, 3, 4, 5, 6, 7], firstCalls: 1, second: [], secondCalls: 1 });
});
