import { LayoutModule } from "./module.js";

const FOOTNOTE_STYLES = `
[data-footnote-call] {
  counter-increment: footnote;
}
[data-footnote-call]::after {
  content: counter(footnote);
  vertical-align: super;
  font-size: 65%;
}
[data-footnote-marker] {
  display: list-item;
  list-style-position: inside;
}
[data-footnote-marker]::marker {
  content: counter(footnote) ". ";
}
`;

/**
 * Walk a break token chain to find the deepest element at the break
 * boundary. This is the DOM element where content was split or pushed.
 *
 * @param {import('../core/tokens.js').BreakToken|null} breakToken
 * @returns {Element|null}
 */
function getBreakBoundaryElement(breakToken) {
	if (!breakToken) return null;
	let token = breakToken;
	while (token.childBreakTokens?.length > 0) {
		token = token.childBreakTokens[0];
	}
	return token.node?.element ?? null;
}

/**
 * Layout module for CSS footnotes (css-gcpm-3 Section 2).
 *
 * Elements styled with `float: footnote` are removed from the content
 * flow during preprocessing, replaced with inline call markers, and
 * their bodies placed in a footnote area at the page bottom during
 * rendering.
 *
 * Uses an iterative layout approach: after content layout, the module
 * checks which footnote calls landed on the page and requests block-end
 * space for their bodies. The fragmentainer driver re-runs layout with
 * the updated reservation until it stabilises.
 */
class FootnoteLayoutModule extends LayoutModule {
	/** @type {Map<string, { callElement: Element, bodyElement: Element, blockSize: number }>} */
	#footnoteMap = new Map();

	/** @type {string[]} Call IDs in document order */
	#allCalls = [];

	/** @type {CSSStyleSheet[]} Saved styles for footnote measurement */
	#styles = null;

	/** @type {Element|null} Dedicated <content-measure> for footnote bodies */
	#measurer = null;

	/** @type {boolean} Whether body heights have been measured */
	#measured = false;

	/** @type {CSSStyleSheet|null} Default footnote stylesheet */
	#defaultSheet = null;

