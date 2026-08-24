import { test, expect } from "../browser-fixture.js";

test.describe("Fragmenter layout passes", () => {
	test("streams ordinary flows but buffers registered flows before yielding", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { LayoutHandler } = await import("/src/handlers/handler.js");

			class PassProbe extends LayoutHandler {
				init(options, context) {
					this.context = context;
					this.laidOut = 0;
					this.afterPass = 0;
					this.composed = 0;
				}

				matchRule(rule) {
					if (rule.style.getPropertyValue("--test-layout-pass")) {
						this.context.flow.registerLayoutPass(2);
					}
				}

				afterContentLayout() {
					this.laidOut++;
					return null;
				}

				afterLayoutPass() {
					this.afterPass++;
					return null;
				}

				afterCompose() {
					this.composed++;
				}
			}

			const content = () => {
				const template = document.createElement("template");
				template.innerHTML = `<div class="deferred" style="margin:0;padding:0">
					<div style="height:100px">A</div>
					<div style="height:100px">B</div>
					<div style="height:100px">C</div>
				</div>`;
				return template.content;
			};
			const ordinarySheet = new CSSStyleSheet();
			ordinarySheet.replaceSync(".deferred { color: black; }");
			const registeredSheet = new CSSStyleSheet();
			registeredSheet.replaceSync(".deferred { --test-layout-pass: registered; }");

			const originalHandlers = Fragmenter.handlers;
			Fragmenter.handlers = [...originalHandlers, PassProbe];
			let ordinary;
			let registered;
			let direct;
			try {
				ordinary = new Fragmenter(content(), {
					width: 300,
					height: 100,
					styles: [ordinarySheet],
				});
				const ordinaryFirst = ordinary.next();
				const ordinaryProbe = ordinary.handlers.get(PassProbe);

				registered = new Fragmenter(content(), {
					width: 300,
					height: 100,
					styles: [registeredSheet],
				});
				const registeredFirst = registered.next();
				const registeredProbe = registered.handlers.get(PassProbe);
				const bufferedState = {
					laidOut: registeredProbe.laidOut,
					afterPass: registeredProbe.afterPass,
					composed: registeredProbe.composed,
				};
				const remaining = [registered.next(), registered.next(), registered.next()];

				direct = new Fragmenter(content(), {
					width: 300,
					height: 100,
					styles: [ordinarySheet],
				});
				direct.registerLayoutPass(1);
				const directFirst = direct.next();
				const directProbe = direct.handlers.get(PassProbe);

				return {
					ordinary: {
						index: ordinaryFirst.value.fragmentIndex,
						done: ordinaryFirst.done,
						laidOut: ordinaryProbe.laidOut,
						afterPass: ordinaryProbe.afterPass,
						composed: ordinaryProbe.composed,
					},
					registered: {
						firstIndex: registeredFirst.value.fragmentIndex,
						firstDone: registeredFirst.done,
						bufferedState,
						remaining: remaining.map((entry) => ({
							index: entry.value?.fragmentIndex ?? null,
							done: entry.done,
						})),
					},
					direct: {
						firstIndex: directFirst.value.fragmentIndex,
						laidOut: directProbe.laidOut,
						afterPass: directProbe.afterPass,
						composed: directProbe.composed,
					},
				};
			} finally {
				ordinary?.destroy();
				registered?.destroy();
				direct?.destroy();
				Fragmenter.handlers = originalHandlers;
			}
		});

		expect(result.ordinary).toEqual({
			index: 0,
			done: false,
			laidOut: 1,
			afterPass: 0,
			composed: 1,
		});
		expect(result.registered).toEqual({
			firstIndex: 0,
			firstDone: false,
			bufferedState: { laidOut: 3, afterPass: 1, composed: 3 },
			remaining: [
				{ index: 1, done: false },
				{ index: 2, done: false },
				{ index: null, done: true },
			],
		});
		expect(result.direct).toEqual({
			firstIndex: 0,
			laidOut: 3,
			afterPass: 1,
			composed: 3,
		});
	});

	test("revalidates only an invalidated fragment when its boundary is unchanged", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { LayoutHandler } = await import("/src/handlers/handler.js");

			const hooks = [];
			let initialFragments;
			let identity;
			let layoutCount = 0;
			class EqualBoundary extends LayoutHandler {
				init(options, context) {
					this.context = context;
				}

				matchRule(rule) {
					if (rule.style.getPropertyValue("--test-layout-pass")) {
						this.context.flow.registerLayoutPass(2);
					}
				}

				afterMeasurementSetup(root, context) {
					this.target = root.querySelector("#target");
					hooks.push({ hook: "measure", ...context });
				}

				beforeLayoutPass(context) {
					hooks.push({ hook: "before", pass: context.pass, fromIndex: context.fromIndex });
				}

				afterContentLayout() {
					layoutCount++;
					return null;
				}

				afterLayoutPass(context) {
					const locations = context.locate(this.target).map(({ index, isContinuation }) => ({
						index,
						isContinuation,
					}));
					hooks.push({
						hook: "after",
						pass: context.pass,
						fromIndex: context.fromIndex,
						locations,
					});
					if (context.pass === 0) {
						initialFragments = [...context.fragments];
						this.target.style.setProperty("--resolved-value", "1");
						return { invalidate: [this.target] };
					}
					identity = context.fragments.map(
						(fragment, index) => fragment === initialFragments[index],
					);
					return null;
				}
			}

			const makeContent = () => {
				const template = document.createElement("template");
				template.innerHTML = `<div style="margin:0;padding:0">
					<div style="height:100px">A</div>
					<div id="target" class="deferred" style="height:100px">B</div>
					<div style="height:100px">C</div>
				</div>`;
				return template.content;
			};
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(".deferred { --test-layout-pass: equal; }");
			const signature = (context) => ({
				blockSizes: context.fragments.map((fragment) => fragment.blockSize),
				text: context.map((element) => element.textContent.trim()),
			});

			const originalHandlers = Fragmenter.handlers;
			Fragmenter.handlers = [...originalHandlers, EqualBoundary];
			let layout;
			let fresh;
			try {
				layout = new Fragmenter(makeContent(), {
					width: 300,
					height: 100,
					styles: [sheet],
				});
				const settled = layout.flow();
				const settledSignature = signature(settled);
				layout.destroy();
				layout = null;

				Fragmenter.handlers = originalHandlers;
				fresh = new Fragmenter(makeContent(), {
					width: 300,
					height: 100,
					styles: [sheet],
				});
				const freshSignature = signature(fresh.flow());
				return { hooks, identity, layoutCount, settledSignature, freshSignature };
			} finally {
				layout?.destroy();
				fresh?.destroy();
				Fragmenter.handlers = originalHandlers;
			}
		});

		expect(result.hooks).toEqual([
			{ hook: "measure", pass: 0, segment: 0 },
			{
				hook: "after",
				pass: 0,
				fromIndex: 0,
				locations: [{ index: 1, isContinuation: false }],
			},
			{ hook: "before", pass: 1, fromIndex: 1 },
			{
				hook: "after",
				pass: 1,
				fromIndex: 1,
				locations: [{ index: 1, isContinuation: false }],
			},
		]);
		expect(result.identity).toEqual([true, false, true]);
		expect(result.layoutCount).toBe(4);
		expect(result.settledSignature).toEqual(result.freshSignature);
	});

	test("reruns the invalidated tail when a fragment boundary moves", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { LayoutHandler } = await import("/src/handlers/handler.js");

			const hooks = [];
			let initialFragments;
			let identity;
			class MovingBoundary extends LayoutHandler {
				init(options, context) {
					this.context = context;
				}

				matchRule(rule) {
					if (rule.style.getPropertyValue("--test-layout-pass")) {
						this.context.flow.registerLayoutPass(2);
					}
				}

				afterMeasurementSetup(root) {
					this.target = root.querySelector("#target");
				}

				beforeLayoutPass(context) {
					hooks.push({ hook: "before", pass: context.pass, fromIndex: context.fromIndex });
				}

				afterLayoutPass(context) {
					hooks.push({ hook: "after", pass: context.pass, fromIndex: context.fromIndex });
					if (context.pass === 0) {
						initialFragments = [...context.fragments];
						this.target.style.setProperty("--resolved-height", "100px");
						return { invalidate: [this.target] };
					}
					identity = context.fragments.map(
						(fragment, index) => fragment === initialFragments[index],
					);
					return null;
				}
			}

			const makeContent = (resolved = false) => {
				const template = document.createElement("template");
				template.innerHTML = `<div style="margin:0;padding:0">
					<div style="height:100px">A</div>
					<div id="target" class="deferred" style="${resolved ? "--resolved-height:100px" : ""}">B</div>
					<div style="height:50px">C</div>
					<div style="height:100px">D</div>
				</div>`;
				return template.content;
			};
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(`.deferred {
				height: var(--resolved-height, 50px);
				--test-layout-pass: moving;
			}`);
			const signature = (context) => ({
				blockSizes: context.fragments.map((fragment) => fragment.blockSize),
				text: context.map((element) => element.textContent.trim()),
			});

			const originalHandlers = Fragmenter.handlers;
			Fragmenter.handlers = [...originalHandlers, MovingBoundary];
			let layout;
			let fresh;
			try {
				layout = new Fragmenter(makeContent(), {
					width: 300,
					height: 100,
					styles: [sheet],
				});
				const settled = layout.flow();
				const settledSignature = signature(settled);
				layout.destroy();
				layout = null;

				Fragmenter.handlers = originalHandlers;
				fresh = new Fragmenter(makeContent(true), {
					width: 300,
					height: 100,
					styles: [sheet],
				});
				const freshSignature = signature(fresh.flow());
				return { hooks, identity, settledSignature, freshSignature };
			} finally {
				layout?.destroy();
				fresh?.destroy();
				Fragmenter.handlers = originalHandlers;
			}
		});

		expect(result.hooks).toEqual([
			{ hook: "after", pass: 0, fromIndex: 0 },
			{ hook: "before", pass: 1, fromIndex: 1 },
			{ hook: "after", pass: 1, fromIndex: 1 },
		]);
		expect(result.identity).toEqual([true, false, false, false]);
		expect(result.settledSignature).toEqual(result.freshSignature);
	});

	test("rebuilds from zero and reports the new pass during measurement setup", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { LayoutHandler } = await import("/src/handlers/handler.js");

			const hooks = [];
			let requestedRebuild = false;
			class RebuildPass extends LayoutHandler {
				init(options, context) {
					this.context = context;
				}

				matchRule(rule) {
					if (rule.style.getPropertyValue("--test-layout-pass")) {
						this.context.flow.registerLayoutPass(2);
					}
				}

				afterMeasurementSetup(root, context) {
					this.root = root;
					hooks.push({ hook: "measure", ...context });
				}

				beforeLayoutPass(context) {
					hooks.push({ hook: "before", pass: context.pass, fromIndex: context.fromIndex });
				}

				afterLayoutPass(context) {
					hooks.push({ hook: "after", pass: context.pass, fromIndex: context.fromIndex });
					if (!requestedRebuild) {
						requestedRebuild = true;
						const added = document.createElement("div");
						added.id = "added";
						added.style.height = "100px";
						added.textContent = "C";
						this.root.querySelector("#content").appendChild(added);
						return { rebuild: true };
					}
					return null;
				}
			}

			const content = (includeAdded = false) => {
				const template = document.createElement("template");
				template.innerHTML = `<div id="content" class="deferred" style="margin:0;padding:0">
					<div style="height:100px">A</div>
					<div style="height:100px">B</div>
					${includeAdded ? '<div id="added" style="height:100px">C</div>' : ""}
				</div>`;
				return template.content;
			};
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(`
				.deferred { --test-layout-pass: rebuild; }
				.deferred::before { content: ""; }
			`);
			const styles = [sheet];
			const signature = (context) => ({
				blockSizes: context.fragments.map((fragment) => fragment.blockSize),
				text: context.map((element) => element.textContent.trim()),
			});

			const originalHandlers = Fragmenter.handlers;
			Fragmenter.handlers = [...originalHandlers, RebuildPass];
			let layout;
			let fresh;
			try {
				layout = new Fragmenter(content(), {
					width: 300,
					height: 100,
					styles,
				});
				const settled = layout.flow();
				const settledSignature = signature(settled);
				layout.destroy();
				layout = null;

				Fragmenter.handlers = originalHandlers;
				fresh = new Fragmenter(content(true), {
					width: 300,
					height: 100,
					styles: [sheet],
				});
				const freshSignature = signature(fresh.flow());
				return { hooks, settledSignature, freshSignature, styleCount: styles.length };
			} finally {
				layout?.destroy();
				fresh?.destroy();
				Fragmenter.handlers = originalHandlers;
			}
		});

		expect(result.hooks).toEqual([
			{ hook: "measure", pass: 0, segment: 0 },
			{ hook: "after", pass: 0, fromIndex: 0 },
			{ hook: "before", pass: 1, fromIndex: 0 },
			{ hook: "measure", pass: 1, segment: 0 },
			{ hook: "after", pass: 1, fromIndex: 0 },
		]);
		expect(result.settledSignature).toEqual(result.freshSignature);
		expect(result.styleCount).toBe(2);
	});

	test("accepts the last layout when a registered handler accepts its pass limit", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { LayoutHandler } = await import("/src/handlers/handler.js");

			const passes = [];
			const limits = [];
			class AcceptedPass extends LayoutHandler {
				init(options, context) {
					this.context = context;
				}

				matchRule(rule) {
					if (rule.style.getPropertyValue("--test-layout-pass")) {
						this.context.flow.registerLayoutPass(1);
					}
				}

				afterMeasurementSetup(root) {
					this.target = root.querySelector("#target");
				}

				afterLayoutPass(context) {
					passes.push(context.pass);
					this.target.toggleAttribute("data-changing");
					return { invalidate: [this.target] };
				}

				onPassLimit(context) {
					limits.push({
						pass: context.pass,
						locations: context.locate(this.target).map(({ index }) => index),
					});
					return { accept: true, reason: "test accepts the last layout" };
				}
			}

			const template = document.createElement("template");
			template.innerHTML = `<div class="deferred" style="margin:0;padding:0">
				<div id="target" style="height:100px">A</div>
				<div style="height:100px">B</div>
			</div>`;
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(".deferred { --test-layout-pass: accepted; }");

			const originalHandlers = Fragmenter.handlers;
			Fragmenter.handlers = [...originalHandlers, AcceptedPass];
			let layout;
			try {
				layout = new Fragmenter(template.content, {
					width: 300,
					height: 100,
					styles: [sheet],
				});
				const context = layout.flow();
				return {
					passes,
					limits,
					blockSizes: context.fragments.map((fragment) => fragment.blockSize),
				};
			} finally {
				layout?.destroy();
				Fragmenter.handlers = originalHandlers;
			}
		});

		expect(result).toEqual({
			passes: [0, 1],
			limits: [{ pass: 1, locations: [0] }],
			blockSizes: [100, 100],
		});
	});

	test("throws LayoutPassLimitError when no registered handler accepts the limit", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter, LayoutPassLimitError } = await import(
				"/src/fragmentation/fragmenter.js"
			);
			const { LayoutHandler } = await import("/src/handlers/handler.js");

			class RejectedPass extends LayoutHandler {
				init(options, context) {
					this.context = context;
				}

				matchRule(rule) {
					if (rule.style.getPropertyValue("--test-layout-pass")) {
						this.context.flow.registerLayoutPass(1);
					}
				}

				afterMeasurementSetup(root) {
					this.target = root.querySelector("#changing-target");
				}

				afterLayoutPass() {
					this.target.toggleAttribute("data-changing");
					return { invalidate: [this.target] };
				}
			}

			const template = document.createElement("template");
			template.innerHTML = `<div class="deferred" style="margin:0;padding:0">
				<div id="changing-target" style="height:100px">A</div>
			</div>`;
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(".deferred { --test-layout-pass: rejected; }");

			const originalHandlers = Fragmenter.handlers;
			Fragmenter.handlers = [...originalHandlers, RejectedPass];
			let layout;
			try {
				layout = new Fragmenter(template.content, {
					width: 300,
					height: 100,
					styles: [sheet],
				});
				try {
					layout.flow();
					return { threw: false };
				} catch (error) {
					return {
						threw: true,
						isLimitError: error instanceof LayoutPassLimitError,
						name: error.name,
						message: error.message,
					};
				}
			} finally {
				layout?.destroy();
				Fragmenter.handlers = originalHandlers;
			}
		});

		expect(result.threw).toBe(true);
		expect(result.isLimitError).toBe(true);
		expect(result.name).toBe("LayoutPassLimitError");
		expect(result.message).toContain("RejectedPass");
		expect(result.message).toContain("changing-target");
	});

	test("public reflow re-enters the registered pass loop", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { LayoutHandler } = await import("/src/handlers/handler.js");

			const hooks = [];
			class ReflowPass extends LayoutHandler {
				init(options, context) {
					this.context = context;
				}

				matchRule(rule) {
					if (rule.style.getPropertyValue("--test-layout-pass")) {
						this.context.flow.registerLayoutPass(2);
					}
				}

				afterMeasurementSetup(root) {
					this.target = root.querySelector("#target");
				}

				beforeLayoutPass(context) {
					hooks.push({ hook: "before", pass: context.pass, fromIndex: context.fromIndex });
				}

				afterLayoutPass(context) {
					hooks.push({ hook: "after", pass: context.pass, fromIndex: context.fromIndex });
					if (context.pass === 0) {
						this.target.toggleAttribute("data-resolved");
						return { invalidate: [this.target] };
					}
					return null;
				}
			}

			const template = document.createElement("template");
			template.innerHTML = `<div class="deferred" style="margin:0;padding:0">
				<div style="height:100px">A</div>
				<div id="target" style="height:100px">B</div>
				<div style="height:100px">C</div>
			</div>`;
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(".deferred { --test-layout-pass: reflow; }");

			const originalHandlers = Fragmenter.handlers;
			Fragmenter.handlers = [...originalHandlers, ReflowPass];
			let layout;
			try {
				layout = new Fragmenter(template.content, {
					width: 300,
					height: 100,
					styles: [sheet],
				});
				const initial = layout.flow();
				const reflowed = layout.reflow(0);
				return {
					hooks,
					initial: initial.fragments.map((fragment) => fragment.blockSize),
					reflowed: reflowed.fragments.map((fragment) => fragment.blockSize),
				};
			} finally {
				layout?.destroy();
				Fragmenter.handlers = originalHandlers;
			}
		});

		expect(result.hooks).toEqual([
			{ hook: "after", pass: 0, fromIndex: 0 },
			{ hook: "before", pass: 1, fromIndex: 1 },
			{ hook: "after", pass: 1, fromIndex: 1 },
			{ hook: "after", pass: 0, fromIndex: 0 },
			{ hook: "before", pass: 1, fromIndex: 1 },
			{ hook: "after", pass: 1, fromIndex: 1 },
		]);
		expect(result.initial).toEqual([100, 100, 100]);
		expect(result.reflowed).toEqual(result.initial);
	});
});
