import { test, expect } from "../browser-fixture.js";

test.describe("FragmentationContext", () => {
	test("exposes fragments array", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentationContext } = await import("/src/fragmentation/fragmentation-context.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");

			function makeFragments(count) {
				const fragments = [];
				for (let i = 0; i < count; i++) {
					const node = document.createElement("div");
					const frag = new Fragment(node, 200, []);
					frag.constraints = {
						contentArea: { inlineSize: 816, blockSize: 1056 },
					};
					if (i < count - 1) {
						const bt = new BlockBreakToken(node);
						bt.consumedBlockSize = (i + 1) * 200;
						frag.breakToken = bt;
					}
					fragments.push(frag);
				}
				return fragments;
			}

			const fragments = makeFragments(3);
			const flow = new FragmentationContext(fragments, null);
			return { same: flow.fragments === fragments, length: flow.fragments.length };
		});

		expect(result.same).toBe(true);
		expect(result.length).toBe(3);
	});

	test("reports correct fragmentainerCount", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentationContext } = await import("/src/fragmentation/fragmentation-context.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");

			function makeFragments(count) {
				const fragments = [];
				for (let i = 0; i < count; i++) {
					const node = document.createElement("div");
					const frag = new Fragment(node, 200, []);
					frag.constraints = {
						contentArea: { inlineSize: 816, blockSize: 1056 },
					};
					if (i < count - 1) {
						const bt = new BlockBreakToken(node);
						bt.consumedBlockSize = (i + 1) * 200;
						frag.breakToken = bt;
					}
					fragments.push(frag);
				}
				return fragments;
			}

			const flow = new FragmentationContext(makeFragments(5), null);
			return flow.fragmentainerCount;
		});

		expect(result).toBe(5);
	});

	test("reports zero fragmentainerCount for empty array", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentationContext } = await import("/src/fragmentation/fragmentation-context.js");
			const flow = new FragmentationContext([], null);
			return flow.fragmentainerCount;
		});

		expect(result).toBe(0);
	});

	test("skips element creation when contentStyles is null", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentationContext } = await import("/src/fragmentation/fragmentation-context.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");

			function makeFragments(count) {
				const fragments = [];
				for (let i = 0; i < count; i++) {
					const node = document.createElement("div");
					const frag = new Fragment(node, 200, []);
					frag.constraints = {
						contentArea: { inlineSize: 816, blockSize: 1056 },
					};
					if (i < count - 1) {
						const bt = new BlockBreakToken(node);
						bt.consumedBlockSize = (i + 1) * 200;
						frag.breakToken = bt;
					}
					fragments.push(frag);
				}
				return fragments;
			}

			const flow = new FragmentationContext(makeFragments(3), null);
			return {
				length: flow.length,
				fragmentainerCount: flow.fragmentainerCount,
				fragmentsLength: flow.fragments.length,
			};
		});

		expect(result.length).toBe(0);
		expect(result.fragmentainerCount).toBe(3);
		expect(result.fragmentsLength).toBe(3);
	});

	test("Symbol.species returns Array", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentationContext } = await import("/src/fragmentation/fragmentation-context.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");

			function makeFragments(count) {
				const fragments = [];
				for (let i = 0; i < count; i++) {
					const node = document.createElement("div");
					const frag = new Fragment(node, 200, []);
					frag.constraints = {
						contentArea: { inlineSize: 816, blockSize: 1056 },
					};
					if (i < count - 1) {
						const bt = new BlockBreakToken(node);
						bt.consumedBlockSize = (i + 1) * 200;
						frag.breakToken = bt;
					}
					fragments.push(frag);
				}
				return fragments;
			}

			const flow = new FragmentationContext(makeFragments(2), null);
			const mapped = flow.map((el) => el?.tagName || "none");
			const isArray = Array.isArray(mapped);
			const isNotFragmentationContext = !(mapped instanceof FragmentationContext);
			return { isArray, isNotFragmentationContext };
		});

		expect(result.isArray).toBe(true);
		expect(result.isNotFragmentationContext).toBe(true);
	});
});

