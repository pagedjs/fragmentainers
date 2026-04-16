import { test, expect } from "../browser-fixture.js";

test.describe("measureElementBlockSize", () => {
	test("returns the height of an element with explicit height", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { measureElementBlockSize } = await import("/src/measurement/measure.js");
			const div = document.createElement("div");
			div.style.height = "80px";
			document.body.appendChild(div);
			const height = measureElementBlockSize(div);
			div.remove();
			return height;
		});
		expect(result).toBe(80);
	});

	test("includes padding and border in the measurement", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { measureElementBlockSize } = await import("/src/measurement/measure.js");
			const div = document.createElement("div");
			div.style.height = "50px";
			div.style.paddingTop = "10px";
			div.style.paddingBottom = "10px";
			div.style.borderTop = "5px solid black";
			div.style.borderBottom = "5px solid black";
			div.style.boxSizing = "content-box";
			document.body.appendChild(div);
			// content-box: total = height + padding + border = 50 + 20 + 10 = 80
			const height = measureElementBlockSize(div);
			div.remove();
			return height;
		});
		expect(result).toBe(80);
	});
});

test.describe("getLineHeight", () => {
	test("returns an explicit pixel line-height", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getLineHeight } = await import("/src/measurement/line-box.js");
			const div = document.createElement("div");
			div.style.lineHeight = "24px";
			document.body.appendChild(div);
			const lh = getLineHeight(div);
			div.remove();
			return lh;
		});
		expect(result).toBe(24);
	});

	test("returns accurate rendered value when line-height is normal", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getLineHeight } = await import("/src/measurement/line-box.js");
			const div = document.createElement("div");
			div.style.lineHeight = "normal";
			div.style.fontSize = "20px";
			div.textContent = "Hello world";
			document.body.appendChild(div);
			const lh = getLineHeight(div);
			div.remove();
			return lh;
		});
		// Measured from actual rendered line box via getClientRects
		expect(result).toBeGreaterThan(20);
		expect(result).toBeLessThan(40);
	});

	test("returns unitless line-height multiplied by font-size", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getLineHeight } = await import("/src/measurement/line-box.js");
			const div = document.createElement("div");
			div.style.lineHeight = "1.5";
			div.style.fontSize = "20px";
			document.body.appendChild(div);
			const lh = getLineHeight(div);
			div.remove();
			return lh;
		});
		expect(result).toBe(30);
	});

	test("floors line-height: normal at DPR 1", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getLineHeight, setTargetDevicePixelRatio } = await import("/src/measurement/line-box.js");
			setTargetDevicePixelRatio(1);
			const div = document.createElement("div");
			div.style.cssText = "font-size:20px;line-height:normal;width:50px";
			div.textContent = "x x x x x x x x x x";
			document.body.appendChild(div);
			const lh = getLineHeight(div);
			div.remove();
			return lh;
		});
		// Floored to integer at DPR 1
		expect(result).toBe(Math.floor(result));
		expect(result).toBeGreaterThan(20);
	});

	test("returns sub-pixel line-height: normal at DPR 2", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getLineHeight, setTargetDevicePixelRatio } = await import("/src/measurement/line-box.js");
			setTargetDevicePixelRatio(2);
			const div = document.createElement("div");
			div.style.cssText = "font-size:20px;line-height:normal;width:50px";
			div.textContent = "x x x x x x x x x x";
			document.body.appendChild(div);
			const lh = getLineHeight(div);
			div.remove();
			setTargetDevicePixelRatio(1); // restore
			return lh;
		});
		// Raw sub-pixel value at DPR 2 — not necessarily integer
		expect(result).toBeGreaterThan(20);
	});

	test("single-line element uses first line box height", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getLineHeight, setTargetDevicePixelRatio } = await import("/src/measurement/line-box.js");
			setTargetDevicePixelRatio(1);
			const div = document.createElement("div");
			div.style.cssText = "font-size:16px;line-height:normal";
			div.textContent = "Hello";
			document.body.appendChild(div);
			const lh = getLineHeight(div);
			div.remove();
			return lh;
		});
		// Should still return a valid floored value even with one line
		expect(result).toBe(Math.floor(result));
		expect(result).toBeGreaterThanOrEqual(16);
	});
});

