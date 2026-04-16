import { test, expect } from "../browser-fixture.js";

test.describe("Footnote.matches", () => {
	test("returns true for a node with --float: footnote", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { Footnote } = await import("/src/handlers/footnote.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:400px";
			const style = document.createElement("style");
			style.textContent = ".fn { --float: footnote; }";
			document.head.appendChild(style);
			container.innerHTML = `<div style="margin:0;padding:0">
        <div class="fn" style="height:100px;margin:0;padding:0">Footnote</div>
      </div>`;
			document.body.appendChild(container);
			const root = new DOMLayoutNode(container.firstElementChild);
			const mod = new Footnote();
			const match = mod.claim(root.children[0]);
			container.remove();
			style.remove();
			return match;
		});
		expect(result).toBe(true);
	});

	test("returns false for a regular block node", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const { Footnote } = await import("/src/handlers/footnote.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:400px";
			container.innerHTML = `<div style="margin:0;padding:0">
        <div style="height:100px;margin:0;padding:0"></div>
      </div>`;
			document.body.appendChild(container);
			const root = new DOMLayoutNode(container.firstElementChild);
			const mod = new Footnote();
			const match = mod.claim(root.children[0]);
			container.remove();
			return match;
		});
		expect(result).toBe(false);
	});
});

test.describe("Footnote.layout", () => {
	test("returns zero reservation by default", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Footnote } = await import("/src/handlers/footnote.js");
			const mod = new Footnote();
			const res = mod.layout();
			return {
				reservedBlockStart: res.reservedBlockStart,
				reservedBlockEnd: res.reservedBlockEnd,
				afterRenderIsNull: res.afterRender === null,
			};
		});
		expect(result.reservedBlockStart).toBe(0);
		expect(result.reservedBlockEnd).toBe(0);
		expect(result.afterRenderIsNull).toBe(true);
	});
});

test.describe("Footnote.claimPersistent", () => {
	test("returns empty array (footnotes are not persistent)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { Footnote } = await import("/src/handlers/footnote.js");
			const frag = document.createDocumentFragment();
			const mod = new Footnote();
			const res = mod.claimPersistent(frag, []);
			return { length: res.length };
		});
		expect(result.length).toBe(0);
	});
});

