import { test, expect } from "../browser-fixture.js";

test.describe("Phase 7: Break scoring & two-pass layout", () => {
	test("respects break-after: avoid by choosing an earlier break", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="break-after:avoid;height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

			const r = {
				length: pages.length,
				p0Children: pages[0].childFragments.length,
				p0BlockSize: pages[0].blockSize,
				p1Children: pages[1].childFragments.length,
			};
			container.remove();
			return r;
		});

		expect(result.length).toBe(2);
		expect(result.p0Children).toBe(1);
		expect(result.p0BlockSize).toBe(100);
		expect(result.p1Children).toBe(2);
	});

	test("respects break-before: avoid on the next sibling", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="break-before:avoid;height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

			const r = {
				length: pages.length,
				p0Children: pages[0].childFragments.length,
				p0BlockSize: pages[0].blockSize,
				p1Children: pages[1].childFragments.length,
			};
			container.remove();
			return r;
		});

		expect(result.length).toBe(2);
		expect(result.p0Children).toBe(1);
		expect(result.p0BlockSize).toBe(100);
		expect(result.p1Children).toBe(2);
	});

	test("break-inside: avoid on parent degrades all interior breaks", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:50px;margin:0;padding:0"></div>
        <div style="break-inside:avoid;margin:0;padding:0">
          <div style="height:100px;margin:0;padding:0"></div>
          <div style="height:100px;margin:0;padding:0"></div>
        </div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 120,
					fragmentainerBlockSize: 120,
					fragmentationType: "page",
				}),
			);

			const r = { length: pages.length };
			container.remove();
			return r;
		});

		expect(result.length >= 2).toBeTruthy();
	});

	test("break-inside: avoid-page pushes oversized child to next page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="break-inside:avoid-page;margin:0;padding:0">
          <div style="height:80px;margin:0;padding:0"></div>
          <div style="height:70px;margin:0;padding:0"></div>
        </div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

			const r = {
				length: pages.length,
				p0Children: pages[0].childFragments.length,
				p0BlockSize: pages[0].blockSize,
				p1Children: pages[1]?.childFragments.length ?? 0,
				p1BlockSize: pages[1]?.blockSize ?? 0,
			};
			container.remove();
			return r;
		});

		expect(result.length).toBe(2);
		expect(result.p0Children).toBe(1);
		expect(result.p0BlockSize).toBe(100);
		expect(result.p1Children).toBe(1);
		expect(result.p1BlockSize).toBe(150);
	});

	test("falls back to normal break when no better alternative exists", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="break-after:avoid;height:100px;margin:0;padding:0"></div>
        <div style="break-after:avoid;height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

			const r = {
				length: pages.length,
				p0ChildrenGte1: pages[0].childFragments.length >= 1,
			};
			container.remove();
			return r;
		});

		expect(result.length).toBe(2);
		expect(result.p0ChildrenGte1).toBeTruthy();
	});

	test("perfect break is not overridden by two-pass", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 600,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: "page",
				}),
			);

			const r = {
				length: pages.length,
				p0Children: pages[0].childFragments.length,
			};
			container.remove();
			return r;
		});

		expect(result.length).toBe(2);
		expect(result.p0Children).toBe(2);
	});
});

test.describe("ALG-6: orphans/widows two-pass", () => {
	const LOREM =
		"Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod " +
		"tempor incididunt ut labore et dolore magna aliqua ut enim ad minim " +
		"veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea " +
		"commodo consequat duis aute irure dolor in reprehenderit in voluptate";

	async function run(page, html) {
		return page.evaluate(
			async ({ html, lorem }) => {
				const { createFragments } = await import("/src/fragmentation/create-fragments.js");
				const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
				const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

				const container = document.createElement("div");
				container.style.cssText = "position:absolute;left:-9999px;width:600px";
				container.innerHTML = html.replace(/LOREM/g, lorem);
				document.body.appendChild(container);

				const root = new DOMLayoutNode(container.firstElementChild);
				const pages = createFragments(
					root,
					new ConstraintSpace({
						availableInlineSize: 600,
						availableBlockSize: 200,
						fragmentainerBlockSize: 200,
						fragmentationType: "page",
					}),
				);

				const r = {
					length: pages.length,
					p0Children: pages[0].childFragments.length,
				};
				container.remove();
				return r;
			},
			{ html, lorem: LOREM },
		);
	}

	// A 165px block leaves 35px — room for exactly one line. Placing one line of
	// a multi-line paragraph violates orphans:2, so the two-pass retry breaks
	// before the paragraph and pushes it whole to the next fragmentainer.
	test("pushes a paragraph that would leave an orphan line", async ({ page }) => {
		const result = await run(
			page,
			`<div style="margin:0;padding:0">
				<div style="height:165px;margin:0;padding:0"></div>
				<p style="orphans:2;widows:2;margin:0;padding:0;font-size:16px;line-height:25px">LOREM</p>
			</div>`,
		);
		expect(result.length).toBe(2);
		expect(result.p0Children).toBe(1);
	});

	// Control: with orphans:1/widows:1 the same break is PERFECT, so the
	// paragraph splits normally and the retry must not over-fire.
	test("splits normally when orphans/widows are satisfied", async ({ page }) => {
		const result = await run(
			page,
			`<div style="margin:0;padding:0">
				<div style="height:165px;margin:0;padding:0"></div>
				<p style="orphans:1;widows:1;margin:0;padding:0;font-size:16px;line-height:25px">LOREM</p>
			</div>`,
		);
		expect(result.p0Children).toBe(2);
	});

	// Part B: the paragraph is the only child of an inner block, so that block
	// cannot retry internally (no earlier breakpoint). It must report the
	// violating breakScore up through #finalize so the outer container pushes
	// the whole inner block to the next fragmentainer.
	test("propagates a nested block's violating break score upward", async ({ page }) => {
		const result = await run(
			page,
			`<div style="margin:0;padding:0">
				<div style="height:165px;margin:0;padding:0"></div>
				<div style="margin:0;padding:0">
					<p style="orphans:2;widows:2;margin:0;padding:0;font-size:16px;line-height:25px">LOREM</p>
				</div>
			</div>`,
		);
		expect(result.length).toBe(2);
		expect(result.p0Children).toBe(1);
	});
});

