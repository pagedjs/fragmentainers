/**
 * Measurement debug processor — runs layout far enough to set up each
 * measurement segment, then clones each live <content-measure> into a
 * visible <content-measure> so the measured DOM can be inspected in
 * the browser.
 *
 * The viewer --measure flag injects this instead of process.js.
 */
import { FragmentedFlow, PageResolver } from "../src/index.js";
import { LayoutHandler } from "../src/handlers/handler.js";
import { ContentParser } from "./content-parser.js";
import "../src/components/content-measure.js";

const DEBUG_CONTAINER_ID = "measure-debug-container";
const DEBUG_CONTAINER_STYLES = `
  #${DEBUG_CONTAINER_ID} {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 24px;
    background: #f4f4f4;
    min-height: 100vh;
    box-sizing: border-box;
  }
  #${DEBUG_CONTAINER_ID} content-measure {
    position: static;
    left: auto;
    contain: none;
    background: white;
    box-shadow: 0 0 0 1px #ddd;
    align-self: flex-start;
  }
`;

let debugContainer = null;

class MeasurementCloneHandler extends LayoutHandler {
	#pendingRoot = null;

	afterMeasurementSetup(contentRoot) {
		// Host width isn't set yet — defer the clone until layout() fires
		// for this segment, when the constraint space is available.
		this.#pendingRoot = contentRoot;
	}

	layout(rootNode, constraintSpace) {
		if (this.#pendingRoot && debugContainer) {
			this.#cloneSegment(this.#pendingRoot, constraintSpace);
			this.#pendingRoot = null;
		}
		return { reservedBlockStart: 0, reservedBlockEnd: 0, afterRender: null };
	}

	#cloneSegment(contentRoot, constraintSpace) {
		const shadowRoot = contentRoot.getRootNode();
		const host = shadowRoot.host;
		const sheets = [...shadowRoot.adoptedStyleSheets];

		const frag = document.createDocumentFragment();
		for (const child of contentRoot.children) {
			frag.appendChild(child.cloneNode(true));
		}

		const clone = document.createElement("content-measure");
		for (const attr of host.attributes) {
			clone.setAttribute(attr.name, attr.value);
		}
		debugContainer.appendChild(clone);
		clone.injectFragment(frag, sheets);
		clone.applyConstraintSpace(constraintSpace);
	}
}

async function process() {
	try {
		const resolver = PageResolver.fromDocument();
		if (resolver.pageRules.length === 0) {
			document.documentElement.dataset.specError = "measure: no @page rules found";
			document.documentElement.dataset.specReady = "true";
			return;
		}

		const frag = document.createDocumentFragment();
		while (document.body.firstChild) {
			frag.appendChild(document.body.firstChild);
		}

		const styles = ContentParser.collectDocumentStyles();

		debugContainer = document.createElement("div");
		debugContainer.id = DEBUG_CONTAINER_ID;
		document.body.appendChild(debugContainer);

		const containerStyle = document.createElement("style");
		containerStyle.textContent = DEBUG_CONTAINER_STYLES;
		document.head.appendChild(containerStyle);

		FragmentedFlow.register(MeasurementCloneHandler);

		const layout = new FragmentedFlow(frag, { resolver, styles });
		await layout.preload();
		layout.flow();

		document.documentElement.dataset.specReady = "true";
	} catch (err) {
		console.error("Measure process error:", err);
		document.documentElement.dataset.specError = err.message + "\n" + err.stack;
		document.documentElement.dataset.specReady = "true";
	}
}

process();
