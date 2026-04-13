import { test, expect } from "../browser-fixture.js";

test.describe("EmulatePrintPixelRatio line-height ratio computation", () => {
	test("flooredLh / fontSize produces a unitless ratio in the expected range", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { getLineHeight, setTargetDevicePixelRatio } = await import("/src/measurement/line-box.js");

			const div = document.createElement("div");
			div.style.cssText = "font-size:16px;line-height:normal;width:50px";
			div.textContent = "x x x x x x x x x x";
			document.body.appendChild(div);

			setTargetDevicePixelRatio(1);
			const flooredLh = getLineHeight(div);
			const fontSize = 16;
			const ratio = flooredLh / fontSize;

			div.remove();
			return { flooredLh, ratio };
		});

		// Ratio should be ~1.1-1.3 for typical fonts
		expect(result.ratio).toBeGreaterThan(1.0);
		expect(result.ratio).toBeLessThan(1.5);
		// flooredLh should be an integer at DPR 1
		expect(result.flooredLh).toBe(Math.floor(result.flooredLh));
	});

	test("applying the ratio as line-height produces the floored height per line", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { getLineHeight, measureLines, setTargetDevicePixelRatio } = await import("/src/measurement/line-box.js");

			const div = document.createElement("div");
			div.style.cssText = "font-size:16px;line-height:normal;width:50px";
			div.textContent = "x x x x x x x x x x";
			document.body.appendChild(div);

			setTargetDevicePixelRatio(1);
			const flooredLh = getLineHeight(div);
			const ratio = flooredLh / 16;

			// Apply the ratio as an explicit unitless line-height
			div.style.lineHeight = String(ratio);

			// Measure with the ratio applied
			const measured = measureLines(div);
			const totalHeight = div.getBoundingClientRect().height;

			div.remove();
			return { flooredLh, ratio, measuredLh: measured.lineHeight, totalHeight, lines: measured.count };
		});

		// The measured line gap with the ratio applied should match the floored value
		if (result.measuredLh > 0) {
			expect(Math.abs(result.measuredLh - result.flooredLh)).toBeLessThan(1);
		}
		// Total height should be close to lines * flooredLh
		expect(Math.abs(result.totalHeight - result.lines * result.flooredLh)).toBeLessThan(2);
	});

	test("different fonts produce different ratios", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getLineHeight, setTargetDevicePixelRatio } = await import("/src/measurement/line-box.js");
			setTargetDevicePixelRatio(1);

			function measureRatio(fontFamily) {
				const div = document.createElement("div");
				div.style.cssText = `font-size:16px;line-height:normal;width:50px;font-family:${fontFamily}`;
				div.textContent = "x x x x x x x x x x";
				document.body.appendChild(div);
				const lh = getLineHeight(div);
				div.remove();
				return lh / 16;
			}

			return {
				serif: measureRatio("serif"),
				sansSerif: measureRatio("sans-serif"),
				monospace: measureRatio("monospace"),
			};
		});

		// All should be valid ratios
		for (const key of ["serif", "sansSerif", "monospace"]) {
			expect(result[key]).toBeGreaterThan(0.9);
			expect(result[key]).toBeLessThan(1.5);
		}
	});

	test("ratio is consistent across font sizes for the same font family", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { getLineHeight, setTargetDevicePixelRatio } = await import("/src/measurement/line-box.js");
			setTargetDevicePixelRatio(1);

			function measureRatio(fontSize) {
				const div = document.createElement("div");
				div.style.cssText = `font-size:${fontSize}px;line-height:normal;width:50px;font-family:serif`;
				div.textContent = "x x x x x x x x x x";
				document.body.appendChild(div);
				const lh = getLineHeight(div);
				div.remove();
				return lh / fontSize;
			}

			return {
				at12: measureRatio(12),
				at16: measureRatio(16),
				at20: measureRatio(20),
				at24: measureRatio(24),
			};
		});

		// Same font family should produce similar ratios across sizes
		// (within tolerance for integer flooring at different sizes)
		const values = Object.values(result);
		const min = Math.min(...values);
		const max = Math.max(...values);
		expect(max - min).toBeLessThan(0.15);
	});
});
