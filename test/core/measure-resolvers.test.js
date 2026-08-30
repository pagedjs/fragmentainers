import { test, expect } from "../browser-fixture.js";

test.describe("resolveBreakProperties — grouped at-rules (LAY-7)", () => {
	test("break-before:page inside @media triggers segmentation", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Measurer } = await import("/src/measurement/measure.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("@media all { .brk { break-before: page; } }");
			const frag = document.createDocumentFragment();
			const a = document.createElement("div");
			a.textContent = "A";
			const b = document.createElement("div");
			b.className = "brk";
			b.textContent = "B";
			frag.append(a, b);
			const m = new Measurer(frag, [sheet]);
			m.setup();
			const segmented = m.isSegmented;
			m.release();
			return { segmented };
		});
		expect(result.segmented).toBe(true);
	});

	test("control: inline break-before:page triggers segmentation", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Measurer } = await import("/src/measurement/measure.js");
			const frag = document.createDocumentFragment();
			const a = document.createElement("div");
			const b = document.createElement("div");
			b.style.breakBefore = "page";
			frag.append(a, b);
			const m = new Measurer(frag, []);
			m.setup();
			const segmented = m.isSegmented;
			m.release();
			return { segmented };
		});
		expect(result.segmented).toBe(true);
	});

	test("break-before:page inside a NON-matching @media must NOT segment", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Measurer } = await import("/src/measurement/measure.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("@media (min-width: 999999px) { .brk { break-before: page; } }");
			const frag = document.createDocumentFragment();
			const a = document.createElement("div");
			const b = document.createElement("div");
			b.className = "brk";
			frag.append(a, b);
			const m = new Measurer(frag, [sheet]);
			m.setup();
			const segmented = m.isSegmented;
			m.release();
			return { segmented };
		});
		expect(result.segmented).toBe(false);
	});

	test("@media print rules are honored (print-targeting engine renders on screen)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Measurer } = await import("/src/measurement/measure.js");
			const sheet = new CSSStyleSheet();
			// The element carries a forced break but is display:none in print; the
			// engine produces print output, so it must be hidden → no break → no
			// segmentation. Evaluating @media print against the screen would wrongly
			// show it and segment.
			sheet.replaceSync("@media print { .hide { display: none; break-before: page; } }");
			const frag = document.createDocumentFragment();
			const a = document.createElement("div");
			const b = document.createElement("div");
			b.className = "hide";
			frag.append(a, b);
			const m = new Measurer(frag, [sheet]);
			m.setup();
			const segmented = m.isSegmented;
			m.release();
			return { segmented };
		});
		expect(result.segmented).toBe(false);
	});

	test("break-before:page inside @container must NOT segment (unevaluable off-document)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Measurer } = await import("/src/measurement/measure.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync("@container (min-width: 100px) { .brk { break-before: page; } }");
			const frag = document.createDocumentFragment();
			const a = document.createElement("div");
			const b = document.createElement("div");
			b.className = "brk";
			frag.append(a, b);
			const m = new Measurer(frag, [sheet]);
			m.setup();
			const segmented = m.isSegmented;
			m.release();
			return { segmented };
		});
		// A container query has no resolvable container at measure time; treating
		// it as active would inject an authoritative break it may never produce.
		expect(result.segmented).toBe(false);
	});
});