test.describe("Fragmenter iterator", () => {
	test("iterates fragments when content overflows", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:300px;margin:0;padding:0"></div>
        <div style="height:300px;margin:0;padding:0"></div>
      </div>`;

			const layout = new Fragmenter(template.content, { width: 600, height: 400 });
			const flow = layout.flow();
			const fragments = flow.fragments;

			const r = {
				lengthGte2: fragments.length >= 2,
				firstBlockSizeGt0: fragments[0].blockSize > 0,
				firstBreakTokenNotNull: fragments[0].breakToken !== null,
			};
			layout.destroy();
			return r;
		});

		expect(result.lengthGte2).toBe(true);
		expect(result.firstBlockSizeGt0).toBe(true);
		expect(result.firstBreakTokenNotNull).toBe(true);
	});

	test("last fragment has null breakToken", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:300px;margin:0;padding:0"></div>
        <div style="height:300px;margin:0;padding:0"></div>
      </div>`;

			const layout = new Fragmenter(template.content, { width: 600, height: 400 });
			const flow = layout.flow();
			const fragments = flow.fragments;
			const last = fragments[fragments.length - 1];
			const r = { lastBreakTokenNull: last.breakToken === null };
			layout.destroy();
			return r;
		});

		expect(result.lastBreakTokenNull).toBe(true);
	});

	test("for-of loop collects all elements", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
      </div>`;

			const layout = new Fragmenter(template.content, { width: 600, height: 300 });
			const elements = [];
			for (const el of layout) {
				elements.push(el.tagName);
			}
			layout.destroy();
			return { lengthGte2: elements.length >= 2 };
		});

		expect(result.lengthGte2).toBe(true);
	});

	test("next() returns done:true after exhaustion", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;

			const layout = new Fragmenter(template.content, { width: 600, height: 300 });
			const r1 = layout.next();
			const r1Done = r1.done;
			const r1HasValue = r1.value !== undefined;

			const r2 = layout.next();
			const r2Done = r2.done;
			const r2ValueUndefined = r2.value === undefined;

			layout.destroy();
			return { r1Done, r1HasValue, r2Done, r2ValueUndefined };
		});

		expect(result.r1Done).toBe(false);
		expect(result.r1HasValue).toBe(true);
		expect(result.r2Done).toBe(true);
		expect(result.r2ValueUndefined).toBe(true);
	});

	test("stopping early via break leaves content unfinished", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
      </div>`;

			const layout = new Fragmenter(template.content, { width: 600, height: 250 });
			const r = layout.next();
			// Don't call destroy — layout was only partially consumed (no flow() call)
			return { done: r.done };
		});

		expect(result.done).toBe(false);
	});

	test("next() resumes after iterator cleanup releases the measurer", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
        <div style="height:200px;margin:0;padding:0"></div>
      </div>`;

			const layout = new Fragmenter(template.content, { width: 600, height: 250 });
			const first = layout.next();
			layout.return();
			const second = layout.next();
			const r = {
				firstDone: first.done,
				secondDone: second.done,
				secondHasValue: second.value !== undefined,
			};
			layout.destroy();
			return r;
		});

		expect(result.firstDone).toBe(false);
		expect(result.secondDone).toBe(false);
		expect(result.secondHasValue).toBe(true);
	});
});

test.describe("Fragmenter.flow() (browser)", () => {
	test("fragments simple content across multiple fragmentainers", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { FragmentationContext } = await import("/src/fragmentation/fragmentation-context.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML =
				'<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>';
			const layout = new Fragmenter(template.content, {
				width: 400,
				height: 100,
			});
			const flow = layout.flow();
			const r = {
				isFragmentationContext: flow instanceof FragmentationContext,
				fragmentainerCountGte2: flow.fragmentainerCount >= 2,
				lengthMatchesCount: flow.length === flow.fragmentainerCount,
			};
			layout.destroy();
			return r;
		});

		expect(result.isFragmentationContext).toBe(true);
		expect(result.fragmentainerCountGte2).toBe(true);
		expect(result.lengthMatchesCount).toBe(true);
	});

	test("flow() with start/stop creates a subset of elements", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML =
				'<div style="margin:0; padding:0;"><div style="height: 400px; margin: 0;"></div></div>';
			const layout = new Fragmenter(template.content, {
				width: 400,
				height: 100,
			});
			const flow = layout.flow({ start: 1, stop: 3 });
			const r = {
				fragmentainerCountGte4: flow.fragmentainerCount >= 4,
				length: flow.length,
				firstIndex: flow[0].fragmentIndex,
				secondIndex: flow[1].fragmentIndex,
			};
			layout.destroy();
			return r;
		});

		expect(result.fragmentainerCountGte4).toBe(true);
		expect(result.length).toBe(2);
		expect(result.firstIndex).toBe(1);
		expect(result.secondIndex).toBe(2);
	});

	test("is directly iterable as an array of elements", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML =
				'<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>';
			const layout = new Fragmenter(template.content, {
				width: 400,
				height: 100,
			});
			const flow = layout.flow();
			const tags = [];
			for (const el of flow) {
				tags.push(el.tagName.toLowerCase());
			}
			layout.destroy();
			return { lengthGte2: flow.length >= 2, tags };
		});

		expect(result.lengthGte2).toBe(true);
		for (const tag of result.tags) {
			expect(tag).toBe("fragment-container");
		}
	});

	test("supports index access", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML =
				'<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>';
			const layout = new Fragmenter(template.content, {
				width: 400,
				height: 100,
			});
			const flow = layout.flow();
			const r = {
				tagName: flow[0].tagName.toLowerCase(),
				fragmentIndex: flow[0].fragmentIndex,
			};
			layout.destroy();
			return r;
		});

		expect(result.tagName).toBe("fragment-container");
		expect(result.fragmentIndex).toBe(0);
	});

	test("produces a single fragmentainer when content fits", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML =
				'<div style="margin:0; padding:0;"><div style="height: 50px; margin: 0;"></div></div>';
			const layout = new Fragmenter(template.content, {
				width: 400,
				height: 800,
			});
			const flow = layout.flow();
			const r = { fragmentainerCount: flow.fragmentainerCount };
			layout.destroy();
			return r;
		});

		expect(result.fragmentainerCount).toBe(1);
	});

	test("fragments text content across multiple pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="width: 200px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">${"word ".repeat(100)}</div>`;
			const layout = new Fragmenter(template.content, {
				width: 200,
				height: 60,
			});
			const flow = layout.flow();
			const r = { fragmentainerCountGt1: flow.fragmentainerCount > 1 };
			layout.destroy();
			return r;
		});

		expect(result.fragmentainerCountGt1).toBe(true);
	});

	test("produces fragments with correct structure", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML =
				'<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>';
			const layout = new Fragmenter(template.content, {
				width: 400,
				height: 100,
			});
			const flow = layout.flow();
			const fragments = flow.fragments;

			const first = fragments[0];
			const last = fragments[fragments.length - 1];
			const r = {
				lengthGte2: fragments.length >= 2,
				firstHasChildFragments: first.childFragments !== undefined,
				firstBlockSizeGt0: first.blockSize > 0,
				firstBreakTokenNotNull: first.breakToken !== null,
				lastBreakTokenNull: last.breakToken === null,
			};
			layout.destroy();
			return r;
		});

		expect(result.lengthGte2).toBe(true);
		expect(result.firstHasChildFragments).toBe(true);
		expect(result.firstBlockSizeGt0).toBe(true);
		expect(result.firstBreakTokenNotNull).toBe(true);
		expect(result.lastBreakTokenNull).toBe(true);
	});

	test("adds loading=lazy to images with width and height", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="100" height="100">
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="200" height="150">
      </div>`;
			const layout = new Fragmenter(template.content, {
				width: 400,
				height: 800,
			});
			const root = layout.contentRoot;
			const imgs = root.querySelectorAll("img");
			const loadingAttrs = Array.from(imgs).map((img) => img.getAttribute("loading"));
			layout.destroy();
			return { loadingAttrs };
		});

		for (const attr of result.loadingAttrs) {
			expect(attr).toBe("lazy");
		}
	});

	test("does not add loading=lazy to images missing width or height", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="100">
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" height="100">
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
      </div>`;
			const layout = new Fragmenter(template.content, {
				width: 400,
				height: 800,
			});
			const root = layout.contentRoot;
			const imgs = root.querySelectorAll("img");
			const hasLoading = Array.from(imgs).map((img) => img.hasAttribute("loading"));
			layout.destroy();
			return { hasLoading };
		});

		for (const has of result.hasLoading) {
			expect(has).toBe(false);
		}
	});

	test("does not wait for lazy-loaded images during setup", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin:0; padding:0;">
        <img src="http://192.0.2.1/hang.png" width="100" height="100">
        <div style="height: 50px; margin: 0;"></div>
      </div>`;
			const layout = new Fragmenter(template.content, {
				width: 400,
				height: 800,
			});
			const flow = layout.flow();
			const r = { fragmentainerCountGte1: flow.fragmentainerCount >= 1 };
			layout.destroy();
			return r;
		});

		expect(result.fragmentainerCountGte1).toBe(true);
	});

	test("accepts an Element and clones it into a DocumentFragment", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			await import("/src/components/fragment-container.js");

			const container = document.createElement("div");
			container.innerHTML =
				'<div style="margin:0; padding:0;"><div style="height: 200px; margin: 0;"></div></div>';
			document.body.appendChild(container);
			const el = container.firstElementChild;

			const layout = new Fragmenter(el, {
				width: 400,
				height: 100,
			});
			const flow = layout.flow();
			const fragmentainerCountGte2 = flow.fragmentainerCount >= 2;
			const originalStillInDom = container.firstElementChild === el;

			layout.destroy();
			container.remove();
			return { fragmentainerCountGte2, originalStillInDom };
		});

		expect(result.fragmentainerCountGte2).toBe(true);
		expect(result.originalStillInDom).toBe(true);
	});
});

test.describe("namedPage property", () => {
	test("fragment-container has a namedPage property", async ({ page }) => {
		const result = await page.evaluate(async () => {
			await import("/src/components/fragment-container.js");

			const el = document.createElement("fragment-container");
			const initialNull = el.namedPage === null;
			el.namedPage = "chapter";
			const afterSet = el.namedPage;
			el.namedPage = null;
			const afterReset = el.namedPage;
			return { initialNull, afterSet, afterReset };
		});

		expect(result.initialNull).toBe(true);
		expect(result.afterSet).toBe("chapter");
		expect(result.afterReset).toBeNull();
	});

	test("sets namedPage property from fragment constraints", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentationContext } = await import("/src/fragmentation/fragmentation-context.js");
			const { Fragment } = await import("/src/fragmentation/fragment.js");
			await import("/src/components/fragment-container.js");

			const size = { inlineSize: 400, blockSize: 800 };
			const contentStyles = {
				sheets: [],
				nthDescriptors: [],
				sourceRefs: null,
				refMap: null,
			};

			const frag1 = new Fragment(null, 0);
			frag1.constraints = { contentArea: size, namedPage: "cover" };
			const frag2 = new Fragment(null, 0);
			frag2.constraints = { contentArea: size, namedPage: "chapter" };
			const frag3 = new Fragment(null, 0);
			frag3.constraints = { contentArea: size, namedPage: null };
			const fragments = [frag1, frag2, frag3];

			const flow = new FragmentationContext(fragments, contentStyles);
			const namedPages = [];
			for (let i = 0; i < fragments.length; i++) {
				const el = flow.createFragmentainer(i);
				namedPages.push(el.namedPage);
			}
			return { namedPages };
		});

		expect(result.namedPages[0]).toBe("cover");
		expect(result.namedPages[1]).toBe("chapter");
		expect(result.namedPages[2]).toBeNull();
	});
});

test.describe("Continuation", () => {
	test("resumes at a block offset inside a numbered fragmentainer", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const space = () =>
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 1000,
					fragmentainerBlockSize: 1000,
					fragmentationType: "page",
				});
			const tree = (count) =>
				blockNode({
					children: Array.from({ length: count }, () => blockNode({ blockSize: 300 })),
				});

			// 400px already used, so only 600 of the first fragmentainer is left.
			const partial = createFragments(tree(3), space(), {
				fragmentainerIndex: 2,
				blockOffset: 400,
			});
			// Two children fill the remaining 600 exactly, and the run ends there.
			const exact = createFragments(tree(2), space(), { fragmentainerIndex: 2, blockOffset: 400 });

			return {
				partialSizes: partial.fragments.map((f) => f.blockSize),
				partialContinuation: partial.continuation,
				exactSizes: exact.fragments.map((f) => f.blockSize),
				exactContinuation: exact.continuation,
			};
		});

		expect(result.partialSizes).toEqual([600, 300]);
		expect(result.partialContinuation).toEqual({ fragmentainerIndex: 3, blockOffset: 300 });
		expect(result.exactSizes).toEqual([600]);
		expect(result.exactContinuation).toEqual({ fragmentainerIndex: 3, blockOffset: 0 });
	});

	test("reflow re-applies the handover offset", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const flow = new Fragmenter(
				blockNode({
					children: Array.from({ length: 3 }, () => blockNode({ blockSize: 300 })),
				}),
				{
					constraintSpace: new ConstraintSpace({
						availableInlineSize: 600,
						availableBlockSize: 1000,
						fragmentainerBlockSize: 1000,
						fragmentationType: "page",
					}),
					continuation: { fragmentainerIndex: 5, blockOffset: 400 },
				},
			);

			const initial = flow.flow().fragments.map((f) => f.blockSize);
			const initialContinuation = flow.continuation;
			// fromIndex is an absolute fragmentainer index, so 5 is the start of
			// the run and 6 is its second fragmentainer.
			const fromStart = flow.reflow(5).fragments.map((f) => f.blockSize);
			const fromStartContinuation = flow.continuation;
			const fromSecond = flow.reflow(6).fragments.map((f) => f.blockSize);
			const fromSecondContinuation = flow.continuation;

			return {
				initial,
				initialContinuation,
				fromStart,
				fromStartContinuation,
				fromSecond,
				fromSecondContinuation,
			};
		});

		expect(result.initial).toEqual([600, 300]);
		expect(result.initialContinuation).toEqual({ fragmentainerIndex: 6, blockOffset: 300 });
		expect(result.fromStart).toEqual([600, 300]);
		expect(result.fromStartContinuation).toEqual({ fragmentainerIndex: 6, blockOffset: 300 });
		expect(result.fromSecond).toEqual([300]);
		expect(result.fromSecondContinuation).toEqual({ fragmentainerIndex: 6, blockOffset: 300 });
	});

	test("returns a bare Fragment array when no continuation is given", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");

			const fragments = createFragments(
				blockNode({ children: [blockNode({ blockSize: 300 })] }),
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 1000,
					fragmentainerBlockSize: 1000,
					fragmentationType: "page",
				}),
			);
			return { isArray: Array.isArray(fragments), sizes: fragments.map((f) => f.blockSize) };
		});

		expect(result.isArray).toBe(true);
		expect(result.sizes).toEqual([300]);
	});
});
