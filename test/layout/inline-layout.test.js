import { test, expect } from "../browser-fixture.js";

test.describe("Inline content layout (browser)", () => {
	test("lays out inline content that fits on one page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position: absolute; left: -9999px; top: 0;";
			document.body.appendChild(container);

			container.innerHTML =
				'<p style="width: 400px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">Hello world</p>';
			const p = container.querySelector("p");
			const root = new DOMLayoutNode(p);

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 800,
					fragmentainerBlockSize: 800,
					fragmentationType: "page",
				}),
			);

			container.remove();

			return {
				pageCount: pages.length,
				firstBreakToken: pages[0].breakToken,
			};
		});

		expect(result.pageCount).toBe(1);
		expect(result.firstBreakToken).toBe(null);
	});

	test("breaks text across multiple lines", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position: absolute; left: -9999px; top: 0;";
			document.body.appendChild(container);

			const text = Array.from({ length: 20 }, () => "word").join(" ");
			container.innerHTML = `<p style="width: 100px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">${text}</p>`;
			const p = container.querySelector("p");
			const root = new DOMLayoutNode(p);

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 100,
					availableBlockSize: 800,
					fragmentainerBlockSize: 800,
					fragmentationType: "page",
				}),
			);

			container.remove();

			return {
				pageCount: pages.length,
				childFragmentCount: pages[0].childFragments[0].childFragments.length,
			};
		});

		expect(result.pageCount).toBe(1);
		expect(result.childFragmentCount).toBeGreaterThan(1);
	});

	test("fragments inline content across pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position: absolute; left: -9999px; top: 0;";
			document.body.appendChild(container);

			const text = Array.from({ length: 80 }, () => "word").join(" ");
			container.innerHTML = `<p style="width: 200px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">${text}</p>`;
			const p = container.querySelector("p");
			const root = new DOMLayoutNode(p);

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 200,
					availableBlockSize: 60,
					fragmentainerBlockSize: 60,
					fragmentationType: "page",
				}),
			);

			container.remove();

			return {
				pageCount: pages.length,
				firstBreakTokenTruthy: !!pages[0].breakToken,
				lastBreakToken: pages[pages.length - 1].breakToken,
			};
		});

		expect(result.pageCount).toBeGreaterThan(1);
		expect(result.firstBreakTokenTruthy).toBe(true);
		expect(result.lastBreakToken).toBe(null);
	});

	test("InlineBreakToken has content-addressed position", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { BREAK_TOKEN_INLINE } = await import("/src/fragmentation/tokens.js");

			const container = document.createElement("div");
			container.style.cssText = "position: absolute; left: -9999px; top: 0;";
			document.body.appendChild(container);

			const text = Array.from({ length: 80 }, () => "test").join(" ");
			container.innerHTML = `<p style="width: 200px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">${text}</p>`;
			const p = container.querySelector("p");
			const root = new DOMLayoutNode(p);

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 200,
					availableBlockSize: 60,
					fragmentainerBlockSize: 60,
					fragmentationType: "page",
				}),
			);

			container.remove();

			const breakToken = pages[0].breakToken?.childBreakTokens[0];
			return {
				pageCount: pages.length,
				breakTokenTruthy: !!breakToken,
				breakTokenType: breakToken ? breakToken.type : null,
				breakTokenTextOffset: breakToken ? breakToken.textOffset : null,
				BREAK_TOKEN_INLINE,
			};
		});

		expect(result.pageCount).toBeGreaterThan(1);
		expect(result.breakTokenTruthy).toBe(true);
		expect(result.breakTokenType).toBe(result.BREAK_TOKEN_INLINE);
		expect(result.breakTokenTextOffset).toBeGreaterThan(0);
	});

	test("handles forced line break with <br>", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position: absolute; left: -9999px; top: 0;";
			document.body.appendChild(container);

			container.innerHTML =
				'<p style="width: 400px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">Line one<br>Line two<br>Line three</p>';
			const p = container.querySelector("p");
			const root = new DOMLayoutNode(p);

			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 800,
					fragmentainerBlockSize: 800,
					fragmentationType: "page",
				}),
			);

			container.remove();

			return {
				pageCount: pages.length,
				childFragmentCount: pages[0].childFragments[0].childFragments.length,
			};
		});

		expect(result.pageCount).toBe(1);
		expect(result.childFragmentCount).toBe(3);
	});

	test("counts line boxes independently of Range ink height", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position: absolute; left: -9999px; top: 0;";
			container.innerHTML = `
				<p class="leading" style="font:16px monospace;line-height:100px;margin:0">a<br>b<br>c</p>
				<p class="breaks" style="font:16px monospace;line-height:20px;margin:0"><br><br></p>
				<p class="nested" style="font:16px monospace;line-height:20px;margin:0"><span>a<br>b<br>c</span></p>`;
			document.body.appendChild(container);

			const describe = (element) => {
				const fragments = createFragments(
					new DOMLayoutNode(element),
					new ConstraintSpace({
						availableInlineSize: 400,
						availableBlockSize: 400,
						fragmentainerBlockSize: 400,
						fragmentationType: "page",
					}),
				);
				return {
					blockSize: fragments[0].blockSize,
					lineCount: fragments[0].childFragments[0].childFragments.length,
					domHeight: element.getBoundingClientRect().height,
				};
			};
			const out = {
				leading: describe(container.querySelector(".leading")),
				breaks: describe(container.querySelector(".breaks")),
				nested: describe(container.querySelector(".nested")),
			};
			container.remove();
			return out;
		});

		expect(result.leading).toEqual({ blockSize: 300, lineCount: 3, domHeight: 300 });
		expect(result.breaks).toEqual({ blockSize: 40, lineCount: 2, domHeight: 40 });
		expect(result.nested).toEqual({ blockSize: 60, lineCount: 3, domHeight: 60 });
	});

	test("varying inline size between pages changes line breaks", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position: absolute; left: -9999px; top: 0;";
			document.body.appendChild(container);

			const text = Array.from({ length: 40 }, () => "word").join(" ");
			container.innerHTML = `<p style="width: 100px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">${text}</p>`;
			const p = container.querySelector("p");
			const root = new DOMLayoutNode(p);

			const pages = createFragments(root, {
				resolve: (index) => {
					const sizes = [
						{ inlineSize: 100, blockSize: 60 },
						{ inlineSize: 400, blockSize: 400 },
					];
					const size = sizes[index] || sizes.at(-1);
					return {
						toConstraintSpace: () =>
							new ConstraintSpace({
								availableInlineSize: size.inlineSize,
								availableBlockSize: size.blockSize,
								fragmentainerBlockSize: size.blockSize,
								fragmentationType: "page",
							}),
					};
				},
			});

			container.remove();

			return {
				pageCount: pages.length,
				firstPageChildCount: pages[0].childFragments.length,
			};
		});

		expect(result.pageCount).toBeGreaterThanOrEqual(2);
		expect(result.firstPageChildCount).toBeGreaterThan(0);
	});

	test("respects explicit CSS height on a monolithic IFC element", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:400px";
			container.innerHTML = `
				<div>
					<h3 style="height:200px;overflow:hidden;margin:0;padding:0;font:16px/18px monospace">Short</h3>
				</div>
			`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 800,
					fragmentainerBlockSize: 800,
					fragmentationType: "page",
				}),
			);

			const out = {
				pageCount: pages.length,
				h3BlockSize: pages[0].childFragments[0]?.blockSize,
			};
			container.remove();
			return out;
		});

		expect(result.pageCount).toBe(1);
		expect(result.h3BlockSize).toBe(200);
	});

	test("monolithic explicit-height IFC element breaks across fragmentainers", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:400px";
			container.innerHTML = `
				<div>
					<div style="height:150px;overflow:hidden;margin:0;padding:0"></div>
					<h3 style="height:200px;overflow:hidden;margin:0;padding:0;font:16px/18px monospace">Short</h3>
					<div style="height:100px;overflow:hidden;margin:0;padding:0"></div>
				</div>
			`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 300,
					fragmentainerBlockSize: 300,
					fragmentationType: "page",
				}),
			);

			const out = {
				pageCount: pages.length,
				pageSizes: pages.map((p) => p.blockSize),
				pageChildSums: pages.map((p) =>
					p.childFragments.reduce((s, c) => s + c.blockSize, 0),
				),
			};
			container.remove();
			return out;
		});

		// 150 + 200 + 100 = 450px of box content on 300px pages → 2 pages required
		expect(result.pageCount).toBeGreaterThanOrEqual(2);
		// Total box content across all pages should sum to 450 (modulo rounding)
		const total = result.pageChildSums.reduce((s, n) => s + n, 0);
		expect(total).toBeGreaterThanOrEqual(445);
		expect(total).toBeLessThanOrEqual(455);
	});

	test("a block resumed with an isAtBlockEnd done token emits nothing", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { runLayoutGenerator, getLayoutAlgorithm } =
				await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { BlockBreakToken } = await import("/src/fragmentation/tokens.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position: absolute; left: -9999px; top: 0;";
			container.innerHTML = '<p style="margin: 0; padding: 10px;">Hi</p>';
			document.body.appendChild(container);
			const node = new DOMLayoutNode(container.firstElementChild);
			const doneToken = new BlockBreakToken(node);
			doneToken.isAtBlockEnd = true;
			doneToken.hasSeenAllChildren = true;

			const cs = new ConstraintSpace({
				availableInlineSize: 600,
				availableBlockSize: 100,
				fragmentainerBlockSize: 100,
				blockOffsetInFragmentainer: 0,
				fragmentationType: "page",
			});
			const AlgoClass = getLayoutAlgorithm(node);
			const r = runLayoutGenerator(new AlgoClass(node, cs, doneToken));
			container.remove();
			return { blockSize: r.fragment.blockSize, childCount: r.fragment.childFragments.length };
		});
		expect(result.blockSize).toBe(0);
		expect(result.childCount).toBe(0);
	});

	test("applies block-start padding after a zero-progress insufficient-space break", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			// The 90px block leaves 10px (< line-height) for the paragraph, so on
			// page 1 it produces a zero-height insufficient-space continuation that
			// advances no text. Its 30px padding-top must therefore still apply on
			// page 2 — the first fragment that actually places content.
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:90px;margin:0;padding:0"></div>
        <p style="padding-top:30px;line-height:20px;margin:0">Hi</p>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 100,
					fragmentainerBlockSize: 100,
					fragmentationType: "page",
				}),
			);

			const out = {
				pageCount: pages.length,
				p0ParagraphBlockSize: pages[0].childFragments[1]?.blockSize ?? null,
				p1ParagraphBlockSize: pages[1]?.childFragments[0]?.blockSize ?? null,
			};
			container.remove();
			return out;
		});

		expect(result.pageCount).toBe(2);
		// Page 1: zero-progress continuation (no content placed).
		expect(result.p0ParagraphBlockSize).toBe(0);
		// Page 2: 30px padding-top + one 20px line.
		expect(result.p1ParagraphBlockSize).toBe(50);
	});

	// A run of atomic inlines produces line boxes but no INLINE_TEXT items, so no
	// DOM offset addresses a break between its lines: the run is unbreakable, and
	// where it lands decides whether it is pushed or overflows.
	test("pushes an unbreakable text-free line run to the next fragmentainer", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:100px";
			// Two 60px inline-blocks wrap to two lines in a 100px line box, with no
			// whitespace between the tags so the paragraph holds no text node at all.
			const box = '<span style="display:inline-block;width:60px;height:12px"></span>';
			container.innerHTML =
				'<div style="margin:0;padding:0">' +
				'<div style="height:60px;margin:0;padding:0"></div>' +
				`<p style="font:16px/20px monospace;margin:0;padding:0">${box}${box}</p>` +
				"</div>";
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			let out;
			try {
				// 85px fragmentainer after a 60px spacer: room for one of the two lines.
				const pages = createFragments(
					root,
					new ConstraintSpace({
						availableInlineSize: 100,
						availableBlockSize: 85,
						fragmentainerBlockSize: 85,
						fragmentationType: "page",
					}),
				);
				const paragraph = pages[1]?.childFragments[0] ?? null;
				out = {
					pageCount: pages.length,
					p0ParagraphBlockSize: pages[0].childFragments[1]?.blockSize ?? null,
					paragraphBlockSize: paragraph?.blockSize ?? null,
					lineCount: paragraph?.childFragments[0]?.childFragments.length ?? null,
					breakToken: paragraph?.breakToken ?? null,
				};
			} catch (error) {
				out = { error: error.message };
			}
			container.remove();
			return out;
		});

		expect(result.error).toBeUndefined();
		expect(result.pageCount).toBe(2);
		// Page 1 places nothing — no line can be broken off the run.
		expect(result.p0ParagraphBlockSize).toBe(0);
		// Page 2 carries the whole run: both 20px lines, nothing left over.
		expect(result.paragraphBlockSize).toBe(40);
		expect(result.lineCount).toBe(2);
		expect(result.breakToken).toBe(null);
	});

	test("overflows an unbreakable text-free line run at the top of a fragmentainer", async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:100px";
			const box = '<span style="display:inline-block;width:60px;height:12px"></span>';
			container.innerHTML = `<p style="font:16px/20px monospace;margin:0;padding:0">${box}${box}</p>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			let out;
			try {
				// 25px fragmentainer with nothing above: room for one 20px line, and no
				// earlier fragmentainer to push the run back to.
				const pages = createFragments(
					root,
					new ConstraintSpace({
						availableInlineSize: 100,
						availableBlockSize: 25,
						fragmentainerBlockSize: 25,
						fragmentationType: "page",
					}),
				);
				out = {
					pageCount: pages.length,
					paragraphBlockSize: pages[0].blockSize,
					lineCount: pages[0].childFragments[0]?.childFragments.length ?? null,
					breakToken: pages[0].breakToken ?? null,
				};
			} catch (error) {
				out = { error: error.message };
			}
			container.remove();
			return out;
		});

		expect(result.error).toBeUndefined();
		// Nowhere to push to, so both lines are placed and the run overflows the
		// 25px fragmentainer instead of looping on a break that cannot be taken.
		expect(result.pageCount).toBe(1);
		expect(result.paragraphBlockSize).toBe(40);
		expect(result.lineCount).toBe(2);
		expect(result.breakToken).toBe(null);
	});
});
