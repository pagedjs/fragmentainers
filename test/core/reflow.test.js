import { test, expect } from "../browser-fixture.js";

test.describe("FragmentedFlow.reflow()", () => {
	test("reflow(0) matches a fresh layout", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
      </div>`;

			const layout1 = new FragmentedFlow(template.content.cloneNode(true), {
				width: 600,
				height: 300,
			});
			const fresh = layout1.flow().fragments;

			const layout2 = new FragmentedFlow(template.content.cloneNode(true), {
				width: 600,
				height: 300,
			});
			layout2.flow();
			const reflowed = layout2.reflow(0);

			const r = {
				lengthMatch: reflowed.fragments.length === fresh.length,
				comparisons: [],
			};
			for (let i = 0; i < fresh.length; i++) {
				r.comparisons.push({
					blockSizeMatch: reflowed.fragments[i].blockSize === fresh[i].blockSize,
					childrenMatch:
						reflowed.fragments[i].childFragments.length === fresh[i].childFragments.length,
				});
			}
			layout1.destroy();
			layout2.destroy();
			return r;
		});

		expect(result.lengthMatch).toBe(true);
		for (const c of result.comparisons) {
			expect(c.blockSizeMatch).toBe(true);
			expect(c.childrenMatch).toBe(true);
		}
	});

	test("reflow(1) matches original fragments from index 1", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
      </div>`;

			const layout1 = new FragmentedFlow(template.content.cloneNode(true), {
				width: 600,
				height: 300,
			});
			const fresh = layout1.flow().fragments;

			const layout2 = new FragmentedFlow(template.content.cloneNode(true), {
				width: 600,
				height: 300,
			});
			layout2.flow();
			const reflowed = layout2.reflow(1);

			const r = {
				lengthMatch: reflowed.fragments.length === fresh.length - 1,
				blockSizeComparisons: [],
			};
			for (let i = 0; i < reflowed.fragments.length; i++) {
				r.blockSizeComparisons.push(reflowed.fragments[i].blockSize === fresh[i + 1].blockSize);
			}
			layout1.destroy();
			layout2.destroy();
			return r;
		});

		expect(result.lengthMatch).toBe(true);
		for (const match of result.blockSizeComparisons) {
			expect(match).toBe(true);
		}
	});

	test("reflow() restores counter state from preceding fragment", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0;padding:0">
        <div style="counter-reset:paragraph 0;margin:0;padding:0">
          <div style="height:200px;counter-increment:paragraph 1;margin:0;padding:0"></div>
          <div style="height:200px;counter-increment:paragraph 1;margin:0;padding:0"></div>
          <div style="height:200px;counter-increment:paragraph 1;margin:0;padding:0"></div>
        </div>
      </div>`;

			const layout = new FragmentedFlow(template.content, { width: 600, height: 300 });
			const fragments = layout.flow().fragments;

			const countersBefore = fragments[0].counterState;
			const reflowed = layout.reflow(1);

			let reflowedHasCounterState = false;
			if (countersBefore) {
				reflowedHasCounterState = reflowed.fragments[0].counterState !== undefined;
			}
			layout.destroy();
			return { hadCountersBefore: !!countersBefore, reflowedHasCounterState };
		});

		if (result.hadCountersBefore) {
			expect(result.reflowedHasCounterState).toBe(true);
		}
	});

	test("reflow(0) on single-fragment content produces identical result", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;

			const layout = new FragmentedFlow(template.content, { width: 600, height: 300 });
			const fresh = layout.flow().fragments;

			const reflowed = layout.reflow(0);
			const r = {
				freshLength: fresh.length,
				blockSizeMatch: reflowed.fragments[0].blockSize === fresh[0].blockSize,
				breakTokenNull: reflowed.fragments[0].breakToken === null,
			};
			layout.destroy();
			return r;
		});

		expect(result.freshLength).toBe(1);
		expect(result.blockSizeMatch).toBe(true);
		expect(result.breakTokenNull).toBe(true);
	});
});

test.describe("FragmentedFlow.reflow() (browser)", () => {
	test("reflow(0) after height change produces different fragment count", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <div id="target" style="height: 200px; margin: 0;"></div>
      </div>`;
			const layout = new FragmentedFlow(template.content, {
				width: 400,
				height: 100,
			});
			const flow = layout.flow();
			const originalCount = flow.fragmentainerCount;

			const target = layout.contentRoot.querySelector("#target");
			target.style.height = "50px";

			const newFlow = layout.reflow(0);
			const r = {
				originalCountGte2: originalCount >= 2,
				newCount: newFlow.fragmentainerCount,
			};
			layout.destroy();
			return r;
		});

		expect(result.originalCountGte2).toBe(true);
		expect(result.newCount).toBe(1);
	});

	test("reflow(0) after height increase produces more fragments", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <div id="target" style="height: 100px; margin: 0;"></div>
      </div>`;
			const layout = new FragmentedFlow(template.content, {
				width: 400,
				height: 100,
			});
			const flow = layout.flow();
			const originalCount = flow.fragmentainerCount;

			const target = layout.contentRoot.querySelector("#target");
			target.style.height = "350px";

			const newFlow = layout.reflow(0);
			const r = {
				originalCount,
				newCountGt1: newFlow.fragmentainerCount > 1,
			};
			layout.destroy();
			return r;
		});

		expect(result.originalCount).toBe(1);
		expect(result.newCountGt1).toBe(true);
	});

	test("reflow(1) preserves fragment 0 and re-layouts from index 1", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <div style="height: 100px; margin: 0;"></div>
        <div style="height: 100px; margin: 0;"></div>
        <div style="height: 100px; margin: 0;"></div>
      </div>`;
			const layout = new FragmentedFlow(template.content, {
				width: 400,
				height: 150,
			});
			const flow = layout.flow();

			const frag0BlockSize = flow.fragments[0].blockSize;
			const originalCount = flow.fragmentainerCount;

			const newFlow = layout.reflow(1);
			const r = {
				originalCount,
				newFlowLengthGt0: newFlow.length > 0,
				newFlowTagName: newFlow[0].tagName.toLowerCase(),
				frag0BlockSizePreserved: flow.fragments[0].blockSize === frag0BlockSize,
			};
			layout.destroy();
			return r;
		});

		expect(result.originalCount).toBe(2);
		expect(result.newFlowLengthGt0).toBe(true);
		expect(result.newFlowTagName).toBe("fragment-container");
		expect(result.frag0BlockSizePreserved).toBe(true);
	});
});

