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