test.describe("measureLines", () => {
	test("counts lines and measures line height for multi-line element", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { measureLines } = await import("/src/measurement/line-box.js");
			const div = document.createElement("div");
			// Use line-height: normal so the gap between getClientRects tops
			// equals the font's natural line height (what measureLines reports).
			div.style.cssText = "font-size:16px;line-height:normal;width:50px";
			div.textContent = "x x x x x x x x x x";
			document.body.appendChild(div);
			const m = measureLines(div);
			div.remove();
			return m;
		});
		expect(result.count).toBeGreaterThan(1);
		expect(result.lineHeight).toBeGreaterThan(16);
		expect(result.lineHeight).toBeLessThan(30);
		expect(result.firstLineHeight).toBeGreaterThan(0);
	});

	test("returns zero lineHeight for single-line element", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { measureLines } = await import("/src/measurement/line-box.js");
			const div = document.createElement("div");
			div.style.cssText = "font-size:16px;line-height:normal";
			div.textContent = "Hello";
			document.body.appendChild(div);
			const m = measureLines(div);
			div.remove();
			return m;
		});
		expect(result.count).toBe(1);
		expect(result.lineHeight).toBe(0);
		expect(result.firstLineHeight).toBeGreaterThan(0);
	});

	test("returns zero count for empty element", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { measureLines } = await import("/src/measurement/line-box.js");
			const div = document.createElement("div");
			document.body.appendChild(div);
			const m = measureLines(div);
			div.remove();
			return m;
		});
		expect(result.count).toBe(0);
		expect(result.lineHeight).toBe(0);
		expect(result.firstLineHeight).toBe(0);
	});

	test("line height matches getLineHeight for multi-line normal element", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { measureLines, getLineHeight, setTargetDevicePixelRatio } = await import("/src/measurement/line-box.js");
			setTargetDevicePixelRatio(2); // raw values, no floor
			const div = document.createElement("div");
			div.style.cssText = "font-size:16px;line-height:normal;width:50px";
			div.textContent = "x x x x x x x x x x";
			document.body.appendChild(div);
			const measured = measureLines(div);
			const lh = getLineHeight(div);
			div.remove();
			setTargetDevicePixelRatio(1);
			return { measuredLh: measured.lineHeight, getLh: lh };
		});
		// Both should return the same raw rendered line height
		expect(result.measuredLh).toBeCloseTo(result.getLh, 1);
	});
});

test.describe("setTargetDevicePixelRatio / getTargetDevicePixelRatio", () => {
	test("defaults to devicePixelRatio", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getTargetDevicePixelRatio } = await import("/src/measurement/line-box.js");
			return { targetDpr: getTargetDevicePixelRatio(), deviceDpr: devicePixelRatio };
		});
		expect(result.targetDpr).toBe(result.deviceDpr);
	});

	test("setTargetDevicePixelRatio changes the value and affects getLineHeight", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getLineHeight, setTargetDevicePixelRatio } = await import("/src/measurement/line-box.js");
			const div = document.createElement("div");
			div.style.cssText = "font-size:16px;line-height:normal;width:50px";
			div.textContent = "x x x x x x x x x x";
			document.body.appendChild(div);

			setTargetDevicePixelRatio(1);
			const atDpr1 = getLineHeight(div);

			setTargetDevicePixelRatio(2);
			const atDpr2 = getLineHeight(div);

			div.remove();
			setTargetDevicePixelRatio(1); // restore
			return { atDpr1, atDpr2 };
		});
		// DPR 1 should be floored integer, DPR 2 raw
		expect(result.atDpr1).toBe(Math.floor(result.atDpr1));
		// Raw value should be >= floored value
		expect(result.atDpr2).toBeGreaterThanOrEqual(result.atDpr1);
	});
});