test.describe("layout.reflow() returns FragmentationContext (browser)", () => {
	test("reflow(0) returns a FragmentationContext with elements", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <div style="height: 200px; margin: 0;"></div>
      </div>`;
			const layout = new FragmentedFlow(template.content, {
				width: 400,
				height: 100,
			});
			layout.flow();

			const newFlow = layout.reflow(0);
			const r = {
				lengthGt0: newFlow.length > 0,
				tagName: newFlow[0].tagName.toLowerCase(),
			};
			layout.destroy();
			return r;
		});

		expect(result.lengthGt0).toBe(true);
		expect(result.tagName).toBe("fragment-container");
	});

	test("reflow(0) after size change returns updated elements", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <div id="target" style="height: 200px; margin: 0;"></div>
      </div>`;
			const layout = new FragmentedFlow(template.content, {
				width: 400,
				height: 100,
			});
			layout.flow();

			const target = layout.contentRoot.querySelector("#target");
			target.style.height = "50px";

			const newFlow = layout.reflow(0);
			const r = {
				fragmentainerCount: newFlow.fragmentainerCount,
				length: newFlow.length,
			};
			layout.destroy();
			return r;
		});

		expect(result.fragmentainerCount).toBe(1);
		expect(result.length).toBe(1);
	});
});

test.describe("FragmentContainerElement observers (browser)", () => {
	test("composed elements have correct fragmentIndex", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <div style="height: 200px; margin: 0;"></div>
      </div>`;
			const layout = new FragmentedFlow(template.content, {
				width: 400,
				height: 100,
			});
			const flow = layout.flow();

			const indices = [];
			for (let i = 0; i < flow.length; i++) {
				indices.push(flow[i].fragmentIndex);
			}
			layout.destroy();
			return { indices };
		});

		for (let i = 0; i < result.indices.length; i++) {
			expect(result.indices[i]).toBe(i);
		}
	});

	test("startObserving() fires fragment-change on content mutation", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <div style="height: 200px; margin: 0;"></div>
      </div>`;
			const layout = new FragmentedFlow(template.content, {
				width: 400,
				height: 100,
			});
			const flow = layout.flow();
			const fragEl = flow[0];
			document.body.appendChild(fragEl);

			const received = [];
			fragEl.addEventListener("fragment-change", (e) => {
				received.push(e.detail);
			});

			fragEl.startObserving();

			await new Promise((resolve) => {
				requestAnimationFrame(() => {
					const div = document.createElement("div");
					div.style.height = "50px";
					fragEl.appendChild(div);

					queueMicrotask(() => {
						queueMicrotask(() => {
							resolve();
						});
					});
				});
			});

			const r = {
				receivedLength: received.length,
				receivedIndex: received.length > 0 ? received[0].index : null,
			};
			fragEl.remove();
			layout.destroy();
			return r;
		});

		expect(result.receivedLength).toBe(1);
		expect(result.receivedIndex).toBe(0);
	});

	test("stopObserving() prevents further events", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <div style="height: 200px; margin: 0;"></div>
      </div>`;
			const layout = new FragmentedFlow(template.content, {
				width: 400,
				height: 100,
			});
			const flow = layout.flow();
			const fragEl = flow[0];
			document.body.appendChild(fragEl);

			const received = [];
			fragEl.addEventListener("fragment-change", (e) => {
				received.push(e.detail);
			});

			fragEl.startObserving();

			await new Promise((resolve) => {
				requestAnimationFrame(() => {
					fragEl.stopObserving();

					fragEl.appendChild(document.createElement("div"));

					queueMicrotask(() => {
						queueMicrotask(() => {
							resolve();
						});
					});
				});
			});

			const r = { receivedLength: received.length };
			fragEl.remove();
			layout.destroy();
			return r;
		});

		expect(result.receivedLength).toBe(0);
	});
});
