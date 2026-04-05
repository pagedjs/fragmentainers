import { test, expect } from "../browser-fixture.js";

test.describe("MutationSync with shared clone map", () => {
	test("populates the clone map via onClone during composition", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
			const { MutationSync } = await import("/src/modules/mutation-sync.js");
			await import("/src/dom/content-measure.js");
			await import("/src/dom/fragment-container.js");

			const syncModule = new MutationSync();
			FragmentedFlow.register(syncModule);

			try {
				const template = document.createElement("template");
				template.innerHTML = `<div style="margin:0; padding:0;">
          <div id="a" style="height: 100px; margin: 0;"></div>
          <div id="b" style="height: 100px; margin: 0;"></div>
        </div>`;

				const layout = new FragmentedFlow(template.content, { width: 400, height: 150 });
				const flow = layout.flow();

				const fragEl = flow[0];
				document.body.appendChild(fragEl);
				const clone = fragEl.contentRoot.querySelector("div");
				const cloneExists = clone !== null;

				clone.setAttribute("class", "test");
				const mutation = {
					type: "attributes",
					attributeName: "class",
					target: clone,
				};
				const { changed } = syncModule.applyMutations([mutation]);

				document.body.removeChild(fragEl);
				layout?.destroy();
				return { cloneExists, changed };
			} finally {
				FragmentedFlow.remove(syncModule);
			}
		});

		expect(result.cloneExists).toBe(true);
		expect(result.changed).toBe(true);
	});
});

test.describe("MutationSync attribute sync", () => {
	test("syncs attribute changes via clone map", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MutationSync } = await import("/src/modules/mutation-sync.js");
			const { modules } = await import("/src/modules/registry.js");

			const sync = new MutationSync();
			const source = document.createElement("p");
			const clone = document.createElement("p");
			modules.trackClone(clone, source);
			clone.setAttribute("class", "highlight");

			const mutation = {
				type: "attributes",
				attributeName: "class",
				target: clone,
			};

			const { changed } = sync.applyMutations([mutation]);
			return { changed, sourceClass: source.getAttribute("class") };
		});

		expect(result.changed).toBe(true);
		expect(result.sourceClass).toBe("highlight");
	});

	test("skips compositor-managed attributes", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MutationSync } = await import("/src/modules/mutation-sync.js");
			const { modules } = await import("/src/modules/registry.js");

			const sync = new MutationSync();
			const source = document.createElement("div");
			const clone = document.createElement("div");
			modules.trackClone(clone, source);
			clone.setAttribute("data-split-from", "");

			const mutation = {
				type: "attributes",
				attributeName: "data-split-from",
				target: clone,
			};

			const { changed } = sync.applyMutations([mutation]);
			return { changed };
		});

		expect(result.changed).toBe(false);
	});

	test("removes attribute from source when removed from clone", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MutationSync } = await import("/src/modules/mutation-sync.js");
			const { modules } = await import("/src/modules/registry.js");

			const sync = new MutationSync();
			const source = document.createElement("div");
			source.setAttribute("class", "old");
			const clone = document.createElement("div");
			modules.trackClone(clone, source);

			const mutation = {
				type: "attributes",
				attributeName: "class",
				target: clone,
			};

			sync.applyMutations([mutation]);
			return { sourceClass: source.getAttribute("class") };
		});

		expect(result.sourceClass).toBeNull();
	});

	test("ignores unmapped elements", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MutationSync } = await import("/src/modules/mutation-sync.js");

			const sync = new MutationSync();
			const clone = document.createElement("div");
			clone.setAttribute("class", "test");

			const mutation = {
				type: "attributes",
				attributeName: "class",
				target: clone,
			};

			const { changed } = sync.applyMutations([mutation]);
			return { changed };
		});

		expect(result.changed).toBe(false);
	});
});

test.describe("MutationSync element removal", () => {
	test("removes source element when clone is removed", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MutationSync } = await import("/src/modules/mutation-sync.js");
			const { modules } = await import("/src/modules/registry.js");

			const sync = new MutationSync();
			const sourceParent = document.createElement("div");
			const sourceP1 = document.createElement("p");
			sourceP1.textContent = "Keep";
			const sourceP2 = document.createElement("p");
			sourceP2.textContent = "Remove";
			sourceParent.appendChild(sourceP1);
			sourceParent.appendChild(sourceP2);

			const removedClone = document.createElement("p");
			modules.trackClone(removedClone, sourceP2);

			const mutation = {
				type: "childList",
				addedNodes: [],
				removedNodes: [removedClone],
				target: document.createElement("div"),
			};

			const { changed, structural } = sync.applyMutations([mutation]);
			const pCount = sourceParent.querySelectorAll("p").length;
			const firstText = sourceParent.firstChild.textContent;
			return { changed, structural, pCount, firstText };
		});

		expect(result.changed).toBe(true);
		expect(result.structural).toBe(true);
		expect(result.pCount).toBe(1);
		expect(result.firstText).toBe("Keep");
	});
});

