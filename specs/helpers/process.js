/**
 * Spec test page processor — injected into test pages via Playwright.
 *
 * Reads data-spec-type from the document element to decide which
 * fragmentation mode to run: "print" for pagination, "multicol" for columns.
 */
import { paginate } from "/debug/paginate.js";
import { findMulticolContainers, multicol } from "/debug/multicol.js";
import { saveRef } from "./build-ref.js";

const SAVE_REF = location.hash === "#ref";

async function process() {
	try {
		const type = document.documentElement.dataset.specType || "print";

		if (type === "multicol") {
			const containers = findMulticolContainers(document.body);
			for (const container of containers) {
				await multicol(container);
			}
		} else {
			const flow = await paginate();

			if (SAVE_REF) {
				saveRef(flow);
			}

			// Reset body styles to match ref layout
			document.body.setAttribute("style",
				"margin: 0; padding: 0; display: flex; flex-direction: column; background: none;");

		}

		document.documentElement.dataset.specReady = "true";
	} catch (err) {
		console.error("Spec process error:", err);
		document.documentElement.dataset.specError = err.message + "\n" + err.stack;
		document.documentElement.dataset.specReady = "true";
	}
}

process();
