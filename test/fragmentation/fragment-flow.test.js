import { test, expect } from "../browser-fixture.js";

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
});