test.describe("MutationSync element addition", () => {
	test("inserts new element at correct position in source", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MutationSync } = await import("/src/modules/mutation-sync.js");
			const { modules } = await import("/src/modules/registry.js");

			const sync = new MutationSync();
			const sourceDiv = document.createElement("div");
			const sourceP1 = document.createElement("p");
			sourceP1.textContent = "First";
			const sourceP2 = document.createElement("p");
			sourceP2.textContent = "Second";
			sourceDiv.appendChild(sourceP1);
			sourceDiv.appendChild(sourceP2);

			const mockParent = document.createElement("div");
			modules.trackClone(mockParent, sourceDiv);
			const cloneP1 = document.createElement("p");
			modules.trackClone(cloneP1, sourceP1);
			const cloneP2 = document.createElement("p");
			modules.trackClone(cloneP2, sourceP2);
			const newH2 = document.createElement("h2");
			newH2.textContent = "Inserted";

			mockParent.appendChild(cloneP1);
			mockParent.appendChild(newH2);
			mockParent.appendChild(cloneP2);

			const mutation = {
				type: "childList",
				addedNodes: [newH2],
				removedNodes: [],
				target: mockParent,
			};

			const { changed, structural } = sync.applyMutations([mutation]);
			const childrenCount = sourceDiv.children.length;
			const secondTag = sourceDiv.children[1].tagName;
			const secondText = sourceDiv.children[1].textContent;
			return { changed, structural, childrenCount, secondTag, secondText };
		});

		expect(result.changed).toBe(true);
		expect(result.structural).toBe(true);
		expect(result.childrenCount).toBe(3);
		expect(result.secondTag).toBe("H2");
		expect(result.secondText).toBe("Inserted");
	});

	test("maps added element and descendants into clone map", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MutationSync } = await import("/src/modules/mutation-sync.js");
			const { modules } = await import("/src/modules/registry.js");

			const sync = new MutationSync();
			const sourceDiv = document.createElement("div");
			const sourceP = document.createElement("p");
			sourceDiv.appendChild(sourceP);

			const mockParent = document.createElement("div");
			modules.trackClone(mockParent, sourceDiv);
			const cloneP = document.createElement("p");
			modules.trackClone(cloneP, sourceP);

			const newDiv = document.createElement("div");
			const innerSpan = document.createElement("span");
			innerSpan.textContent = "Nested";
			newDiv.appendChild(innerSpan);

			mockParent.appendChild(cloneP);
			mockParent.appendChild(newDiv);

			const mutation = {
				type: "childList",
				addedNodes: [newDiv],
				removedNodes: [],
				target: mockParent,
			};

			sync.applyMutations([mutation]);

			// Future attribute sync on the added element should work
			newDiv.setAttribute("class", "added");
			const { changed } = sync.applyMutations([
				{
					type: "attributes",
					attributeName: "class",
					target: newDiv,
				},
			]);
			return { changed };
		});

		expect(result.changed).toBe(true);
	});
});

test.describe("FragmentContainerElement.takeMutationRecords()", () => {
	test("returns buffered mutations and clears the buffer", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
			await import("/src/dom/content-measure.js");
			await import("/src/dom/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <div style="height: 200px; margin: 0;"></div>
      </div>`;
			const layout = new FragmentedFlow(template.content, { width: 400, height: 100 });
			const flow = layout.flow();
			const fragEl = flow[0];
			document.body.appendChild(fragEl);

			fragEl.startObserving();

			const res = await new Promise((resolve) => {
				requestAnimationFrame(() => {
					const wrapper = fragEl.contentRoot;
					wrapper.setAttribute("data-test", "value");

					queueMicrotask(() => {
						queueMicrotask(() => {
							const records = fragEl.takeMutationRecords();
							const recordsLength = records.length;

							const records2 = fragEl.takeMutationRecords();
							const records2Length = records2.length;

							fragEl.remove();
							layout?.destroy();
							resolve({ recordsLength, records2Length });
						});
					});
				});
			});

			return res;
		});

		expect(result.recordsLength).toBeGreaterThan(0);
		expect(result.records2Length).toBe(0);
	});
});

test.describe("reflow with rebuild", () => {
	test("reflow(0, { rebuild: true }) picks up structural changes", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/core/fragmented-flow.js");
			await import("/src/dom/content-measure.js");
			await import("/src/dom/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <div style="height: 100px; margin: 0;"></div>
      </div>`;
			const layout = new FragmentedFlow(template.content, {
				width: 400,
				height: 200,
				trackRefs: true,
			});
			const flow = layout.flow();
			const initialCount = flow.fragmentainerCount;

			const wrapper = layout.contentRoot.firstElementChild;
			const newDiv = document.createElement("div");
			newDiv.style.height = "200px";
			newDiv.style.margin = "0";
			wrapper.appendChild(newDiv);

			const newFlow = layout.reflow(0, { rebuild: true });
			const newCount = newFlow.fragmentainerCount;

			layout?.destroy();
			return { initialCount, newCount };
		});

		expect(result.initialCount).toBe(1);
		expect(result.newCount).toBeGreaterThan(1);
	});
});