	/**
	 * Scan stylesheets for `float: footnote` rules, extract matching
	 * elements from the content tree, and insert call markers in their
	 * place. Bodies are stored for separate measurement.
	 */
	claimPersistent(content, styles) {
		this.#styles = styles;
		this.#footnoteMap.clear();
		this.#allCalls = [];
		this.#measured = false;

		if (this.#measurer) {
			this.#measurer.remove();
			this.#measurer = null;
		}

		const footnoteSelectors = [];
		for (const sheet of styles) {
			let rules;
			try {
				rules = sheet.cssRules;
			} catch {
				continue;
			}
			for (const rule of rules) {
				if (!rule.style) continue;
				if (rule.style.getPropertyValue("--float").trim() === "footnote") {
					footnoteSelectors.push(rule.selectorText);
				}
			}
		}

		if (footnoteSelectors.length === 0) return [];

		let counter = 0;
		for (const selector of footnoteSelectors) {
			let elements;
			try {
				elements = content.querySelectorAll(selector);
			} catch {
				continue;
			}

			for (const el of elements) {
				if (el.hasAttribute("data-footnote-body")) continue;
				if (!el.parentNode) continue;

				const id = `fn-${counter++}`;

				const call = document.createElement("a");
				call.setAttribute("data-footnote-call", id);
				el.parentNode.insertBefore(call, el);

				el.setAttribute("data-footnote-body", id);
				el.remove();

				this.#footnoteMap.set(id, {
					callElement: call,
					bodyElement: el,
					blockSize: 0,
				});
				this.#allCalls.push(id);
			}
		}

		if (this.#footnoteMap.size > 0) {
			if (!this.#defaultSheet) {
				this.#defaultSheet = new CSSStyleSheet();
				this.#defaultSheet.replaceSync(FOOTNOTE_STYLES);
			}
			if (styles[0] !== this.#defaultSheet) {
				styles.unshift(this.#defaultSheet);
			}
		}

		return [];
	}

	matches(node) {
		return node.getCustomProperty("float") === "footnote";
	}

	layout() {
		return { reservedBlockStart: 0, reservedBlockEnd: 0, afterRender: null };
	}

	afterContentLayout(fragment, constraintSpace, inputBreakToken) {
		if (this.#allCalls.length === 0) return null;

		if (!this.#measured) {
			this.#measureBodies(constraintSpace);
		}

		const callsOnPage = this.#findCallsOnPage(inputBreakToken, fragment.breakToken);

		if (callsOnPage.length === 0) return null;

		const reservedBlockEnd = callsOnPage.reduce(
			(sum, id) => sum + this.#footnoteMap.get(id).blockSize,
			0,
		);

		const capturedCalls = [...callsOnPage];
		return {
			reservedBlockEnd,
			afterRender: (wrapper) => this.#renderFootnotes(capturedCalls, wrapper),
		};
	}

	/**
	 * Create a dedicated <content-measure> for footnote bodies,
	 * insert them, and read their block sizes.
	 */
	#measureBodies(constraintSpace) {
		const measurer = document.createElement("content-measure");
		measurer.classList.add("footnotes");
		measurer.setupEmpty(this.#styles);
		measurer.style.width = `${constraintSpace.availableInlineSize}px`;

		for (const [, entry] of this.#footnoteMap) {
			// Override display:none from the CSS rewrite so bodies are measurable
			entry.bodyElement.style.setProperty("display", "block");
			measurer.contentRoot.appendChild(entry.bodyElement);
		}

		document.body.appendChild(measurer);
		void measurer.offsetHeight;

		for (const [, entry] of this.#footnoteMap) {
			entry.blockSize = entry.bodyElement.offsetHeight;
		}

		this.#measurer = measurer;
		this.#measured = true;
	}

	/**
	 * Determine which footnote calls fall within the content placed on
	 * this page by comparing call positions to the break boundaries.
	 *
	 * Uses Node.compareDocumentPosition() for correct ordering at any
	 * nesting depth. A call is on this page if it comes at or after the
	 * input boundary and before the output boundary.
	 */
	#findCallsOnPage(inputBreakToken, outputBreakToken) {
		const startBoundary = getBreakBoundaryElement(inputBreakToken);
		const endBoundary = getBreakBoundaryElement(outputBreakToken);

		return this.#allCalls.filter((id) => {
			const callEl = this.#footnoteMap.get(id).callElement;

			if (startBoundary) {
				const pos = startBoundary.compareDocumentPosition(callEl);
				// Call must follow or equal the start boundary
				if (pos !== 0 && !(pos & Node.DOCUMENT_POSITION_FOLLOWING)) {
					return false;
				}
			}

			if (endBoundary) {
				const pos = callEl.compareDocumentPosition(endBoundary);
				// End boundary must follow or equal the call
				if (pos !== 0 && !(pos & Node.DOCUMENT_POSITION_FOLLOWING)) {
					return false;
				}
			}

			return true;
		});
	}

	/**
	 * Render footnote bodies into a footnote area at the bottom of the
	 * fragmentainer wrapper.
	 */
	#renderFootnotes(callIds, wrapper) {
		const area = document.createElement("div");
		area.classList.add("footnote-area");
		area.style.setProperty("position", "absolute");
		area.style.setProperty("bottom", "0");
		area.style.setProperty("left", "0");
		area.style.setProperty("right", "0");

		for (const id of callIds) {
			const entry = this.#footnoteMap.get(id);
			const body = entry.bodyElement.cloneNode(true);
			body.setAttribute("data-footnote-marker", "");
			body.removeAttribute("data-footnote-body");
			body.style.setProperty("display", "block");
			area.appendChild(body);
		}

		wrapper.style.setProperty("position", "relative");
		wrapper.appendChild(area);
	}

	/**
	 * Clean up the footnote measurement container.
	 */
	destroy() {
		if (this.#measurer) {
			this.#measurer.remove();
			this.#measurer = null;
		}
		this.#footnoteMap.clear();
		this.#allCalls = [];
		this.#measured = false;
	}
}

export const Footnote = new FootnoteLayoutModule();
