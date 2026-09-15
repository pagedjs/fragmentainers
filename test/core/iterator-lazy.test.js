import { test, expect } from "../browser-fixture.js";

test("contexts compose on demand and become invalid after reflow or destruction", async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { Fragmenter } = await import("/src/index.js");
		const { LayoutHandler } = await import("/src/handlers.js");
		let composed = 0;
		class Probe extends LayoutHandler { afterCompose() { composed++; } }
		const handlers = Fragmenter.handlers;
		Fragmenter.handlers = [...handlers, Probe];
		const template = document.createElement("template");
		template.innerHTML = "<p style='margin:0;height:80px'>x</p>".repeat(4);
		const flow = new Fragmenter(template.content, { width: 200, height: 80 });
		try {
			const context = flow.flow();
			const before = composed;
			const first = context.next().value;
			const afterFirst = composed;
			const second = context.next().value;
			const afterSecond = composed;
			const suffix = flow.reflow(1);
			const errors = [];
			try { context.next(); } catch (error) { errors.push(error.name); }
			const beforeSuffix = composed;
			const index = suffix.next().value.fragmentIndex;
			flow.destroy();
			try { suffix.next(); } catch (error) { errors.push(error.name); }
			return { before, afterFirst, afterSecond, beforeSuffix, index, errors, different: first !== second };
		} finally { flow.destroy(); Fragmenter.handlers = handlers; }
	});
	expect(result).toEqual({ before: 0, afterFirst: 1, afterSecond: 2, beforeSuffix: 2, index: 1, errors: ["AbortError", "AbortError"], different: true });
});

test("lazy ranges retain absolute indexes and stop without repeated composition", async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { Fragmenter } = await import("/src/index.js");
		const source = document.createElement("template");
		source.innerHTML = "<p style='margin:0;height:80px'>x</p>".repeat(4);
		const flow = new Fragmenter(source.content, { width: 200, height: 80, continuation: { fragmentainerIndex: 5, blockOffset: 0 } });
		try {
			const context = flow.flow({ start: 1, stop: 3 });
			return { indexes: [...context].map((element) => element.fragmentIndex), count: context.fragmentainerCount, done: context.next().done };
		} finally { flow.destroy(); }
	});
	expect(result).toEqual({ indexes: [6, 7], count: 4, done: true });
});
