/**
 * Paginate a document using @page rules.
 *
 * Moves all body content into a FragmentedFlow, renders each
 * page into a <page-container> element, and appends them to the body.
 */
import { FragmentedFlow, PageResolver, ContentParser } from "../src/index.js";
import "../src/dom/fragment-container.js";
import "./page-container.js";

export async function paginate() {
	const resolver = PageResolver.fromDocument();
	if (resolver.pageRules.length === 0) return null;

	const frag = document.createDocumentFragment();
	while (document.body.firstChild) {
		frag.appendChild(document.body.firstChild);
	}

	const styles = ContentParser.collectDocumentStyles();
	const layout = new FragmentedFlow(frag, { resolver, styles });
	await layout.preload();
	const flow = layout.flow();

	let pageNumber = 0;
	for (const frag of flow) {
		const page = document.createElement("page-container");
		page.className = "spec-page";
		page.dataset.pageIndex = pageNumber++;
		page.appendChild(frag);
		document.body.appendChild(page);
	}

	document.documentElement.dataset.pageCount = String(pageNumber);

	return flow;
}
