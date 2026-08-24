import { test, expect } from "../browser-fixture.js";

// HND-3: a forced break splits measurement into segments. Advancing to the next
// segment re-stamps handler data-refs, so the composite handler sheet must be
// reinstalled — replacing the prior composite rule, not appending a stale
// duplicate. This guards the reinstall path against re-growing the sheet.
test.describe("Segment sheet reinstall (HND-3)", () => {
	test("replays a sibling match captured across a forced-break segment boundary", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(`
				h2, p { height: 40px; margin: 0; color: rgb(0, 0, 0); }
				h2 + p { color: rgb(255, 0, 0); }
			`);

			const source = document.createDocumentFragment();
			const heading = document.createElement("h2");
			heading.textContent = "Heading";
			const following = document.createElement("p");
			following.textContent = "Following";
			following.style.breakBefore = "page";
			source.append(heading, following);

			const layout = new Fragmenter(source, { width: 300, height: 200, styles: [sheet] });
			const flow = layout.flow();
			for (const fragmentainer of flow) document.body.appendChild(fragmentainer);
			const pageWithFollowing = flow.find((el) => el.querySelector("p"));
			const color = getComputedStyle(pageWithFollowing.querySelector("p")).color;
			for (const fragmentainer of flow) fragmentainer.remove();
			layout.destroy();
			return { pageCount: flow.length, color };
		});

		expect(result.pageCount).toBe(2);
		expect(result.color).toBe("rgb(255, 0, 0)");
	});

	test("re-installs the composite sheet without duplicating it across segments", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");

			// Forced-break elements must be direct children of the content so the
			// measurer splits them into segments. The break on the second paragraph
			// makes the flow advance to a second segment and reinstall the sheet.
			const frag = document.createDocumentFragment();
			const p1 = document.createElement("p");
			p1.textContent = "first";
			const p2 = document.createElement("p");
			p2.textContent = "second";
			p2.style.breakBefore = "page";
			frag.append(p1, p2);

			const flow = new Fragmenter(frag, { width: 400, height: 600 });
			const pages = [];
			for (const el of flow) {
				pages.push(el);
				if (pages.length >= 4) break;
			}

			// Count the composite @scope rule in each adopted sheet — a correct
			// reinstall replaces it, so no sheet should hold more than one.
			let maxScopePerSheet = 0;
			let sheetsWithScope = 0;
			for (const sheet of document.adoptedStyleSheets) {
				let count = 0;
				for (const rule of sheet.cssRules) {
					if (rule.cssText.startsWith("@scope (fragment-container)")) count++;
				}
				if (count > 0) sheetsWithScope++;
				maxScopePerSheet = Math.max(maxScopePerSheet, count);
			}

			const out = { pageCount: pages.length, maxScopePerSheet, sheetsWithScope };
			flow.destroy();
			return out;
		});

		// The forced break produced a second segment/page.
		expect(result.pageCount).toBeGreaterThanOrEqual(2);
		// The handler sheet was installed and reinstalled without duplication.
		expect(result.sheetsWithScope).toBeGreaterThanOrEqual(1);
		expect(result.maxScopePerSheet).toBe(1);
	});
});
