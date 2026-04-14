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

try {
	const flow = await paginate();
	if (flow) {
		const fragments = flow.fragments;
		const lines = [];
		lines.push(buildDocumentSummary(fragments));
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
