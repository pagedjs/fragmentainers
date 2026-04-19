// Default overflow threshold: browser default line height (16px * 1.2).
// Used when the fragment's root node has no computed lineHeight.
export const DEFAULT_OVERFLOW_THRESHOLD = 16 * 1.2;

function formatCounterSet(snapshot) {
	const parts = [];
	for (const [name, value] of Object.entries(snapshot)) {
		parts.push(`${name} ${value}`);
	}
	return parts.join(" ");
}

/**
 * The result of running fragmentation — a "fragmented flow" in CSS spec terms.
 *
 * Extends Array so it is directly iterable as the array of
 * <fragment-container> elements. Also exposes the underlying
 * Fragment data via .fragments.
 */
export class FragmentationContext extends Array {
	#fragments;
	#contentStyles;

	static get [Symbol.species]() {
		return Array;
	}

	/**
	 * @param {import("./fragment.js").Fragment[]} fragments
	 * @param {{ sheets: CSSStyleSheet[] }|null} contentStyles
	 * @param {{ start?: number, stop?: number }} [range]
	 */
	constructor(fragments, contentStyles, { start = 0, stop } = {}) {
		super();
		this.#fragments = fragments;
		this.#contentStyles = contentStyles;
		if (contentStyles) {
			const end = stop ?? fragments.length;
			for (let i = start; i < end; i++) {
				this.push(this.createFragmentainer(i));
			}
		}
	}

	/** @returns {import("./fragment.js").Fragment[]} */
	get fragments() {
		return this.#fragments;
	}

	/** @returns {number} */
	get fragmentainerCount() {
		return this.#fragments.length;
	}

	/**
	 * Create a single <fragment-container> element for the given index.
	 *
	 * @param {number} index - Zero-based fragmentainer index
	 * @returns {Element} A <fragment-container> element
	 */
	createFragmentainer(index) {
		const fragment = this.#fragments[index];
		const { contentArea } = fragment.constraints;

		const el = document.createElement("fragment-container");
		el.fragmentIndex = index;
		el.constraints = fragment.constraints;
		el.namedPage = fragment.constraints?.namedPage ?? null;
		if (!fragment.constraints.pageBoxSize) {
			el.style.width = `${contentArea.inlineSize}px`;
			el.style.height = `${contentArea.blockSize}px`;
		}

		if (fragment.isFirst) el.setAttribute("data-first", "");
		if (fragment.isLast) el.setAttribute("data-last", "");

		const counterSnapshot = index > 0 ? this.#fragments[index - 1].counterState : null;
		if (counterSnapshot && Object.keys(counterSnapshot).length > 0) {
			el.style.counterSet = formatCounterSet(counterSnapshot);
		}

		if (fragment.isBlank) {
			el.setAttribute("data-blank-page", "");
			el.expectedBlockSize = contentArea.blockSize;
			el.overflowThreshold = 0;
			return el;
		}

		const prevBreakToken = index > 0 ? this.#fragments[index - 1].breakToken : null;
		el.appendChild(fragment.build(prevBreakToken));
		fragment.map(prevBreakToken, el);

		if (fragment.afterRender) {
			for (const callback of fragment.afterRender) {
				callback(el, this.#contentStyles);
			}
		}

		el.expectedBlockSize = contentArea.blockSize;
		el.overflowThreshold = findLastIFCLineHeight(fragment) || DEFAULT_OVERFLOW_THRESHOLD;
		return el;
	}
}

/**
 * Walk the fragment tree bottom-up to find the last (deepest) IFC's
 * cached lineHeight. IFC nodes have lineHeight cached during layout,
 * so this works correctly even after the measurer is released and
 * elements are detached from the DOM.
 */
function findLastIFCLineHeight(fragment) {
	const children = fragment.childFragments;
	for (let i = children.length - 1; i >= 0; i--) {
		const child = children[i];
		if (!child.node) continue;
		if (child.node.isInlineFormattingContext) {
			return child.node.lineHeight;
		}
		const result = findLastIFCLineHeight(child);
		if (result) return result;
	}
	return null;
}
