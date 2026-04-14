/**
 * Spec test page processor — injected into test pages via Playwright.
 *
 * Reads data-spec-type from the document element to decide which
 * fragmentation mode to run: "print" for pagination, "multicol" for columns.
 */
import { paginate } from "/specs/helpers/paginate.js";
import { findMulticolContainers, multicol } from "/specs/helpers/multicol.js";

async function process() {
	try {
		const type = document.documentElement.dataset.specType || "print";

		if (type === "multicol") {
			const containers = findMulticolContainers(document.body);
			for (const container of containers) {
				await multicol(container);
			}
		} else {
			await paginate();

			// Reset body styles since we aren't really printing.
			const style = document.createElement("style");
			style.textContent = "@media screen { body { all: initial !important } }";
			document.head.appendChild(style);
		}

		document.documentElement.dataset.specReady = "true";
	} catch (err) {
		console.error("Spec process error:", err);
		document.documentElement.dataset.specError = err.message + "\n" + err.stack;
		document.documentElement.dataset.specReady = "true";
	}
}

process();
