import { test, expect } from "../browser-fixture.js";

async function runBoundedFlow(page, { html, caps = [200], replayAt = null }) {
	return page.evaluate(async ({ html, caps, replayAt }) => {
		const { FragmentFlow } = await import("/src/fragmentation/fragment-flow.js");
		const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
		const container = document.createElement("div");
		container.style.cssText = "position:absolute;left:-9999px;width:400px;font:16px/20px monospace";
		container.innerHTML = html;
		document.body.appendChild(container);
		const flow = new FragmentFlow();
		const nodes = Array.from(container.children, (element) => new DOMLayoutNode(element));
		const source = container.textContent.replace(/\s+/g, "");
		flow.enqueue(nodes);
		const pages = [];
		const replayChecks = [];
		let completed = false;
		const summarize = (result) => ({
			text: result.fragment.build(result.inputBreakToken).textContent.replace(/\s+/g, ""),
			blockSize: result.fragment.blockSize,
			hasBreak: result.breakToken !== null,
			rejected: result.rejectedNode?.element.id ?? null,
			queue: flow.snapshot().queue.map((node) => node.element.id),
		});
		try {
			// Six accepted calls and at most one speculative call bound non-progress failures.
			for (let call = 0; call < 6; call++) {
				const constraints = { availableInlineSize: 400, availableBlockSize: caps[call] ?? caps.at(-1) };
				const before = flow.snapshot();
				let speculative = null;
				if (replayAt === call) {
					speculative = summarize(flow.layoutFragmentainer(constraints));
					flow.restore(before);
					const restored = flow.snapshot();
					replayChecks.push(restored.breakToken === before.breakToken &&
						restored.queue.length === before.queue.length &&
						restored.queue.every((node, index) => node === before.queue[index]));
				}
				const result = flow.layoutFragmentainer(constraints);
				const summary = summarize(result);
				if (speculative) replayChecks.push(JSON.stringify(summary) === JSON.stringify(speculative));
				pages.push({ ...summary, inputPreserved: result.inputBreakToken === before.breakToken });
				if (result.breakToken === null && flow.snapshot().queue.length === 0) {
					completed = true;
					break;
				}
			}
			return {
				pages,
				source,
				output: pages.map((page) => page.text).join(""),
				completed,
				finalBreakToken: flow.breakToken === null ? null : "continuation",
				replayChecks,
			};
		} finally {
			flow.destroy();
			container.remove();
		}
	}, { html, caps, replayAt });
}

function expectConservedFlow(result) {
	expect(result.completed).toBe(true);
	expect(result.finalBreakToken).toBeNull();
	expect(result.output).toBe(result.source);
	expect(result.pages.every((page) => page.inputPreserved)).toBe(true);
	expect(result.replayChecks.every(Boolean)).toBe(true);
}