test.describe("Footnotes in paged media (browser)", () => {
	test("places footnote body at bottom of the page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { Footnote } = await import("/src/handlers/footnote.js");
			FragmentedFlow.register(Footnote);

			const css = ".fn { --float: footnote; }";
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(css);

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin: 0; padding: 0;">
        <p style="height: 100px; margin: 0; padding: 0;">
          Main text
          <span class="fn">Footnote body text</span>
        </p>
      </div>`;

			const layout = new FragmentedFlow(template.content, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 400,
					fragmentainerBlockSize: 400,
					fragmentationType: FRAGMENTATION_PAGE,
				}),
				styles: [sheet],
			});
			const flow = layout.flow();
			const count = flow.fragmentainerCount;

			const elements = [...flow];
			const el = elements[0];
			document.body.appendChild(el);

			const area = el.shadowRoot.querySelector(".footnote-area");
			const areaExists = area !== null;
			const childCount = area ? area.children.length : 0;
			const hasMarker =
				area && area.children[0] ? area.children[0].hasAttribute("data-footnote-marker") : false;
			const text = area && area.children[0] ? area.children[0].textContent : "";
			el.remove();
			layout.destroy();

			return { count, areaExists, childCount, hasMarker, text };
		});
		expect(result.count).toBe(1);
		expect(result.areaExists).toBe(true);
		expect(result.childCount).toBe(1);
		expect(result.hasMarker).toBe(true);
		expect(result.text).toContain("Footnote body text");
	});

	test("inserts a footnote call marker in place of the body", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { Footnote } = await import("/src/handlers/footnote.js");
			FragmentedFlow.register(Footnote);

			const css = ".fn { --float: footnote; }";
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(css);

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin: 0; padding: 0;">
        <p style="height: 100px; margin: 0; padding: 0;">
          Before<span class="fn">Body</span>After
        </p>
      </div>`;

			const layout = new FragmentedFlow(template.content, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 400,
					fragmentainerBlockSize: 400,
					fragmentationType: FRAGMENTATION_PAGE,
				}),
				styles: [sheet],
			});
			const flow = layout.flow();
			const elements = [...flow];
			const el = elements[0];
			document.body.appendChild(el);

			const call = el.shadowRoot.querySelector("[data-footnote-call]");
			const callExists = call !== null;
			const tagName = call ? call.tagName : null;
			el.remove();
			layout.destroy();

			return { callExists, tagName };
		});
		expect(result.callExists).toBe(true);
		expect(result.tagName).toBe("A");
	});

	test("handles multiple footnotes on the same page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { Footnote } = await import("/src/handlers/footnote.js");
			FragmentedFlow.register(Footnote);

			const css = ".fn { --float: footnote; }";
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(css);

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin: 0; padding: 0;">
        <p style="height: 80px; margin: 0; padding: 0;">
          First<span class="fn">First footnote</span>
        </p>
        <p style="height: 80px; margin: 0; padding: 0;">
          Second<span class="fn">Second footnote</span>
        </p>
      </div>`;

			const layout = new FragmentedFlow(template.content, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 400,
					fragmentainerBlockSize: 400,
					fragmentationType: FRAGMENTATION_PAGE,
				}),
				styles: [sheet],
			});
			const flow = layout.flow();
			const elements = [...flow];
			const el = elements[0];
			document.body.appendChild(el);

			const area = el.shadowRoot.querySelector(".footnote-area");
			const areaExists = area !== null;
			const childCount = area ? area.children.length : 0;
			const text0 = area && area.children[0] ? area.children[0].textContent : "";
			const text1 = area && area.children[1] ? area.children[1].textContent : "";
			el.remove();
			layout.destroy();

			return { areaExists, childCount, text0, text1 };
		});
		expect(result.areaExists).toBe(true);
		expect(result.childCount).toBe(2);
		expect(result.text0).toContain("First footnote");
		expect(result.text1).toContain("Second footnote");
	});

	test("footnote reduces available content space causing page break", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { Footnote } = await import("/src/handlers/footnote.js");
			FragmentedFlow.register(Footnote);

			const css = ".fn { --float: footnote; }";
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(css);

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin: 0; padding: 0;">
        <div style="margin: 0; padding: 0;">
          <div class="fn" style="height: 150px; margin: 0; padding: 0;">Footnote body</div>
        </div>
        <div style="height: 100px; margin: 0; padding: 0;"></div>
        <div style="height: 100px; margin: 0; padding: 0;"></div>
        <div style="height: 100px; margin: 0; padding: 0;"></div>
      </div>`;

			const layout = new FragmentedFlow(template.content, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 400,
					fragmentainerBlockSize: 400,
					fragmentationType: FRAGMENTATION_PAGE,
				}),
				styles: [sheet],
			});
			const flow = layout.flow();
			const count = flow.fragmentainerCount;
			layout.destroy();
			return { count };
		});
		expect(result.count).toBeGreaterThanOrEqual(2);
	});

	test("page without footnotes has no footnote area", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { Footnote } = await import("/src/handlers/footnote.js");
			FragmentedFlow.register(Footnote);

			const css = ".fn { --float: footnote; }";
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(css);

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin: 0; padding: 0;">
        <div style="height: 100px; margin: 0; padding: 0;">No footnotes here</div>
      </div>`;

			const layout = new FragmentedFlow(template.content, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 400,
					fragmentainerBlockSize: 400,
					fragmentationType: FRAGMENTATION_PAGE,
				}),
				styles: [sheet],
			});
			const flow = layout.flow();
			const elements = [...flow];
			const el = elements[0];
			document.body.appendChild(el);

			const area = el.shadowRoot.querySelector(".footnote-area");
			const areaIsNull = area === null;
			el.remove();
			layout.destroy();
			return { areaIsNull };
		});
		expect(result.areaIsNull).toBe(true);
	});

	test("footnote call and body stay on the same page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { FragmentedFlow } = await import("/src/fragmentation/fragmented-flow.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { FRAGMENTATION_PAGE } = await import("/src/fragmentation/constraint-space.js");
			const { Footnote } = await import("/src/handlers/footnote.js");
			FragmentedFlow.register(Footnote);

			const css = ".fn { --float: footnote; }";
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(css);

			const template = document.createElement("template");
			template.innerHTML = `<div style="margin: 0; padding: 0;">
        <div style="height: 100px; margin: 0; padding: 0;">Page 1 content</div>
        <div style="height: 100px; margin: 0; padding: 0;">
          Page 2 text<span class="fn">Page 2 footnote</span>
        </div>
      </div>`;

			const layout = new FragmentedFlow(template.content, {
				constraintSpace: new ConstraintSpace({
					availableInlineSize: 400,
					availableBlockSize: 200,
					fragmentainerBlockSize: 200,
					fragmentationType: FRAGMENTATION_PAGE,
				}),
				styles: [sheet],
			});
			const flow = layout.flow();
			const elements = [...flow];

			let pageWithCall = -1;
			let pageWithBody = -1;

			for (let i = 0; i < elements.length; i++) {
				document.body.appendChild(elements[i]);
				const call = elements[i].shadowRoot.querySelector("[data-footnote-call]");
				const area = elements[i].shadowRoot.querySelector(".footnote-area");
				if (call) pageWithCall = i;
				if (area) pageWithBody = i;
				elements[i].remove();
			}

			layout.destroy();
			return { pageWithCall, pageWithBody };
		});
		expect(result.pageWithCall).not.toBe(-1);
		expect(result.pageWithCall).toBe(result.pageWithBody);
	});
});
