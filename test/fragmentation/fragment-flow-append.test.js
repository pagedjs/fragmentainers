import { test, expect } from "../browser-fixture.js";

test("new bodies follow a continuing last child without mutating its snapshot", async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { FragmentFlow } = await import("/src/fragmentation/fragment-flow.js");
		const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
		const host = document.createElement("div");
		host.style.cssText = "width:400px;font:16px/20px monospace";
		host.innerHTML = "<p style='margin:0'>Alpha<br>Bravo<br>Charlie<br>Delta</p><p style='margin:0'>Echo</p>";
		document.body.appendChild(host);
		const nodes = [...host.children].map((element) => new DOMLayoutNode(element));
		const flow = new FragmentFlow();
		const read = (height) => {
			const result = flow.layoutFragmentainer({ availableInlineSize: 400, availableBlockSize: height });
			return result.fragment.build(result.inputBreakToken).textContent;
		};
		flow.enqueue([nodes[0]]);
		const first = read(40);
		const before = flow.snapshot();
		flow.enqueue([nodes[1]]);
		const untouched = before.breakToken.hasSeenAllChildren;
		const second = read(100);
		flow.restore(before);
		flow.enqueue([nodes[1]]);
		const replay = read(100);
		const complete = !flow.hasPending && flow.breakToken === null;
		host.remove();
		return { first, second, replay, untouched, complete };
	});
	expect(result.first + result.second).toBe("AlphaBravoCharlieDeltaEcho");
	expect(result.replay).toBe(result.second);
	expect(result.untouched).toBe(true);
	expect(result.complete).toBe(true);
});

test("a zero-cap page retains newly queued content for drainage", async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { FragmentFlow } = await import("/src/fragmentation/fragment-flow.js");
		const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
		const host = document.createElement("div");
		host.textContent = "Pending body";
		document.body.appendChild(host);
		const flow = new FragmentFlow();
		flow.enqueue([new DOMLayoutNode(host)]);
		const empty = flow.layoutFragmentainer({ availableInlineSize: 400, availableBlockSize: 0 });
		const pending = flow.hasPending;
		const drained = flow.layoutFragmentainer({ availableInlineSize: 400, availableBlockSize: 100 });
		const text = drained.fragment.build(drained.inputBreakToken).textContent;
		host.remove();
		return { emptySize: empty.fragment.blockSize, pending, text, complete: !flow.hasPending };
	});
	expect(result).toEqual({ emptySize: 0, pending: true, text: "Pending body", complete: true });
});
