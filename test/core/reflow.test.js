import { test, expect } from "../browser-fixture.js";

test.describe("Fragmenter.reflow()", () => {
	test("reflow(0) matches a fresh layout", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
      </div>`;

			const layout1 = new Fragmenter(template.content.cloneNode(true), {
				width: 600,
				height: 300,
			});
			const fresh = layout1.flow().fragments;

			const layout2 = new Fragmenter(template.content.cloneNode(true), {
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
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
      </div>`;

			const layout1 = new Fragmenter(template.content.cloneNode(true), {
				width: 600,
				height: 300,
			});
			const fresh = layout1.flow().fragments;

			const layout2 = new Fragmenter(template.content.cloneNode(true), {
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

	test("tracks nested same-name counter scopes across fragmentainers", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/index.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0;padding:0">
	        <div style="counter-reset:chapter 0;margin:0;padding:0">
	          <div style="height:100px;counter-increment:chapter 1;margin:0;padding:0"></div>
	          <section style="margin:0;padding:0">
	            <div style="counter-reset:chapter 10;margin:0;padding:0">
	              <div style="height:100px;counter-increment:chapter 1;margin:0;padding:0"></div>
	              <div style="height:100px;counter-increment:chapter 1;margin:0;padding:0"></div>
	            </div>
	          </section>
	          <div style="height:100px;counter-increment:chapter 1;margin:0;padding:0"></div>
	        </div>
	      </div>`;

			const layout = new Fragmenter(template.content, { width: 600, height: 100 });
			const context = layout.flow();
			const values = context.fragments.map(
				(fragment) => fragment.counterState?.stack("chapter") ?? [],
			);
			layout.destroy();
			return values;
		});

		expect(result).toEqual([[1], [1, 11], [1], []]);
	});

	test("reflow restores exact scoped counter snapshots at every restart index", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/index.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0;padding:0">
	        <div style="counter-reset:chapter 0;margin:0;padding:0">
	          <div style="height:100px;counter-increment:chapter 1;margin:0;padding:0"></div>
	          <section style="margin:0;padding:0">
	            <div style="counter-reset:chapter 10;margin:0;padding:0">
	              <div style="height:100px;counter-increment:chapter 1;margin:0;padding:0"></div>
	              <div style="height:100px;counter-increment:chapter 1;margin:0;padding:0"></div>
	            </div>
	          </section>
	          <div style="height:100px;counter-increment:chapter 1;margin:0;padding:0"></div>
	        </div>
	      </div>`;

			const layout = new Fragmenter(template.content, { width: 600, height: 100 });
			const read = (context) =>
				context.fragments.map((fragment) => fragment.counterState?.stack("chapter") ?? []);
			const initial = layout.flow();
			const expected = read(initial);
			const restarts = [];
			for (let index = 0; index < initial.fragments.length; index++) {
				restarts.push(read(layout.reflow(index)));
			}
			layout.destroy();
			return { expected, restarts };
		});

		expect(result.expected).toEqual([[1], [1, 11], [1], []]);
		for (let index = 0; index < result.expected.length; index++) {
			expect(result.restarts[index]).toEqual(result.expected.slice(index));
		}
	});

	test("reflow restores top-level counter snapshots after the measurer reattaches", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/index.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `
	      <div style="height:100px;counter-increment:chapter 1;margin:0;padding:0"></div>
	      <div style="height:100px;counter-increment:chapter 1;margin:0;padding:0"></div>
	      <div style="height:100px;counter-increment:chapter 1;margin:0;padding:0"></div>
	      <div style="height:100px;counter-increment:chapter 1;margin:0;padding:0"></div>`;

			const layout = new Fragmenter(template.content, { width: 600, height: 100 });
			const read = (context) =>
				context.fragments.map((fragment) => fragment.counterState?.stack("chapter") ?? []);
			const initial = layout.flow();
			const expected = read(initial);
			const restarts = [];
			for (let index = 0; index < initial.fragments.length; index++) {
				restarts.push(read(layout.reflow(index)));
			}
			layout.destroy();
			return { expected, restarts };
		});

		expect(result.expected).toEqual([[1], [2], [3], [4]]);
		expect(result.restarts[0]).toEqual(result.expected);
		expect(result.restarts[1]).toEqual([[2], [3], [4]]);
		expect(result.restarts[2]).toEqual([[3], [4]]);
		expect(result.restarts[3]).toEqual([[4]]);
	});

	test("reflow restores canonical page counters at every restart index", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			const root = blockNode({
				children: Array.from({ length: 4 }, () => blockNode({ blockSize: 100 })),
			});
			const resolver = new PageResolver(
				[
					{ counterIncrement: "page 2" },
					{ pseudo: ["first"], counterReset: "page 4" },
				],
				{ inlineSize: 300, blockSize: 100 },
			);
			const layout = new Fragmenter(root, { resolver });
			const read = (context) =>
				context.fragments.map((fragment) => ({
					page: fragment.page,
					pages: fragment.pages,
				}));
			const initial = layout.flow();
			const expected = read(initial);
			const restarts = [];
			for (let index = 0; index < initial.fragments.length; index++) {
				restarts.push(read(layout.reflow(index)));
			}
			layout.destroy();
			return { expected, restarts };
		});

		expect(result.expected).toEqual([
			{ page: 6, pages: 4 },
			{ page: 8, pages: 4 },
			{ page: 10, pages: 4 },
			{ page: 12, pages: 4 },
		]);
		for (let index = 0; index < result.expected.length; index++) {
			expect(result.restarts[index]).toEqual(result.expected.slice(index));
		}
	});

	test("reflow(0) on single-fragment content produces identical result", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;

			const layout = new Fragmenter(template.content, { width: 600, height: 300 });
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

	test("reflow restores a seeded parallel flow at every restart index", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { FragmentFlow } = await import("/src/fragmentation/fragment-flow.js");
			const { LayoutHandler } = await import("/src/handlers/handler.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			class SeededFlow extends LayoutHandler {
				#flow;
				#host;

				init(_options, context) {
					this.#flow = new FragmentFlow(context);
					this.#host = document.createElement("div");
					this.#host.style.cssText = "position:absolute;left:-9999px;width:300px";
					this.#host.innerHTML = `<div style="margin:0;padding:0">${["one", "two", "three"]
						.map(
							(label) =>
								`<div data-seeded="${label}" style="height:40px;margin:0;padding:0">${label}</div>`,
						)
						.join("")}</div>`;
					document.body.appendChild(this.#host);
					const node = new DOMLayoutNode(this.#host.firstElementChild);
					node.context = context;
					this.#flow.enqueue([node]);
				}

				getFlow() {
					return this.#flow;
				}

				getFlowCap() {
					return 50;
				}

				composeFlowFragment(wrapper, fragment, inputBreakToken) {
					const area = document.createElement("div");
					area.setAttribute("data-seeded-flow", "");
					area.appendChild(fragment.build(inputBreakToken));
					wrapper.appendChild(area);
				}

				destroy() {
					this.#flow?.destroy();
					this.#host?.remove();
				}
			}

			const handlers = Fragmenter.handlers;
			Fragmenter.handlers = [...handlers, SeededFlow];
			let layout;
			try {
				const template = document.createElement("template");
				template.innerHTML =
					'<div data-main="" style="height:20px;margin:0;padding:0">main</div>';
				layout = new Fragmenter(template.content, { width: 300, height: 100 });
				const initial = layout.flow();
				const read = (context) =>
					[...context].map((element) =>
						[...element.querySelectorAll("[data-seeded]")].map(
							(item) => item.getAttribute("data-seeded"),
						),
					);
				const expected = read(initial);
				const restarts = [];
				for (let index = 0; index < initial.fragments.length; index++) {
					restarts.push(read(layout.reflow(index)));
				}
				return {
					expected,
					restarts,
					mainBreaks: initial.fragments.map((fragment) => fragment.breakToken !== null),
					mainContent: [...initial].map(
						(element) => element.querySelector("[data-main]") !== null,
					),
					flowState: initial.fragments.map((fragment) =>
						fragment.flowSnapshots.map((snapshot) => ({
							queue: snapshot.queue.length,
							breakToken: snapshot.breakToken !== null,
						})),
					),
				};
			} finally {
				layout?.destroy();
				Fragmenter.handlers = handlers;
			}
		});

		expect(result.flowState).toEqual([
			[{ queue: 1, breakToken: true }],
			[{ queue: 1, breakToken: true }],
			[{ queue: 0, breakToken: false }],
		]);
		expect(result.expected).toEqual([["one"], ["two"], ["three"]]);
		expect(result.mainBreaks).toEqual([false, false, false]);
		expect(result.mainContent).toEqual([true, false, false]);
		for (let index = 0; index < result.expected.length; index++) {
			expect(result.restarts[index]).toEqual(result.expected.slice(index));
		}
	});

	test("reflow restores the pushed-break prefix at every restart index", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { FragmentFlow } = await import("/src/fragmentation/fragment-flow.js");
			const { LayoutHandler } = await import("/src/handlers/handler.js");

			class PushForward extends LayoutHandler {
				#flow;

				init(_options, context) {
					this.#flow = new FragmentFlow(context);
				}

				getFlow() {
					return this.#flow;
				}

				getFlowCap() {
					return 0;
				}

				extractFlowChildren(fragment) {
					const pushForward = [];
					const visit = (current) => {
						if (
							current.blockSize > 0 &&
							current.node?.element?.hasAttribute("data-push")
						) {
							pushForward.push(current.node.element);
						}
						for (const child of current.childFragments) visit(child);
					};
					visit(fragment);
					return { children: [], pushForward };
				}

				destroy() {
					this.#flow?.destroy();
				}
			}

			const handlers = Fragmenter.handlers;
			Fragmenter.handlers = [...handlers, PushForward];
			let layout;
			try {
				const template = document.createElement("template");
				template.innerHTML = `<div style="margin:0;padding:0">
					<div data-id="a" style="height:60px;margin:0;padding:0">a</div>
					<div data-id="push-1" data-push="" style="height:30px;margin:0;padding:0">push-1</div>
					<div data-id="b" style="height:20px;margin:0;padding:0">b</div>
					<div data-id="push-2" data-push="" style="height:30px;margin:0;padding:0">push-2</div>
					<div data-id="c" style="height:20px;margin:0;padding:0">c</div>
				</div>`;
				layout = new Fragmenter(template.content, { width: 300, height: 100 });
				const initial = layout.flow();
				const read = (context) =>
					[...context].map((element) =>
						[...element.querySelectorAll("[data-id]")].map((item) => item.dataset.id),
					);
				const expectedContent = read(initial);
				const expectedMarks = initial.fragments.map((fragment) => fragment.pushedBreakMark);
				const restarts = [];
				for (let index = 0; index < initial.fragments.length; index++) {
					const context = layout.reflow(index);
					restarts.push({
						content: read(context),
						marks: context.fragments.map((fragment) => fragment.pushedBreakMark),
					});
				}
				return { expectedContent, expectedMarks, restarts };
			} finally {
				layout?.destroy();
				Fragmenter.handlers = handlers;
			}
		});

		expect(result.expectedContent).toEqual([["a"], ["push-1", "b"], ["push-2", "c"]]);
		expect(result.expectedMarks).toEqual([1, 2, 2]);
		for (let index = 0; index < result.expectedContent.length; index++) {
			expect(result.restarts[index].content).toEqual(result.expectedContent.slice(index));
			expect(result.restarts[index].marks).toEqual(result.expectedMarks.slice(index));
		}
	});
});

test.describe("Fragmenter.reflow() (browser)", () => {
	test("reflow(0) after height change produces different fragment count", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <div id="target" style="height: 200px; margin: 0;"></div>
      </div>`;
			const layout = new Fragmenter(template.content, {
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
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <div id="target" style="height: 100px; margin: 0;"></div>
      </div>`;
			const layout = new Fragmenter(template.content, {
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
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <div style="height: 100px; margin: 0;"></div>
        <div style="height: 100px; margin: 0;"></div>
        <div style="height: 100px; margin: 0;"></div>
      </div>`;
			const layout = new Fragmenter(template.content, {
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
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <div style="height: 200px; margin: 0;"></div>
      </div>`;
			const layout = new Fragmenter(template.content, {
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
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <div id="target" style="height: 200px; margin: 0;"></div>
      </div>`;
			const layout = new Fragmenter(template.content, {
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
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <div style="height: 200px; margin: 0;"></div>
      </div>`;
			const layout = new Fragmenter(template.content, {
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
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <div style="height: 200px; margin: 0;"></div>
      </div>`;
			const layout = new Fragmenter(template.content, {
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
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <div style="height: 200px; margin: 0;"></div>
      </div>`;
			const layout = new Fragmenter(template.content, {
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
