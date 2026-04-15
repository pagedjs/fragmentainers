/**
 * Browser-side module that runs paginate + inspect and stores
 * the text report on a data attribute for CLI extraction.
 */
import { paginate } from "../specs/helpers/paginate.js";
import {
	buildPageDump,
	buildDocumentSummary,
	buildElementSpans,
	fragmentainerHeight,
} from "./outlines.js";

function measureRendered(container) {
	const slot = container?.contentRoot;
	if (!slot) return 0;
	const slotTop = slot.getBoundingClientRect().top;
	let maxBottom = 0;
	for (const child of slot.children) {
		const rect = child.getBoundingClientRect();
		const bottom = rect.bottom - slotTop;
		if (bottom > maxBottom) maxBottom = bottom;
	}
	return maxBottom;
}

try {
	const flow = await paginate();
	if (flow) {
		const fragments = flow.fragments;
		const containers = document.querySelectorAll("fragment-container");
		const overflowPages = [];
		for (let i = 0; i < fragments.length; i++) {
			if (fragments[i].isBlank) continue;
			const effH = fragmentainerHeight(fragments[i]);
			const rendered = measureRendered(containers[i]);
			if (rendered > effH + 0.5) {
				overflowPages.push({ page: i + 1, expected: effH, rendered });
			}
		}
		const lines = [];
		lines.push(buildDocumentSummary(fragments));
		if (overflowPages.length > 0) {
			lines.push(`- renderedOverflowPages: ${overflowPages.length}`);
			const listing = overflowPages
				.map((o) => `page ${o.page} (+${(o.rendered - o.expected).toFixed(2)}px)`)
				.join(", ");
			lines.push(`  - ${listing}`);
		}
		const elementSpans = buildElementSpans(fragments);
		for (let i = 0; i < fragments.length; i++) {
			const c = fragments[i].constraints;
			const effH = fragmentainerHeight(fragments[i]);
			const fragW = c?.pageBoxSize?.inlineSize ?? 0;
			const fragH = c?.pageBoxSize?.blockSize ?? 0;
			const dump = buildPageDump(fragments, i, effH, elementSpans, fragW, fragH);
			lines.push(dump.text);
		}
		document.documentElement.dataset.inspectReport = lines.join("\n");
		document.documentElement.dataset.pageCount = String(fragments.length);
	}
	document.documentElement.dataset.specReady = "true";
} catch (err) {
	console.error("Inspect report error:", err);
	document.documentElement.dataset.specError = err.message + "\n" + err.stack;
	document.documentElement.dataset.specReady = "true";
}