test.describe("FragmentFlow", () => {
	test("empty queue produces an empty fragment and null break token", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentFlow } = await import("/src/fragmentation/fragment-flow.js");
			const flow = new FragmentFlow();
			const r = flow.layoutFragmentainer({ availableInlineSize: 400, availableBlockSize: 300 });
			return { blockSize: r.fragment.blockSize, breakToken: r.breakToken, rejectedNode: r.rejectedNode };
		});
		expect(result.blockSize).toBe(0);
		expect(result.breakToken).toBeNull();
		expect(result.rejectedNode).toBeNull();
	});

	test("single queue item that fits lays out in one page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentFlow } = await import("/src/fragmentation/fragment-flow.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:400px";
			container.innerHTML = '<div style="height:80px;overflow:hidden;margin:0;padding:0">A</div>';
			document.body.appendChild(container);

			const flow = new FragmentFlow();
			flow.enqueue([new DOMLayoutNode(container.firstElementChild)]);
			const r = flow.layoutFragmentainer({ availableInlineSize: 400, availableBlockSize: 300 });

			container.remove();
			return {
				blockSize: r.fragment.blockSize,
				hasBreakToken: !!r.breakToken,
				childCount: r.fragment.childFragments.length,
			};
		});
		expect(result.blockSize).toBeCloseTo(80, 0);
		expect(result.hasBreakToken).toBe(false);
		expect(result.childCount).toBe(1);
	});

	test("queue taller than cap splits across calls via break token carryover", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentFlow } = await import("/src/fragmentation/fragment-flow.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:400px";
			container.innerHTML =
				'<div style="height:200px;overflow:hidden;margin:0;padding:0">A</div>' +
				'<div style="height:200px;overflow:hidden;margin:0;padding:0">B</div>';
			document.body.appendChild(container);

			const flow = new FragmentFlow();
			flow.enqueue([
				new DOMLayoutNode(container.children[0]),
				new DOMLayoutNode(container.children[1]),
			]);

			const r1 = flow.layoutFragmentainer({ availableInlineSize: 400, availableBlockSize: 250 });
			const r2 = flow.layoutFragmentainer({ availableInlineSize: 400, availableBlockSize: 250 });
			const r3 = flow.layoutFragmentainer({ availableInlineSize: 400, availableBlockSize: 250 });

			container.remove();
			return {
				p1Size: r1.fragment.blockSize,
				p1Break: !!r1.breakToken,
				p2Size: r2.fragment.blockSize,
				p2Break: !!r2.breakToken,
				p3Size: r3.fragment.blockSize,
				p3Break: !!r3.breakToken,
			};
		});
		expect(result.p1Size).toBeGreaterThan(0);
		expect(result.p1Break).toBe(true);
		expect(result.p2Size).toBeGreaterThan(0);
		expect(result.p3Break).toBe(false);
	});

	test("break-inside: avoid item that doesn't fit is signaled as rejectedNode", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentFlow } = await import("/src/fragmentation/fragment-flow.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:400px";
			container.innerHTML =
				'<div style="height:100px;margin:0;padding:0">filler</div>' +
				'<div style="height:400px;break-inside:avoid;margin:0;padding:0">too tall</div>';
			document.body.appendChild(container);

			const flow = new FragmentFlow();
			const fillerNode = new DOMLayoutNode(container.children[0]);
			const tallNode = new DOMLayoutNode(container.children[1]);
			flow.enqueue([fillerNode, tallNode]);

			const r = flow.layoutFragmentainer({ availableInlineSize: 400, availableBlockSize: 300 });
			const rejectedIsTall = r.rejectedNode === tallNode;

			container.remove();
			return { hasBreak: !!r.breakToken, rejectedIsTall };
		});
		expect(result.hasBreak).toBe(true);
		expect(result.rejectedIsTall).toBe(true);
	});

	test("destroy() clears queue and break token", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentFlow } = await import("/src/fragmentation/fragment-flow.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:400px";
			container.innerHTML = '<div style="height:200px;overflow:hidden;margin:0;padding:0">A</div>';
			document.body.appendChild(container);

			const flow = new FragmentFlow();
			flow.enqueue([new DOMLayoutNode(container.firstElementChild)]);
			flow.layoutFragmentainer({ availableInlineSize: 400, availableBlockSize: 100 });
			const hadTokenBefore = flow.breakToken !== null;
			flow.destroy();
			const r = flow.layoutFragmentainer({ availableInlineSize: 400, availableBlockSize: 300 });

			container.remove();
			return {
				hadTokenBefore,
				afterDestroyBlock: r.fragment.blockSize,
				afterDestroyBreak: !!r.breakToken,
			};
		});
		expect(result.hadTokenBefore).toBe(true);
		expect(result.afterDestroyBlock).toBe(0);
		expect(result.afterDestroyBreak).toBe(false);
	});

	test("queue is append-only across calls", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentFlow } = await import("/src/fragmentation/fragment-flow.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:400px";
			container.innerHTML =
				'<div style="height:80px;margin:0;padding:0">A</div>' +
				'<div style="height:80px;margin:0;padding:0">B</div>' +
				'<div style="height:80px;margin:0;padding:0">C</div>';
			document.body.appendChild(container);

			const flow = new FragmentFlow();
			flow.enqueue([new DOMLayoutNode(container.children[0])]);
			const r1 = flow.layoutFragmentainer({ availableInlineSize: 400, availableBlockSize: 300 });

			flow.enqueue([
				new DOMLayoutNode(container.children[1]),
				new DOMLayoutNode(container.children[2]),
			]);
			const r2 = flow.layoutFragmentainer({ availableInlineSize: 400, availableBlockSize: 300 });

			container.remove();
			return {
				p1Children: r1.fragment.childFragments.length,
				p2Children: r2.fragment.childFragments.length,
			};
		});
		// Page 1: A fit, no break. Page 2: no break token carried in, but queue is done after A
		// consumed. enqueue added B/C after; the flow's break token tracked that A was finished,
		// so page 2 should lay out B and C fresh.
		expect(result.p1Children).toBe(1);
		expect(result.p2Children).toBe(2);
	});

	test("an avoided item retries before queue consumption and retains rejection on replay", async ({ page }) => {
		const result = await runBoundedFlow(page, {
			html: `<div id="intro" style="height:100px">INTRO</div>
				<div id="avoided" style="break-inside:avoid"><div style="height:100px">A</div><div style="height:100px">B</div></div>`,
			caps: [250],
			replayAt: 0,
		});
		expectConservedFlow(result);
		expect(result.pages.map((page) => page.text)).toEqual(["INTRO", "AB"]);
		expect(result.pages.map((page) => page.rejected)).toEqual(["avoided", null]);
		expect(result.pages.map((page) => page.queue)).toEqual([["avoided"], []]);
		expect(result.replayChecks).toEqual([true, true]);
	});

	test("routes a nested cell target through the row and retains later queued content", async ({ page }) => {
		const result = await runBoundedFlow(page, {
			html: `<section id="nested"><table style="border-collapse:collapse;border-spacing:0"><tbody><tr><td style="padding:0">
				<div style="height:100px">A</div><div style="height:100px">B</div>
				<div style="height:100px;break-before:avoid">C</div>
				</td></tr></tbody></table></section><div id="tail" style="height:80px">D</div>`,
		});
		expectConservedFlow(result);
		expect(result.pages.map((page) => page.text)).toEqual(["A", "BC", "D"]);
		expect(result.pages[0].queue).toEqual(["nested", "tail"]);
		expect(result.pages[0].rejected).toBeNull();
	});

	test("retries a resumed nested cell from the same input token and snapshot", async ({ page }) => {
		const result = await runBoundedFlow(page, {
			html: `<section id="nested"><table style="border-collapse:collapse;border-spacing:0"><tbody><tr><td style="padding:0">
				<div style="height:100px">A</div><div style="height:100px">B</div>
				<div style="height:100px">C</div><div style="height:100px;break-before:avoid">D</div>
				</td></tr></tbody></table></section>`,
			caps: [100, 200],
			replayAt: 1,
		});
		expectConservedFlow(result);
		expect(result.pages.map((page) => page.text)).toEqual(["A", "B", "CD"]);
		expect(result.pages.map((page) => page.hasBreak)).toEqual([true, true, false]);
		expect(result.replayChecks).toEqual([true, true]);
	});

	test("Fragmenter settles a handler flow's early break and drains it without losing content", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { FragmentFlow } = await import("/src/fragmentation/fragment-flow.js");
			const { LayoutHandler } = await import("/src/handlers/handler.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			class ScoredFlow extends LayoutHandler {
				#flow;
				#host;

				init(options, context) {
					this.#flow = new FragmentFlow(context);
					this.#host = document.createElement("div");
					this.#host.style.cssText = "position:absolute;left:-9999px;width:400px;font:16px/20px monospace";
					this.#host.innerHTML = `<div><div style="height:100px">A</div>
						<div style="height:100px">B</div><div style="height:100px;break-before:avoid">C</div></div>`;
					document.body.appendChild(this.#host);
					const node = new DOMLayoutNode(this.#host.firstElementChild);
					node.context = context;
					this.#flow.enqueue([node]);
				}

				getFlow() {
					return this.#flow;
				}

				getFlowCap() {
					return 200;
				}

				composeFlowFragment(wrapper, fragment, inputBreakToken) {
					const area = document.createElement("aside");
					area.dataset.scoredFlow = "";
					area.appendChild(fragment.build(inputBreakToken));
					wrapper.appendChild(area);
				}

				destroy() {
					this.#flow?.destroy();
					this.#host?.remove();
				}
			}

			const handlers = Fragmenter.handlers;
			Fragmenter.handlers = [...handlers, ScoredFlow];
			let layout;
			const elements = [];
			let completed = false;
			try {
				const template = document.createElement("template");
				template.innerHTML = '<div data-main="" style="height:20px;margin:0">MAIN</div>';
				layout = new Fragmenter(template.content, { width: 400, height: 300 });
				for (let call = 0; call < 8; call++) {
					const step = layout.next();
					if (step.done) {
						completed = true;
						break;
					}
					elements.push(step.value);
				}
				return {
					completed,
					finalBreakToken: layout.fragments.at(-1)?.breakToken === null ? null : "continuation",
					parallelBreakToken: layout.handlers.get(ScoredFlow).getFlow().breakToken === null ? null : "continuation",
					flowText: elements.map((element) => element.querySelector("[data-scored-flow]")?.textContent.replace(/\s+/g, "") ?? ""),
					mainText: elements.map((element) => element.querySelector("[data-main]")?.textContent ?? ""),
				};
			} finally {
				layout?.destroy();
				for (const element of elements) element.remove();
				Fragmenter.handlers = handlers;
			}
		});
		expect(result.completed).toBe(true);
		expect(result.finalBreakToken).toBeNull();
		expect(result.parallelBreakToken).toBeNull();
		expect(result.flowText).toEqual(["A", "BC"]);
		expect(result.mainText).toEqual(["MAIN", ""]);
	});
});
