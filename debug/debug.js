import { FragmentedFlow, PageResolver } from "../src/index.js";
import { ContentParser } from "./content-parser.js";
import "../src/components/fragment-container.js";
import "./page-container.js";
import { fragmentainerHeight, buildFragmentOverlay } from "./inspect.js";

const params = new URLSearchParams(location.search);
const url = params.get("url");
const range = params.get("range") || "";

if (url) params.set("url", url);
if (!range) params.delete("range");
history.replaceState(null, "", `?${params}`);

const headerEl = document.getElementById("header");
const outputEl = document.getElementById("output");

// Header

const dl = document.createElement("dl");

// URL control — always visible
const urlInput = document.createElement("input");
urlInput.type = "text";
urlInput.value = url;
urlInput.placeholder = "URL to debug";
urlInput.addEventListener("keydown", (e) => {
	if (e.key === "Enter") navigate();
});

const rangeInput = document.createElement("input");
rangeInput.type = "text";
rangeInput.value = range;
rangeInput.style.cssText = "width:60px;";
rangeInput.placeholder = "Pages";
rangeInput.title = "Page range (e.g. 3, 1-5, or empty for all)";
rangeInput.addEventListener("keydown", (e) => {
	if (e.key === "Enter") navigate();
});

function navigate() {
	params.set("url", urlInput.value);
	if (rangeInput.value) {
		params.set("range", rangeInput.value);
	} else {
		params.delete("range");
	}
	location.search = params.toString();
}

function addRow(label, content) {
	const dt = document.createElement("dt");
	dt.textContent = `${label}:`;
	const dd = document.createElement("dd");
	if (typeof content === "string") {
		dd.innerHTML = content;
	} else {
		dd.append(content);
	}
	dl.append(dt, dd);
	return dd;
}

const urlDd = addRow("url", "");
urlDd.className = "controls";
urlDd.append(urlInput, rangeInput);

// Placeholder rows — filled after layout
const pagesDd = addRow("pages", "—");
const sizeDd = addRow("size", "—");
const timeDd = addRow("time", "—");

// Outlines toggle
const toggle = document.createElement("input");
toggle.type = "checkbox";
toggle.id = "fragment-borders";
toggle.addEventListener("change", () => {
	for (const el of document.querySelectorAll(".fragment-overlay")) {
		el.classList.toggle("active", toggle.checked);
	}
});
addRow("outlines", toggle);

headerEl.append(dl);

function updateHeader(summary, timing) {
	rangeInput.placeholder = `1–${summary.totalPages}`;
	pagesDd.textContent = `${summary.totalPages} (${summary.overflowPages} overflow, ${summary.forcedBreaks} forced breaks)`;
	sizeDd.textContent = `${summary.pageSize.inlineSize} × ${summary.pageSize.blockSize} · ${summary.totalContentHeight.toFixed(0)}px content`;
	timeDd.textContent = `${timing.total.toFixed(0)}ms (layout ${timing.layout.toFixed(0)}ms, render ${timing.render.toFixed(0)}ms)`;
	if (summary.issueCount > 0) {
		addRow("issues", `<span class="issue-count">${summary.issueCount}</span>`);
	}
}

// Helpers

function parseRange(str, total) {
	if (!str) return [0, total];
	const match = str.match(/^(\d+)(?:-(\d+))?$/);
	if (!match) return [0, total];
	const a = Math.max(1, Math.min(parseInt(match[1]), total));
	const b = match[2] ? Math.max(a, Math.min(parseInt(match[2]), total)) : a;
	return [a - 1, b];
}

function findBaseLineHeight(fragment) {
	for (const child of fragment.childFragments) {
		if (!child.node) continue;
		if (child.node.isInlineFormattingContext) return child.node.lineHeight;
		const lh = findBaseLineHeight(child);
		if (lh) return lh;
	}
	return null;
}

// Main

if (url) {
	run();
}

async function run() {
	try {
		const t0 = performance.now();

		const response = await fetch(url);
		const content = await response.text();
		const baseURL = url.substring(0, url.lastIndexOf("/") + 1);
		const parsed = await ContentParser.fromString(content, baseURL);

		const resolver = PageResolver.fromStyleSheets(parsed.styles);

		const layout = new FragmentedFlow(parsed.fragment, {
			styles: parsed.styles,
			resolver: resolver.pageRules.length > 0 ? resolver : undefined,
		});

		await layout.preload();

		const tLayout = performance.now();
		const flow = layout.flow();
		const layoutTime = performance.now() - tLayout;
		const fragments = flow.fragments;

		const [startIdx, endIdx] = parseRange(range, fragments.length);

		const first = fragments[startIdx].constraints;
		const fragW = first?.pageBoxSize?.inlineSize ?? 0;
		document.body.style.setProperty("--page-inline-size", fragW);

		// Snap dot grid to the base line-height
		const lh = findBaseLineHeight(fragments[0]);
		if (lh) document.body.style.setProperty("--grid-size", `${lh}px`);

		const tRender = performance.now();
		let issueCount = 0;

		let slot = 0;
		for (let i = startIdx; i < endIdx; i++) {
			const c = fragments[i].constraints;
			const isBlank = fragments[i].isBlank;

			// Blank pages go on the left (even slot) — pad the previous page if needed
			if (isBlank && slot % 2 === 1) {
				const prev = outputEl.lastElementChild;
				if (prev) prev.classList.add("single");
				slot++;
			}

			const renderBox = document.createElement("page-container");
			renderBox.className = "page-render";

			const fragEl = flow[i];
			renderBox.appendChild(fragEl);

			if (c) {
				const overlay = buildFragmentOverlay(fragments[i], c.contentArea, c.margins);
				renderBox.appendChild(overlay);
			}

			fragEl.addEventListener("overflow", () => {
				renderBox.classList.add("has-issues");
				issueCount++;
			});
			fragEl.startObserving();

			outputEl.appendChild(renderBox);
			slot++;
		}

		// If the last slot is odd (left page only), mark it single
		const lastRender = outputEl.lastElementChild;
		if (slot % 2 === 1 && lastRender) {
			lastRender.classList.add("single");
		}

		const renderTime = performance.now() - tRender;
		const totalTime = performance.now() - t0;

		const firstResolved = resolver.resolve(0, null, null);
		let totalContentHeight = 0;
		let overflowPages = 0;
		let forcedBreaks = 0;
		for (const page of fragments) {
			totalContentHeight += page.blockSize;
			if (page.blockSize > fragmentainerHeight(page) + 0.01) overflowPages++;
			if (page.breakToken?.isForcedBreak) forcedBreaks++;
		}

		updateHeader(
			{
				totalPages: fragments.length,
				totalContentHeight,
				overflowPages,
				forcedBreaks,
				pageSize: firstResolved.pageBoxSize,
				issueCount,
			},
			{
				layout: layoutTime,
				render: renderTime,
				total: totalTime,
			},
		);
	} catch (err) {
		outputEl.textContent = `ERROR: ${err.message}\n${err.stack}`;
	}
}
