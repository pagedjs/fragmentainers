import { test, expect } from "../browser-fixture.js";

test.describe("LayoutHandler.afterCompose", () => {
	test("runs in handler order after normal fragment composition is complete", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentationContext, Fragment } = await import("/src/fragmentation/index.js");
			const { HandlerRegistry, LayoutHandler } = await import("/src/handlers/index.js");

			const calls = [];
			let expectedFragment;
			class FirstHandler extends LayoutHandler {
				afterCompose(element, fragment) {
					calls.push({
						name: "first",
						fragmentMatches: fragment === expectedFragment,
						fragmentIndex: element.fragmentIndex,
						namedPage: element.namedPage,
						hasFirst: element.hasAttribute("data-first"),
						hasLast: element.hasAttribute("data-last"),
							afterRenderVisible: element.hasAttribute("data-after-render"),
							contentVisible: element.querySelector("span")?.textContent,
							width: element.style.width,
							height: element.style.height,
							constraintBlockSize: element.constraints.contentArea.blockSize,
					});
					element.setAttribute("data-first-handler", "");
				}
			}
			class SecondHandler extends LayoutHandler {
				afterCompose(element, fragment) {
					calls.push({
						name: "second",
						fragmentMatches: fragment === expectedFragment,
						firstHandlerVisible: element.hasAttribute("data-first-handler"),
					});
				}
			}

			const handlers = new HandlerRegistry([FirstHandler, SecondHandler]);
			handlers.init();
			const fragment = new Fragment(null, 0);
			expectedFragment = fragment;
			fragment.constraints = {
				contentArea: { inlineSize: 320, blockSize: 480 },
				namedPage: "chapter",
			};
			fragment.isFirst = true;
			fragment.isLast = true;
			fragment.afterRender = [
				(element) => {
					const child = document.createElement("span");
					child.textContent = "composed";
					element.appendChild(child);
					element.setAttribute("data-after-render", "");
				},
			];

			const context = new FragmentationContext([fragment], { sheets: [] }, { handlers });
			return { calls, contextLength: context.length };
		});

		expect(result.contextLength).toBe(1);
		expect(result.calls).toEqual([
			{
				name: "first",
				fragmentMatches: true,
				fragmentIndex: 0,
				namedPage: "chapter",
				hasFirst: true,
				hasLast: true,
				afterRenderVisible: true,
				contentVisible: "composed",
				width: "320px",
				height: "480px",
				constraintBlockSize: 480,
			},
			{
				name: "second",
				fragmentMatches: true,
				firstHandlerVisible: true,
			},
		]);
	});

	test("runs exactly once for a blank fragmentainer after blank state is installed", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { FragmentationContext, Fragment } = await import("/src/fragmentation/index.js");
			const { HandlerRegistry, LayoutHandler } = await import("/src/handlers/index.js");

			const calls = [];
			class BlankHandler extends LayoutHandler {
				afterCompose(element, fragment) {
					calls.push({
							isBlankFragment: fragment.isBlank,
							hasBlankAttribute: element.hasAttribute("data-blank-page"),
							width: element.style.width,
							height: element.style.height,
							constraintBlockSize: element.constraints.contentArea.blockSize,
						childCount: element.childNodes.length,
					});
				}
			}

			const handlers = new HandlerRegistry([BlankHandler]);
			handlers.init();
			const fragment = new Fragment(null, 0);
			fragment.constraints = {
				contentArea: { inlineSize: 320, blockSize: 480 },
				namedPage: null,
			};
			fragment.isBlank = true;

			const context = new FragmentationContext([fragment], { sheets: [] }, { handlers });
			return { calls, contextLength: context.length };
		});

		expect(result.contextLength).toBe(1);
		expect(result.calls).toEqual([
			{
				isBlankFragment: true,
				hasBlankAttribute: true,
				width: "320px",
				height: "480px",
				constraintBlockSize: 480,
				childCount: 0,
			},
		]);
	});

	test("uses the flow's handler instances for normal and blank pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Fragmenter } = await import("/src/fragmentation/fragmenter.js");
			const { LayoutHandler } = await import("/src/handlers/handler.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");

			const calls = [];
			class ComposeProbe extends LayoutHandler {
				afterCompose(element, fragment) {
					calls.push({
						blank: fragment.isBlank,
						blankAttribute: element.hasAttribute("data-blank-page"),
						fragmentIndex: element.fragmentIndex,
					});
				}
			}

			const originalHandlers = Fragmenter.handlers;
			Fragmenter.handlers = [...originalHandlers, ComposeProbe];
			let layout;
			try {
				const template = document.createElement("template");
				template.innerHTML = `<div style="height:50px;margin:0"></div>
					<div style="height:50px;margin:0;break-before:right"></div>`;
				layout = new Fragmenter(template.content, {
					resolver: new PageResolver([], { inlineSize: 300, blockSize: 100 }),
				});
				const context = layout.flow();
				return { calls, pageCount: context.length };
			} finally {
				layout?.destroy();
				Fragmenter.handlers = originalHandlers;
			}
		});

		expect(result.pageCount).toBe(3);
		expect(result.calls).toEqual([
			{ blank: false, blankAttribute: false, fragmentIndex: 0 },
			{ blank: true, blankAttribute: true, fragmentIndex: 1 },
			{ blank: false, blankAttribute: false, fragmentIndex: 2 },
		]);
	});
});
