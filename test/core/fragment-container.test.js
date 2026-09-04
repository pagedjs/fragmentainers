import { test, expect } from "../browser-fixture.js";

test("anchors absolute descendants to each fragmentainer content area", async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { Fragmenter } = await import("/src/index.js");
		const template = document.createElement("template");
		template.innerHTML = `
			<section style="break-after:page">
				<div style="position:absolute;bottom:0;left:0;width:80%;height:30px">First</div>
			</section>
			<section>
				<div style="position:absolute;bottom:0;left:0;width:80%;height:30px">Second</div>
			</section>
		`;
		const flow = new Fragmenter(template.content, { width: 250, height: 300 });
		const containers = [...flow];
		for (const container of containers) document.body.append(container);
		const bounds = containers.map((container) => {
			const area = container.getBoundingClientRect();
			const element = container.querySelector("section > div");
			const rect = element.getBoundingClientRect();
			return {
				left: rect.left - area.left,
				bottom: rect.bottom - area.bottom,
				width: rect.width,
				parent: element.offsetParent === container,
			};
		});
		flow.destroy();
		return bounds;
	});
	expect(result).toEqual([
		{ left: 0, bottom: 0, width: 200, parent: true },
		{ left: 0, bottom: 0, width: 200, parent: true },
	]);
});

test("keeps leading margins inside the slot and honors positioned ancestors", async ({ page }) => {
	const result = await page.evaluate(async () => {
		await import("/src/components/fragment-container.js");
		const container = document.createElement("fragment-container");
		container.style.cssText = "width:250px;height:300px;margin-top:20px";
		container.innerHTML = `
			<section style="position:relative;width:180px;height:100px;margin-top:45px">
				<div style="position:absolute;bottom:0;left:0;width:100%;height:25px">Local</div>
			</section>
		`;
		document.body.append(container);
		const area = container.getBoundingClientRect();
		const slot = container.shadowRoot.querySelector("slot").getBoundingClientRect();
		const section = container.firstElementChild;
		const child = section.firstElementChild;
		const sectionRect = section.getBoundingClientRect();
		const childRect = child.getBoundingClientRect();
		return {
			slotTop: slot.top - area.top,
			sectionTop: sectionRect.top - area.top,
			childBottom: childRect.bottom - sectionRect.bottom,
			childWidth: childRect.width,
			localParent: child.offsetParent === section,
		};
	});
	expect(result).toEqual({ slotTop: 0, sectionTop: 45, childBottom: 0, childWidth: 180, localParent: true });
});
