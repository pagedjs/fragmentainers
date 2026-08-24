import { test, expect } from "../browser-fixture.js";

const WORDS = [
	"alpha",
	"bravo",
	"charlie",
	"delta",
	"echo",
	"foxtrot",
	"golf",
	"hotel",
	"india",
	"juliet",
	"kilo",
	"lima",
	"mike",
	"november",
	"oscar",
	"papa",
	"quebec",
	"romeo",
	"sierra",
	"tango",
	"uniform",
	"victor",
	"whiskey",
	"xray",
	"yankee",
	"zulu",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
	"eleven",
	"twelve",
	"thirteen",
	"fourteen",
];

test.describe("Anonymous inline fragmentation", () => {
	test("counts nested and mixed-metric inline runs as visual lines", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { measureLines } = await import("/src/measurement/line-box.js");
			const host = document.createElement("div");
			host.style.cssText =
				"position:absolute;left:-9999px;top:0;width:180px;font:16px/20px monospace";
			host.innerHTML = `
				<p data-case="nested"><em><strong><span>deeply nested inline text wraps across several visual lines without being counted once per ancestor</span></strong></em></p>
				<p data-case="metrics">water H<sub>2</sub>O and E=mc<sup>2</sup> plus <small>smaller inline text</small> followed by enough ordinary words to wrap repeatedly</p>
				<p data-case="mixed-font">small words <span style="font-size:32px">BIG</span> followed by ordinary text that wraps across several visual lines</p>
				<p data-case="image">text before <img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" style="width:40px;height:40px"> text after the image that wraps across several visual lines</p>
				<p data-case="inline-block">text before <span style="display:inline-block;width:30px;height:50px"></span> text after the inline block that wraps across several visual lines</p>
				<p data-case="fractional" style="line-height:17.3px">fractional line height text that wraps across several visual lines without accumulating an extra measured line</p>`;
			document.body.appendChild(host);

			const cases = {};
			for (const element of host.querySelectorAll("p")) {
				element.style.margin = "0";
				const measured = measureLines(element);
				// Text-node ranges are the reference here: unlike a range around the
				// whole paragraph, they do not also return rects for ancestor inline
				// elements. Prefer direct text children, which cover every line in the
				// mixed-metric cases; the fully nested case has one descendant text node.
				let textNodes = [...element.childNodes].filter(
					(node) => node.nodeType === Node.TEXT_NODE,
				);
				if (textNodes.length === 0) {
					const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
					textNodes = [];
					let node;
					while ((node = walker.nextNode())) textNodes.push(node);
				}
				const referenceTops = new Set();
				const range = document.createRange();
				for (const node of textNodes) {
					range.selectNodeContents(node);
					for (const rect of range.getClientRects()) {
						if (rect.width > 0 || rect.height > 0) {
							referenceTops.add(Math.round(rect.top * 4) / 4);
						}
					}
				}
				cases[element.dataset.case] = {
					count: measured.count,
					lineHeight: measured.lineHeight,
					referenceLineCount: referenceTops.size,
					tops: measured.tops,
				};
			}
			host.remove();
			return cases;
		});

		for (const value of Object.values(result)) {
			expect(value.referenceLineCount).toBeGreaterThan(2);
			expect(value.count).toBe(value.referenceLineCount);
			expect(value.lineHeight).toBeGreaterThan(0);
			expect(value.tops).toEqual([...value.tops].sort((a, b) => a - b));
		}
		expect(result.nested.lineHeight).toBeCloseTo(20, 5);
		expect(result.fractional.lineHeight).toBeCloseTo(17.3, 1);
	});

	for (const { name, markup } of [
		{
			name: "fully nested runs",
			markup: `<p><em><strong><span>${WORDS.join(" ")}</span></strong></em></p>`,
		},
		{
			name: "partially nested runs",
			markup: `<p>${WORDS.slice(0, 10).join(" ")} <em>${WORDS.slice(10, 27).join(" ")}</em> ${WORDS.slice(27).join(" ")}</p>`,
		},
	]) {
		test(`preserves every text token while fragmenting ${name}`, async ({ page }) => {
			const result = await page.evaluate(
				async ({ markup }) => {
					const { Fragmenter, PageResolver } = await import("/src/index.js");
					const sheet = new CSSStyleSheet();
					sheet.replaceSync(`
						@page { size: 240px 100px; margin: 10px 20px; }
						p { margin: 0; font: 16px/20px monospace; }
					`);
					const template = document.createElement("template");
					template.innerHTML = markup;
					const flow = new Fragmenter(template.content, {
						resolver: PageResolver.fromStyleSheets([sheet]),
						styles: [sheet],
					});
					const context = flow.flow();
					const pageElements = [...context];
					const pageTokens = pageElements.map((element) =>
						element.textContent.trim().split(/\s+/).filter(Boolean),
					);
					const lineCounts = context.fragments.map((fragment) =>
						fragment.childFragments.reduce(
							(sum, child) =>
								sum + (child.childFragments[0]?.childFragments.length ?? 0),
							0,
						),
					);
					pageElements.forEach((element) => element.remove());
					flow.destroy();
					return { pageTokens, lineCounts };
				},
				{ markup },
			);

			expect(result.pageTokens.length).toBeGreaterThan(2);
			expect(result.pageTokens.every((tokens) => tokens.length > 0)).toBe(true);
			expect(result.pageTokens.flat()).toEqual(WORDS);
			expect(result.lineCounts).toHaveLength(result.pageTokens.length);
			// The 80px page content area holds at most four 20px line boxes. With
			// the default widows/orphans values, no text page should contain only one.
			for (const count of result.lineCounts) {
				expect(count).toBeGreaterThanOrEqual(2);
				expect(count).toBeLessThanOrEqual(4);
			}
		});
	}
});
