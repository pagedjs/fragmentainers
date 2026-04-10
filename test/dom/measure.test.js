import { test, expect } from "../browser-fixture.js";

test.describe("measureElementBlockSize", () => {
	test("returns the height of an element with explicit height", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { measureElementBlockSize } = await import("/src/dom/measure.js");
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
			const { measureElementBlockSize } = await import("/src/dom/measure.js");
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
			const { getLineHeight } = await import("/src/dom/measure.js");
			const div = document.createElement("div");
			div.style.lineHeight = "24px";
			document.body.appendChild(div);
			const lh = getLineHeight(div);
			div.remove();
			return lh;
		});
		expect(result).toBe(24);
	});

	test("returns accurate font-metric-based value when line-height is normal", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getLineHeight } = await import("/src/dom/measure.js");
			const div = document.createElement("div");
			div.style.lineHeight = "normal";
			div.style.fontSize = "20px";
			document.body.appendChild(div);
			const lh = getLineHeight(div);
			div.remove();
			return lh;
		});
		// Canvas fontBoundingBox metrics give the real ratio (not the 1.2 estimate)
		expect(result).toBeGreaterThan(20);
		expect(result).toBeLessThan(40);
	});

	test("returns unitless line-height multiplied by font-size", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getLineHeight } = await import("/src/dom/measure.js");
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
});

test.describe("FontMetrics", () => {
	test("measure returns a ratio in a sane range", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getSharedFontMetrics } = await import("/src/dom/font-metrics.js");
			const fm = getSharedFontMetrics();
			return fm.measure("serif");
		});
		expect(result).toBeGreaterThan(1.0);
		expect(result).toBeLessThan(2.0);
	});

	test("caches results for repeated calls", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getSharedFontMetrics } = await import("/src/dom/font-metrics.js");
			const fm = getSharedFontMetrics();
			const a = fm.measure("monospace", "400", "normal");
			const b = fm.measure("monospace", "400", "normal");
			return { a, b };
		});
		expect(result.a).toBe(result.b);
	});

	test("different fonts can produce different ratios", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getSharedFontMetrics } = await import("/src/dom/font-metrics.js");
			const fm = getSharedFontMetrics();
			return {
				serif: fm.measure("serif"),
				monospace: fm.measure("monospace"),
			};
		});
		// At least confirm both are valid ratios (they may or may not differ
		// depending on the system, but both should be in range)
		expect(result.serif).toBeGreaterThan(1.0);
		expect(result.monospace).toBeGreaterThan(1.0);
	});

	test("getNormalLineHeight matches the element's actual rendered line height", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getSharedFontMetrics } = await import("/src/dom/font-metrics.js");
			const fm = getSharedFontMetrics();

			const div = document.createElement("div");
			div.style.fontSize = "20px";
			div.style.lineHeight = "normal";
			div.style.fontFamily = "serif";
			div.textContent = "Hg";
			document.body.appendChild(div);

			const metricsLh = fm.getNormalLineHeight(div);
			const renderedHeight = div.getBoundingClientRect().height;

			div.remove();
			return { metricsLh, renderedHeight };
		});
		// Canvas metrics should closely match what the browser actually renders
		expect(Math.abs(result.metricsLh - result.renderedHeight)).toBeLessThan(1);
	});

	test("getSharedFontMetrics returns the same instance", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getSharedFontMetrics } = await import("/src/dom/font-metrics.js");
			const a = getSharedFontMetrics();
			const b = getSharedFontMetrics();
			return a === b;
		});
		expect(result).toBe(true);
	});
});

test.describe("createRangeMeasurer", () => {
	test.describe("charTop", () => {
		test("returns different top values for characters on different lines", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { createRangeMeasurer } = await import("/src/dom/measure.js");
				const div = document.createElement("div");
				div.style.fontFamily = "monospace";
				div.style.fontSize = "16px";
				div.style.lineHeight = "20px";
				div.style.width = "50px";
				div.style.wordBreak = "break-all";
				// Enough text to wrap to multiple lines in a 50px-wide container
				div.textContent = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
				document.body.appendChild(div);

				const measurer = createRangeMeasurer();
				const textNode = div.firstChild;

				const topFirst = measurer.charTop(textNode, 0);
				// Pick an offset far enough along to be on a later line
				const topLater = measurer.charTop(textNode, 20);

				div.remove();
				return { topFirst, topLater };
			});
			expect(result.topFirst).not.toBe(Infinity);
			expect(result.topLater).not.toBe(Infinity);
			expect(result.topLater).toBeGreaterThan(result.topFirst);
		});
	});
});

