import { test, expect } from "../browser-fixture.js";

test.describe("Parallel-flow continuation", () => {
	async function layout(page, html, css = "") {
		return page.evaluate(
			async ({ html, css }) => {
				const { Fragmenter, PageResolver } = await import("/src/index.js");
				const sheet = new CSSStyleSheet();
				sheet.replaceSync(`
					@page { size: 300px 100px; margin: 0; }
					body, div, p { margin: 0; }
					.fixed > p { height: 20px; }
					.fixed { height: 20px; }
					.following > p { height: 20px; }
					${css}
				`);
				const template = document.createElement("template");
				template.innerHTML = html;
				const flow = new Fragmenter(template.content, {
					resolver: PageResolver.fromStyleSheets([sheet]),
					styles: [sheet],
				});
				const context = flow.flow();
				const pages = [...context].map((element, index) => {
					document.body.appendChild(element);
					const streams = [...element.querySelectorAll("[data-stream]")].map((stream) => ({
						name: stream.dataset.stream,
						items: [...stream.querySelectorAll(":scope > p")].map((item) => item.textContent),
						splitFrom: stream.hasAttribute("data-split-from"),
						splitTo: stream.hasAttribute("data-split-to"),
					}));
					element.remove();
					return {
						streams,
						blockSize: context.fragments[index].blockSize,
						hasBreakToken: context.fragments[index].breakToken !== null,
						isLast: context.fragments[index].isLast,
					};
				});
				const exhausted = flow.next().done;
				flow.destroy();
				return { pages, exhausted };
			},
			{ html, css },
		);
	}

	const blocks = (prefix, count) =>
		Array.from({ length: count }, (_, index) => `<p>${prefix}${index + 1}</p>`).join("");
	const streamNames = (result) =>
		result.pages.map(({ streams }) => streams.map(({ name }) => name));
	const itemsFor = (result, name) =>
		result.pages.flatMap(
			({ streams }) => streams.find((stream) => stream.name === name)?.items ?? [],
		);

	test("keeps an earlier overflow moving after the following sibling completes", async ({ page }) => {
		const result = await layout(
			page,
			`<div class="fixed" data-stream="overflow">${blocks("o", 12)}</div>
			 <div class="following" data-stream="following">${blocks("f", 6)}</div>`,
		);

		expect(streamNames(result)).toEqual([
			["overflow", "following"],
			["overflow", "following"],
			["overflow"],
		]);
		expect(result.pages.map(({ streams }) => streams[0].items)).toEqual([
			["o1", "o2", "o3", "o4", "o5"],
			["o6", "o7", "o8", "o9", "o10"],
			["o11", "o12"],
		]);
		expect(itemsFor(result, "following")).toEqual(["f1", "f2", "f3", "f4", "f5", "f6"]);
		// Only overflow remains on the last page. It contributes no extent, but
		// its descendants still count as progress and must be drained.
		expect(result.pages.map(({ blockSize }) => blockSize)).toEqual([100, 40, 0]);
		expect(result.pages.map(({ hasBreakToken }) => hasBreakToken)).toEqual([true, true, false]);
		expect(result.pages.map(({ isLast }) => isLast)).toEqual([false, false, true]);
		expect(result.pages[2].streams[0]).toMatchObject({ splitFrom: true, splitTo: false });
		expect(result.exhausted).toBe(true);
	});

	test("keeps a later sibling moving after the earlier overflow completes", async ({ page }) => {
		const result = await layout(
			page,
			`<div class="fixed" data-stream="overflow">${blocks("o", 6)}</div>
			 <div class="following" data-stream="following">${blocks("f", 12)}</div>`,
		);

		expect(streamNames(result)).toEqual([
			["overflow", "following"],
			["overflow", "following"],
			["following"],
		]);
		expect(result.pages[0].streams[0].items).toEqual(["o1", "o2", "o3", "o4", "o5"]);
		expect(result.pages[1].streams[0]).toMatchObject({
			items: ["o6"],
			splitFrom: true,
			splitTo: false,
		});
		expect(itemsFor(result, "overflow")).toEqual(["o1", "o2", "o3", "o4", "o5", "o6"]);
		expect(itemsFor(result, "following")).toEqual([
			"f1",
			"f2",
			"f3",
			"f4",
			"f5",
			"f6",
			"f7",
			"f8",
			"f9",
			"f10",
			"f11",
			"f12",
		]);
		expect(result.pages[2].streams[0].items).toEqual(["f10", "f11", "f12"]);
		expect(result.pages.map(({ blockSize }) => blockSize)).toEqual([100, 100, 60]);
		expect(result.pages.map(({ hasBreakToken }) => hasBreakToken)).toEqual([true, true, false]);
		expect(result.pages.map(({ isLast }) => isLast)).toEqual([false, false, true]);
		expect(result.exhausted).toBe(true);
	});
});
