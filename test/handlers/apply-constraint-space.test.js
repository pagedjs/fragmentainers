import { test, expect } from "../browser-fixture.js";

// Records hook calls in order: the constraint space must reach handlers
// before the setup reflow and before each fragmentainer's layout.
test.describe("applyConstraintSpace hook", () => {
	test("fires with the seeded width before the setup reflow and again per fragmentainer", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { LayoutHandler } = await import("/src/handlers/handler.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");

			const calls = [];
			class Probe extends LayoutHandler {
				applyConstraintSpace(cs) {
					calls.push(["apply", cs.availableInlineSize]);
				}
				beforeMeasurement() {
					calls.push(["beforeMeasurement"]);
				}
				layout() {
					calls.push(["layout"]);
					return { reservedBlockStart: 0, reservedBlockEnd: 0, afterRender: null };
				}
			}

			const originalHandlers = Fragmenter.handlers;
			Fragmenter.handlers = [...originalHandlers, Probe];
			let flow;
			try {
				const template = document.createElement("template");
				template.innerHTML = `<div style="height:150px;margin:0"></div>
					<div style="height:150px;margin:0"></div>
					<div style="height:150px;margin:0"></div>`;
				// The first page is 100px narrower than the rest.
				const resolver = new PageResolver(
					[{ pseudo: ["first"], margin: { left: "50px", right: "50px" } }],
					{ inlineSize: 300, blockSize: 200 },
				);
				flow = new Fragmenter(template.content, { resolver });
				const pageCount = flow.flow().length;
				return { calls, pageCount };
			} finally {
				flow?.destroy();
				Fragmenter.handlers = originalHandlers;
			}
		});

		expect(result.pageCount).toBe(3);
		expect(result.calls).toEqual([
			["apply", 200],
			["beforeMeasurement"],
			["apply", 200],
			["layout"],
			["apply", 300],
			["layout"],
			["apply", 300],
			["layout"],
		]);
	});

	test("seeds setup with the flow's start index", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { LayoutHandler } = await import("/src/handlers/handler.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");

			const calls = [];
			class Probe extends LayoutHandler {
				applyConstraintSpace(cs) {
					calls.push(cs.availableInlineSize);
				}
			}

			const originalHandlers = Fragmenter.handlers;
			Fragmenter.handlers = [...originalHandlers, Probe];
			let flow;
			try {
				const template = document.createElement("template");
				template.innerHTML = "<div style=\"height:150px;margin:0\"></div>";
				const resolver = new PageResolver(
					[{ pseudo: ["first"], margin: { left: "50px", right: "50px" } }],
					{ inlineSize: 300, blockSize: 200 },
				);
				flow = new Fragmenter(template.content, {
					resolver,
					continuation: { fragmentainerIndex: 1, blockOffset: 0 },
				});
				flow.flow();
				return { calls };
			} finally {
				flow?.destroy();
				Fragmenter.handlers = originalHandlers;
			}
		});

		// A flow continuing on page 1 is seeded with page 1's width, not :first's.
		expect(result.calls).toEqual([300, 300]);
	});

	test("gives a region flow no seed and the region width per fragmentainer", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { LayoutHandler } = await import("/src/handlers/handler.js");
			const { RegionResolver } = await import("/src/resolvers/region-resolver.js");

			const calls = [];
			class Probe extends LayoutHandler {
				applyConstraintSpace(cs) {
					calls.push(["apply", cs.availableInlineSize]);
				}
				beforeMeasurement() {
					calls.push(["beforeMeasurement"]);
				}
			}

			const container = document.createElement("div");
			document.body.appendChild(container);
			container.innerHTML = `
				<div style="width: 300px; height: 200px;"></div>
				<div style="width: 400px; height: 200px;"></div>`;
			const regions = [...container.children];

			const originalHandlers = Fragmenter.handlers;
			Fragmenter.handlers = [...originalHandlers, Probe];
			let flow;
			try {
				const template = document.createElement("template");
				template.innerHTML = `<div style="height:150px;margin:0"></div>
					<div style="height:150px;margin:0"></div>`;
				flow = new Fragmenter(template.content, { resolver: new RegionResolver(regions) });
				let pages = 0;
				for (let i = 0; i < regions.length; i++) {
					const { value, done } = flow.next();
					if (done) break;
					regions[i].appendChild(value);
					pages++;
				}
				return { calls, pages };
			} finally {
				flow?.destroy();
				Fragmenter.handlers = originalHandlers;
				container.remove();
			}
		});

		expect(result.pages).toBe(2);
		expect(result.calls).toEqual([
			["beforeMeasurement"],
			["apply", 300],
			["apply", 400],
		]);
	});

	test("seeds a reattached measurer", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { LayoutHandler } = await import("/src/handlers/handler.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");

			const calls = [];
			class Probe extends LayoutHandler {
				applyConstraintSpace(cs) {
					calls.push(["apply", cs.availableInlineSize]);
				}
				layout() {
					calls.push(["layout"]);
					return { reservedBlockStart: 0, reservedBlockEnd: 0, afterRender: null };
				}
			}

			const originalHandlers = Fragmenter.handlers;
			Fragmenter.handlers = [...originalHandlers, Probe];
			let flow;
			try {
				const template = document.createElement("template");
				template.innerHTML = `<div style="height:150px;margin:0"></div>
					<div style="height:150px;margin:0"></div>`;
				const resolver = new PageResolver([], { inlineSize: 300, blockSize: 200 });
				flow = new Fragmenter(template.content, { resolver });
				// flow() releases the measurer when it finishes; reflow reattaches it.
				flow.flow();
				calls.length = 0;
				const pageCount = flow.reflow(0).length;
				return { calls: calls.slice(0, 3), pageCount };
			} finally {
				flow?.destroy();
				Fragmenter.handlers = originalHandlers;
			}
		});

		expect(result.pageCount).toBe(2);
		expect(result.calls).toEqual([["apply", 300], ["apply", 300], ["layout"]]);
	});
});