test.describe("createMeasurer", () => {
	test.describe("charTop", () => {
		test("returns different top values for characters on different lines", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { createMeasurer } = await import("/src/measurement/line-box.js");
				const div = document.createElement("div");
				div.style.fontFamily = "monospace";
				div.style.fontSize = "16px";
				div.style.lineHeight = "20px";
				div.style.width = "50px";
				div.style.wordBreak = "break-all";
				div.textContent = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
				document.body.appendChild(div);

				const measurer = createMeasurer();
				const textNode = div.firstChild;

				const topFirst = measurer.charTop(textNode, 0);
				const topLater = measurer.charTop(textNode, 20);

				div.remove();
				return { topFirst, topLater };
			});
			expect(result.topFirst).not.toBe(Infinity);
			expect(result.topLater).not.toBe(Infinity);
			expect(result.topLater).toBeGreaterThan(result.topFirst);
		});
	});

	test.describe("offsetAtLine", () => {
		test("returns the flat offset at the start of a given line", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { createMeasurer, measureLines } = await import("/src/measurement/line-box.js");
				const { INLINE_TEXT } = await import("/src/measurement/collect-inlines.js");
				const div = document.createElement("div");
				div.style.fontFamily = "monospace";
				div.style.fontSize = "16px";
				div.style.lineHeight = "20px";
				div.style.width = "50px";
				div.style.wordBreak = "break-all";
				div.textContent = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
				document.body.appendChild(div);

				const textNode = div.firstChild;
				const items = [
					{
						type: INLINE_TEXT,
						startOffset: 0,
						endOffset: div.textContent.length,
						domNode: textNode,
					},
				];

				const measurer = createMeasurer();
				const { tops } = measureLines(div);

				const offset = measurer.offsetAtLine(items, tops, 1);
				const textLength = div.textContent.length;

				div.remove();
				return { offset, textLength, lineCount: tops.length };
			});
			expect(result.lineCount).toBeGreaterThan(1);
			expect(result.offset).not.toBeNull();
			expect(result.offset).toBeGreaterThan(0);
			expect(result.offset).toBeLessThan(result.textLength);
		});

		test("offset lands on the target line and the predecessor is on the previous line", async ({
			page,
		}) => {
			const result = await page.evaluate(async () => {
				const { createMeasurer, measureLines } = await import("/src/measurement/line-box.js");
				const { INLINE_TEXT } = await import("/src/measurement/collect-inlines.js");
				const div = document.createElement("div");
				div.style.fontFamily = "monospace";
				div.style.fontSize = "16px";
				div.style.lineHeight = "20px";
				div.style.width = "80px";
				div.style.wordBreak = "break-all";
				div.textContent = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefgh";
				document.body.appendChild(div);

				const textNode = div.firstChild;
				const items = [
					{
						type: INLINE_TEXT,
						startOffset: 0,
						endOffset: div.textContent.length,
						domNode: textNode,
					},
				];

				const measurer = createMeasurer();
				const { tops } = measureLines(div);

				const caretOffset = measurer.offsetAtLine(items, tops, 1);
				const topAtOffset = measurer.charTop(textNode, caretOffset);
				const topBefore = caretOffset > 0 ? measurer.charTop(textNode, caretOffset - 1) : null;

				div.remove();
				return { caretOffset, topAtOffset, topBefore, secondLineTop: tops[1] };
			});
			expect(result.caretOffset).not.toBeNull();
			expect(result.topAtOffset).toBe(result.secondLineTop);
			if (result.topBefore !== null) {
				expect(result.topBefore).toBeLessThan(result.secondLineTop);
			}
		});
	});
});