test.describe("measure-time cascade order (LAY-8)", () => {
	test("inline break-before:avoid beats a sheet break-before:page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Measurer } = await import("/src/measurement/measure.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(".brk { break-before: page; }");
			const frag = document.createDocumentFragment();
			const a = document.createElement("div");
			const b = document.createElement("div");
			b.className = "brk";
			b.style.breakBefore = "avoid"; // inline must win over the sheet rule
			frag.append(a, b);
			const m = new Measurer(frag, [sheet]);
			m.setup();
			const segmented = m.isSegmented;
			m.release();
			return { segmented };
		});
		expect(result.segmented).toBe(false);
	});

	test("end-to-end: inline break:avoid yields a single fragmentainer", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(".brk { break-before: page; }");
			const template = document.createElement("template");
			template.innerHTML =
				"<div style=\"height:50px;margin:0;padding:0\"></div>" +
				"<div class=\"brk\" style=\"height:50px;margin:0;padding:0;break-before:avoid\"></div>";
			const flow = new Fragmenter(template.content, { width: 400, height: 800, styles: [sheet] });
			const ctx = flow.flow();
			const count = ctx.fragmentainerCount;
			flow.destroy();
			return { count };
		});
		expect(result.count).toBe(1);
	});

	test("higher-specificity sheet rule wins over a lower one regardless of source order", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Measurer } = await import("/src/measurement/measure.js");
			const sheet = new CSSStyleSheet();
			// Source order would make `div` (later) win in the buggy code; specificity
			// must make `#b.brk` (page) win regardless of order.
			sheet.replaceSync("#b.brk { break-before: page; } div { break-before: avoid; }");
			const frag = document.createDocumentFragment();
			const a = document.createElement("div");
			const b = document.createElement("div");
			b.id = "b";
			b.className = "brk";
			frag.append(a, b);
			const m = new Measurer(frag, [sheet]);
			m.setup();
			const segmented = m.isSegmented;
			m.release();
			return { segmented };
		});
		// #b.brk (1,1,0) beats div (0,0,1) → page wins → segmented
		expect(result.segmented).toBe(true);
	});

	test("a comma inside :is() is not split into a bogus selector (depth-aware split)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Measurer } = await import("/src/measurement/measure.js");
			const sheet = new CSSStyleSheet();
			// A naive split on "," would produce ".other" and ".brk)" — both invalid —
			// and the forced break would be lost.
			sheet.replaceSync(":is(.other, .brk) { break-before: page; }");
			const frag = document.createDocumentFragment();
			const a = document.createElement("div");
			const b = document.createElement("div");
			b.className = "brk";
			frag.append(a, b);
			const m = new Measurer(frag, [sheet]);
			m.setup();
			const segmented = m.isSegmented;
			m.release();
			return { segmented };
		});
		expect(result.segmented).toBe(true);
	});
});

test.describe("non-box elements and named-page segmentation", () => {
	/**
	 * Build `<div class="a">`, the given middle element, `<div class="a">`, and
	 * report whether the two same-named pages ended up in separate segments.
	 * `extraCss` and `prepare` cover cases the tag alone cannot express.
	 */
	async function segmentsAround(page, middleTag, { extraCss = "", markHidden = false } = {}) {
		return page.evaluate(async ({ tag, css, hide }) => {
			const { Measurer } = await import("/src/measurement/measure.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(`.a { page: chapter; }${css}`);
			const frag = document.createDocumentFragment();
			const a = document.createElement("div");
			a.className = "a";
			const middle = document.createElement(tag);
			if (hide) middle.hidden = true;
			middle.className = `${middle.className} mid`.trim();
			const b = document.createElement("div");
			b.className = "a";
			frag.append(a, middle, b);
			const m = new Measurer(frag, [sheet]);
			m.setup();
			const segmented = m.isSegmented;
			m.release();
			return segmented;
		}, { tag: middleTag, css: extraCss, hide: markHidden });
	}

	// Elements the engine skips by tag, before any style is resolved.
	for (const tag of ["style", "script", "template"]) {
		test(`a <${tag}> between same-named pages does not split them`, async ({ page }) => {
			expect(await segmentsAround(page, tag)).toBe(false);
		});
	}

	// Elements hidden by the UA sheet, which is unreachable off the document.
	for (const tag of ["link", "meta", "title", "base", "noscript", "col", "colgroup"]) {
		test(`a UA-hidden <${tag}> between same-named pages does not split them`, async ({ page }) => {
			expect(await segmentsAround(page, tag)).toBe(false);
		});
	}

	test("a [hidden] element between same-named pages does not split them", async ({ page }) => {
		expect(await segmentsAround(page, "div", { markHidden: true })).toBe(false);
	});

	test("a display: table-column element between them does not split them", async ({ page }) => {
		const css = " .mid { display: table-column; }";
		expect(await segmentsAround(page, "div", { extraCss: css })).toBe(false);
	});

	test("an author display beats the UA origin and splits them again", async ({ page }) => {
		const css = " .mid { display: block; }";
		expect(await segmentsAround(page, "link", { extraCss: css })).toBe(true);
	});

	test("control: a box-generating element between them does split them", async ({ page }) => {
		expect(await segmentsAround(page, "div")).toBe(true);
	});
});
