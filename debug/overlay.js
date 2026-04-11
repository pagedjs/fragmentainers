/**
 * Browser-side module that paginates and adds fragment border overlays.
 * Used by viewer.js --debug to show layout structure on each page.
 */
import { paginate } from "./paginate.js";
import { buildFragmentOverlay } from "./inspect.js";

try {
	const flow = await paginate();
	if (flow) {
		const fragments = flow.fragments;
		const containers = document.querySelectorAll("page-container");
		for (let i = 0; i < containers.length; i++) {
			const c = fragments[i]?.constraints;
			if (!c) continue;
			const overlay = buildFragmentOverlay(fragments[i], c.contentArea, c.margins);
			overlay.classList.add("active");
			containers[i].style.position = "relative";
			containers[i].style.overflow = "visible";
			containers[i].appendChild(overlay);
		}
		document.documentElement.dataset.pageCount = String(fragments.length);
	}
	document.documentElement.dataset.specReady = "true";
} catch (err) {
	console.error("Overlay error:", err);
	document.documentElement.dataset.specError = err.message + "\n" + err.stack;
	document.documentElement.dataset.specReady = "true";
}
