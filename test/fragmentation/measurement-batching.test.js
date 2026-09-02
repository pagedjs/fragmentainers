import { test, expect } from "../browser-fixture.js";

// Measurement batches its DOM writes ahead of layout's geometry reads: each
// segment arrangement (node moves, pseudo materialization, ref stamps) is
// followed by one reflow, and the composite sheet, whose mutation forces a
// document layout, is installed once at composition rather than on every
// segment during layout. Chromium's own counters make the batching observable.
//
// `fn` runs in the page and must end with a geometry read, so the layout its
// last write made pending is counted here and not by a later frame.
async function countDuring(page, fn, args) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Performance.enable");
	const metrics = async () => {
		const { metrics: list } = await cdp.send("Performance.getMetrics");
		return Object.fromEntries(list.map((m) => [m.name, m.value]));
	};
	await page.evaluate(() => void document.body.offsetHeight);
	const before = await metrics();
	const result = await page.evaluate(fn, args);
	const after = await metrics();
	await cdp.detach();
	await page.evaluate(() => window.flow?.destroy());
	return {
		result,
		layouts: after.LayoutCount - before.LayoutCount,
		recalcs: after.RecalcStyleCount - before.RecalcStyleCount,
	};
}

test.describe("measurement write batching", () => {
	test("a segment crossing costs one layout and a handful of style recalcs", async ({ page }) => {
		const segments = 4;
		const { layouts, recalcs, result } = await countDuring(
			page,
			async ({ segments, blocks }) => {
				const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
				// Structural pseudos and generated content on every segment so
				// the style resolver stamps refs and pseudos materialize each time.
				const sheet = new CSSStyleSheet();
				sheet.replaceSync(`
					div { height: 100px; margin: 0; }
					div:nth-child(2n) { color: rgb(10, 10, 10); }
					div::before { content: "\\00B6 "; }
					h2 { height: 50px; margin: 0; break-before: page; }
				`);
				const frag = document.createDocumentFragment();
				for (let s = 0; s < segments; s++) {
					const h = document.createElement("h2");
					h.textContent = `Section ${s}`;
					frag.appendChild(h);
					for (let i = 0; i < blocks; i++) {
						const d = document.createElement("div");
						d.textContent = "block";
						frag.appendChild(d);
					}
				}
				window.flow = new Fragmenter(frag, { width: 300, height: 260, styles: [sheet] });
				const pages = window.flow.flow().length;
				void document.body.offsetHeight;
				return { pages };
			},
			{ segments, blocks: 5 },
		);

		expect(result.pages).toBeGreaterThan(segments);
		// One layout for the initial arrangement, one per crossing into a later
		// segment, and one for installing the composite sheet at composition.
		// The width is known at setup, so none is spent on it.
		expect(layouts).toBeLessThanOrEqual(segments + 1);
		// Materialization reads once before and once after its inserts, and
		// the arrangement's reflow recalcs once more, per segment.
		expect(recalcs).toBeLessThanOrEqual(4 * segments + 2);
	});

	test("fragmentainers within one segment force no layout", async ({ page }) => {
		const { layouts, result } = await countDuring(page, async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync('div { height: 100px; margin: 0; } div::before { content: "x"; }');
			const frag = document.createDocumentFragment();
			for (let i = 0; i < 12; i++) {
				const d = document.createElement("div");
				d.textContent = "block";
				frag.appendChild(d);
			}
			window.flow = new Fragmenter(frag, { width: 300, height: 260, styles: [sheet] });
			let pages = 0;
			while (!window.flow.next().done) pages++;
			void document.body.offsetHeight;
			return { pages };
		});

		expect(result.pages).toBeGreaterThan(1);
		// The setup reflow and the composite install; every fragmentainer
		// between them only reads.
		expect(layouts).toBeLessThanOrEqual(2);
	});

	test("a resolver flow spends no layout on the width", async ({ page }) => {
		const { layouts, result } = await countDuring(page, async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(`
				@page { size: 300px 260px; margin: 0; }
				div { height: 100px; margin: 0; } div::before { content: "x"; }
			`);
			const frag = document.createDocumentFragment();
			for (let i = 0; i < 12; i++) {
				const d = document.createElement("div");
				d.textContent = "block";
				frag.appendChild(d);
			}
			window.flow = new Fragmenter(frag, { styles: [sheet] });
			let pages = 0;
			while (!window.flow.next().done) pages++;
			void document.body.offsetHeight;
			return { pages };
		});

		expect(result.pages).toBeGreaterThan(1);
		// Setup is seeded with the first page's width, so its reflow already
		// lays out at the real size and the first fragmentainer's width write
		// is a no-op: the same two layouts as a fixed-width flow.
		expect(layouts).toBeLessThanOrEqual(2);
	});

	test("a segmented resolver flow spends no layout on the width", async ({ page }) => {
		const segments = 3;
		const { layouts, result } = await countDuring(
			page,
			async ({ segments, blocks }) => {
				const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
				const sheet = new CSSStyleSheet();
				sheet.replaceSync(`
					@page { size: 300px 260px; margin: 0; }
					div { height: 100px; margin: 0; } div::before { content: "x"; }
					h2 { height: 50px; margin: 0; break-before: page; }
				`);
				const frag = document.createDocumentFragment();
				for (let s = 0; s < segments; s++) {
					const h = document.createElement("h2");
					h.textContent = `Section ${s}`;
					frag.appendChild(h);
					for (let i = 0; i < blocks; i++) {
						const d = document.createElement("div");
						d.textContent = "block";
						frag.appendChild(d);
					}
				}
				window.flow = new Fragmenter(frag, { styles: [sheet] });
				const pages = window.flow.flow().length;
				void document.body.offsetHeight;
				return { pages };
			},
			{ segments, blocks: 4 },
		);

		expect(result.pages).toBeGreaterThan(segments);
		expect(layouts).toBeLessThanOrEqual(segments + 1);
	});
});
