import { test, expect } from "../browser-fixture.js";

test.describe("RegionResolver", () => {
	test("resolves dimensions from region elements", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { RegionResolver } = await import("/src/resolvers/region-resolver.js");

			const container = document.createElement("div");
			document.body.appendChild(container);
			container.innerHTML = `
        <div class="region" style="width: 300px; height: 200px;"></div>
        <div class="region" style="width: 400px; height: 150px;"></div>
      `;
			const regions = [...container.querySelectorAll(".region")];
			const resolver = new RegionResolver(regions);

			const c0 = resolver.resolve(0);
			const c1 = resolver.resolve(1);

			const out = {
				c0InlineSize: c0.contentArea.inlineSize,
				c0BlockSize: c0.contentArea.blockSize,
				c0ElementMatch: c0.element === regions[0],
				c1InlineSize: c1.contentArea.inlineSize,
				c1BlockSize: c1.contentArea.blockSize,
				c1ElementMatch: c1.element === regions[1],
			};

			container.remove();
			return out;
		});

		expect(result.c0InlineSize).toBe(300);
		expect(result.c0BlockSize).toBe(200);
		expect(result.c0ElementMatch).toBe(true);
		expect(result.c1InlineSize).toBe(400);
		expect(result.c1BlockSize).toBe(150);
		expect(result.c1ElementMatch).toBe(true);
	});

	test("toConstraintSpace produces region fragmentation type", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { RegionResolver } = await import("/src/resolvers/region-resolver.js");

			const container = document.createElement("div");
			document.body.appendChild(container);
			container.innerHTML = '<div style="width: 300px; height: 200px;"></div>';
			const resolver = new RegionResolver([container.firstElementChild]);

			const cs = resolver.resolve(0).toConstraintSpace();
			const out = {
				fragmentationType: cs.fragmentationType,
				availableInlineSize: cs.availableInlineSize,
				availableBlockSize: cs.availableBlockSize,
			};

			container.remove();
			return out;
		});

		expect(result.fragmentationType).toBe("region");
		expect(result.availableInlineSize).toBe(300);
		expect(result.availableBlockSize).toBe(200);
	});
});

test.describe("FragmentedFlow with regions", () => {
	test("flows content across region elements via iterator", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			const { RegionResolver } = await import("/src/resolvers/region-resolver.js");

			const container = document.createElement("div");
			document.body.appendChild(container);
			container.innerHTML = `
        <div id="content" style="margin:0; padding:0;">
          <div style="height: 300px; margin: 0;"></div>
        </div>
        <div class="region" style="width: 200px; height: 100px;"></div>
        <div class="region" style="width: 200px; height: 100px;"></div>
        <div class="region" style="width: 200px; height: 100px;"></div>
      `;

			const content = container.querySelector("#content");
			const regions = [...container.querySelectorAll(".region")];

			const layout = new FragmentedFlow(content, { resolver: new RegionResolver(regions) });
			let i = 0;
			for (const el of layout) {
				if (i >= regions.length) break;
				regions[i].appendChild(el);
				i++;
			}

			const childCount = regions[0].childNodes.length;
			container.remove();
			return { childCount };
		});

		expect(result.childCount).toBeGreaterThan(0);
	});

	test("stops when regions run out with content remaining", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			const { RegionResolver } = await import("/src/resolvers/region-resolver.js");

			const container = document.createElement("div");
			document.body.appendChild(container);
			container.innerHTML = `
        <div id="content" style="margin:0; padding:0;">
          <div style="height: 500px; margin: 0;"></div>
        </div>
        <div class="region" style="width: 200px; height: 100px;"></div>
      `;

			const content = container.querySelector("#content");
			const regions = [...container.querySelectorAll(".region")];

			const layout = new FragmentedFlow(content, { resolver: new RegionResolver(regions) });
			let lastResult;
			for (let i = 0; i < regions.length; i++) {
				lastResult = layout.next();
			}

			const out = { done: lastResult.done };
			container.remove();
			return out;
		});

		expect(result.done).toBe(false);
	});

	test("content fits in a single region", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			const { RegionResolver } = await import("/src/resolvers/region-resolver.js");

			const container = document.createElement("div");
			document.body.appendChild(container);
			container.innerHTML = `
        <div id="content" style="margin:0; padding:0;">
          <div style="height: 50px; margin: 0;"></div>
        </div>
        <div class="region" style="width: 200px; height: 200px;"></div>
      `;

			const content = container.querySelector("#content");
			const regions = [...container.querySelectorAll(".region")];

			const layout = new FragmentedFlow(content, { resolver: new RegionResolver(regions) });
			const r1 = layout.next();
			const r2 = layout.next();

			const out = {
				r1Done: r1.done,
				r1HasValue: r1.value !== undefined,
				r2Done: r2.done,
			};
			container.remove();
			return out;
		});

		expect(result.r1Done).toBe(false);
		expect(result.r1HasValue).toBe(true);
		expect(result.r2Done).toBe(true);
	});

	test("supports variable-sized regions", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			const { RegionResolver } = await import("/src/resolvers/region-resolver.js");

			const container = document.createElement("div");
			document.body.appendChild(container);
			container.innerHTML = `
        <div id="content" style="margin:0; padding:0;">
          <div style="height: 80px; margin: 0;"></div>
          <div style="height: 80px; margin: 0;"></div>
        </div>
        <div class="region" style="width: 300px; height: 100px;"></div>
        <div class="region" style="width: 400px; height: 100px;"></div>
      `;

			const content = container.querySelector("#content");
			const regions = [...container.querySelectorAll(".region")];

			const layout = new FragmentedFlow(content, { resolver: new RegionResolver(regions) });
			const r1 = layout.next();
			const r2 = layout.next();
			const r3 = layout.next();

			const out = {
				r1Done: r1.done,
				r2Done: r2.done,
				r3Done: r3.done,
			};
			container.remove();
			return out;
		});

		expect(result.r1Done).toBe(false);
		expect(result.r2Done).toBe(false);
		expect(result.r3Done).toBe(true);
	});
});