test.describe("Nested early-break targets", () => {
	// A nested container that exhausts its fragmentainer with a better earlier
	// break records an EarlyBreak naming itself. The two-pass retry only re-runs
	// the root, so the target must be threaded down to the nested owner or the
	// retry returns a null fragment and the driver dereferences it.
	const OWNER_HTML = `
		<div style="margin:0;padding:0">
			<div style="height:100px;margin:0;padding:0"></div>
			<div style="height:100px;margin:0;padding:0"></div>
			<div style="break-before:avoid;height:100px;margin:0;padding:0"></div>
		</div>`;

	async function run(page, rootHtml) {
		return page.evaluate(async (html) => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:600px";
			container.innerHTML = html;
			document.body.appendChild(container);

			const out = { threw: null, length: 0, nestedChildrenP0: null };
			try {
				const root = new DOMLayoutNode(container.firstElementChild);
				const pages = createFragments(
					root,
					new ConstraintSpace({
						availableInlineSize: 600,
						availableBlockSize: 200,
						fragmentainerBlockSize: 200,
						fragmentationType: "page",
					}),
				);
				out.length = pages.length;
				out.nestedChildrenP0 = pages[0].childFragments[0]?.childFragments.length ?? null;
			} catch (e) {
				out.threw = String((e && e.message) || e);
			}
			container.remove();
			return out;
		}, rootHtml);
	}

	test("honors a nested block container's early break", async ({ page }) => {
		const result = await run(page, `<div style="margin:0;padding:0">${OWNER_HTML}</div>`);
		expect(result.threw).toBe(null);
		expect(result.length).toBe(2);
		// The break is honored at the perfect boundary: the nested owner keeps
		// only its first child on page 0, not all three.
		expect(result.nestedChildrenP0).toBe(1);
	});

	test("does not crash when the owner is behind a flex boundary", async ({ page }) => {
		const result = await run(
			page,
			`<div style="margin:0;padding:0"><div style="display:flex;flex-direction:column;margin:0;padding:0">${OWNER_HTML}</div></div>`,
		);
		expect(result.threw).toBe(null);
		expect(result.length).toBeGreaterThan(1);
	});

	test("does not crash when the owner is behind a multicol boundary", async ({ page }) => {
		const result = await run(
			page,
			`<div style="margin:0;padding:0"><div style="column-count:1;margin:0;padding:0">${OWNER_HTML}</div></div>`,
		);
		// Multicol fragmentation is incomplete (a separate limitation), so the
		// split count is not asserted here — only that the retry no longer crashes.
		expect(result.threw).toBe(null);
		expect(result.length).toBeGreaterThanOrEqual(1);
	});

	test("does not crash when the owner is a table cell", async ({ page }) => {
		const result = await run(
			page,
			`<div style="margin:0;padding:0"><div style="display:table;margin:0;padding:0"><div style="display:table-row;margin:0;padding:0"><div style="display:table-cell;margin:0;padding:0">
				<div style="height:100px;margin:0;padding:0"></div>
				<div style="height:100px;margin:0;padding:0"></div>
				<div style="break-before:avoid;height:100px;margin:0;padding:0"></div>
			</div></div></div></div>`,
		);
		expect(result.threw).toBe(null);
		expect(result.length).toBeGreaterThan(1);
	});
});
