import { locate } from "./locate.js";

// Default overflow threshold: browser default line height (16px * 1.2).
// Used when the fragment's root node has no computed lineHeight.
export const DEFAULT_OVERFLOW_THRESHOLD = 16 * 1.2;

/**
 * Serialize a counter snapshot's innermost values as a `counter-set` value.
 *
 * @param {Readonly<Record<string, number>>} values - `CounterSnapshot.values`
 * @returns {string}
 */
function formatCounterSet(values) {
	const parts = [];
	for (const [name, value] of Object.entries(values)) {
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
	#previous = null;
	#contentStyles;
	#handlers;
	#indexOffset = 0;

	static get [Symbol.species]() {
		return Array;
	}

	/**
	 * @param {import("./fragment.js").Fragment[]} fragments
	 * @param {{ sheets: CSSStyleSheet[] }|null} contentStyles
	 * @param {{ start?: number, stop?: number, previous?: import("./fragment.js").Fragment|null, handlers?: import("../handlers/registry.js").HandlerRegistry|null, indexOffset?: number }} [range]
	 *   `previous` is the fragment preceding index 0 of `fragments` — set when
	 *   this context holds a slice of a longer flow (reflow), so the first
	 *   fragmentainer still resumes its counters and split decorations.
	 */
	constructor(
		fragments,
		contentStyles,
		{ start = 0, stop, previous = null, handlers = null, indexOffset = 0 } = {},
	) {
		super();
		this.#fragments = fragments;
		this.#previous = previous;
		this.#contentStyles = contentStyles;
		this.#handlers = handlers;
		this.#indexOffset = indexOffset;
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

	/** Locate every fragmentainer occupied by a source element. */
	locate(element) {
		return locate(this.#fragments, element, {
			previous: this.#previous,
			indexOffset: this.#indexOffset,
		});
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

		const prev = index > 0 ? this.#fragments[index - 1] : this.#previous;
		const counterSnapshot = prev?.counterState ?? null;
		if (counterSnapshot && Object.keys(counterSnapshot.values).length > 0) {
			el.style.counterSet = formatCounterSet(counterSnapshot.values);
		}

		if (fragment.isBlank) {
			el.setAttribute("data-blank-page", "");
			el.expectedBlockSize = contentArea.blockSize;
			el.overflowThreshold = 0;
		} else {
			const prevBreakToken = prev?.breakToken ?? null;
			el.appendChild(fragment.build(prevBreakToken));

			if (fragment.afterRender) {
				for (const callback of fragment.afterRender) {
					callback(el, this.#contentStyles);
				}
			}

			el.expectedBlockSize = contentArea.blockSize;
			el.overflowThreshold = findLastIFCLineHeight(fragment) || DEFAULT_OVERFLOW_THRESHOLD;
		}

		this.#handlers?.afterCompose(el, fragment);
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
		if (child.node.isInlineNode) {
			return child.node.lineHeight;
		}
		const result = findLastIFCLineHeight(child);
		if (result) return result;
	}
	return null;
}