test.describe("createCaretMeasurer", () => {
	test.describe("charTop", () => {
		test("returns different top values for characters on different lines", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { createCaretMeasurer } = await import("/src/dom/measure.js");
				const div = document.createElement("div");
				div.style.fontFamily = "monospace";
				div.style.fontSize = "16px";
				div.style.lineHeight = "20px";
				div.style.width = "50px";
				div.style.wordBreak = "break-all";
				div.textContent = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
				document.body.appendChild(div);

				const measurer = createCaretMeasurer();
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

	test.describe("offsetAtY", () => {
		test("returns the flat offset at the start of a given line", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { createCaretMeasurer } = await import("/src/dom/measure.js");
				const { INLINE_TEXT } = await import("/src/core/constants.js");
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

				const measurer = createCaretMeasurer();
				const rect = div.getBoundingClientRect();

				// Probe at the top of the second line
				const offset = measurer.offsetAtY(div, items, rect.top + 20);
				const textLength = div.textContent.length;

				div.remove();
				return { offset, textLength };
			});
			expect(result.offset).not.toBeNull();
			expect(result.offset).toBeGreaterThan(0);
			expect(result.offset).toBeLessThan(result.textLength);
		});

		test("returns offset consistent with charTop", async ({ page }) => {
			const result = await page.evaluate(async () => {
				const { createCaretMeasurer } = await import("/src/dom/measure.js");
				const { INLINE_TEXT } = await import("/src/core/constants.js");
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

				const measurer = createCaretMeasurer();
				const rect = div.getBoundingClientRect();
				const yCutoff = rect.top + 20; // start of second line

				const caretOffset = measurer.offsetAtY(div, items, yCutoff);

				// The charTop at the returned offset should be >= yCutoff
				const topAtOffset = measurer.charTop(textNode, caretOffset);

				// And the character before it should be on the previous line
				let topBefore = null;
				if (caretOffset > 0) {
					topBefore = measurer.charTop(textNode, caretOffset - 1);
				}

				div.remove();
				return { caretOffset, topAtOffset, yCutoff, topBefore };
			});
			expect(result.caretOffset).not.toBeNull();

			// The charTop at the returned offset should be >= yCutoff
			expect(result.topAtOffset).toBeGreaterThanOrEqual(result.yCutoff - 1); // 1px tolerance

			// And the character before it should be on the previous line
			if (result.topBefore !== null) {
				expect(result.topBefore).toBeLessThan(result.yCutoff);
			}
		});
	});
});

test.describe("parseLength", () => {
	test("parses px values", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseLength } = await import("/src/dom/measure.js");
			return parseLength("42px", 0, 0);
		});
		expect(result).toBe(42);
	});

	test("parses percentage values relative to parentSize", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseLength } = await import("/src/dom/measure.js");
			return parseLength("50%", 200, 0);
		});
		expect(result).toBe(100);
	});

	test("parses em values relative to fontSize", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseLength } = await import("/src/dom/measure.js");
			return parseLength("2em", 0, 16);
		});
		expect(result).toBe(32);
	});

	test("parses rem values using the document root font size", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseLength } = await import("/src/dom/measure.js");
			const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
			return { value: parseLength("2rem", 0, 0), rootFontSize };
		});
		expect(result.rootFontSize).toBeGreaterThan(0);
		expect(result.value).toBe(2 * result.rootFontSize);
	});

	test("returns null for auto", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseLength } = await import("/src/dom/measure.js");
			return parseLength("auto", 0, 0);
		});
		expect(result).toBeNull();
	});

	test("returns null for none", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseLength } = await import("/src/dom/measure.js");
			return parseLength("none", 0, 0);
		});
		expect(result).toBeNull();
	});

	test("returns null for empty string", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseLength } = await import("/src/dom/measure.js");
			return parseLength("", 0, 0);
		});
		expect(result).toBeNull();
	});

	test("returns null for null/undefined input", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { parseLength } = await import("/src/dom/measure.js");
			return {
				nullResult: parseLength(null, 0, 0),
				undefinedResult: parseLength(undefined, 0, 0),
			};
		});
		expect(result.nullResult).toBeNull();
		expect(result.undefinedResult).toBeNull();
	});
});
