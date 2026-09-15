import { locate } from "./locate.js";
import { restoreComposedCounters } from "./counter-state.js";

// Default overflow threshold: browser default line height (16px * 1.2).
// Used when the fragment's root node has no computed lineHeight.
export const DEFAULT_OVERFLOW_THRESHOLD = 16 * 1.2;

/**
 * The result of running fragmentation — a "fragmented flow" in CSS spec terms.
 *
 * Lazily iterates in document order over
 * <fragment-container> elements. Also exposes the underlying
 * Fragment data via .fragments.
 */
export class FragmentationContext extends Iterator {
	#fragments;
	#previous = null;
	#contentStyles;
	#handlers;
	#indexOffset = 0;

	#position;
	#stop;
	#started = false;
	#exhausted = false;
	#signal;
	#layoutFragments;
	#layoutIndexOffset;

	/**
	 * @param {import("./fragment.js").Fragment[]} fragments
	 * @param {{ sheets: CSSStyleSheet[] }|null} contentStyles
	 * @param {{ start?: number, stop?: number, previous?: import("./fragment.js").Fragment|null, handlers?: import("../handlers/registry.js").HandlerRegistry|null, indexOffset?: number, signal?: AbortSignal, layoutFragments?: import("./fragment.js").Fragment[], layoutIndexOffset?: number }} [range]
	 *   `previous` is the fragment preceding index 0 of `fragments` — set when
	 *   this context holds a slice of a longer flow (reflow), so the first
	 *   fragmentainer still resumes its counters and split decorations.
	 */
	constructor(
		fragments,
		contentStyles,
		{ start = 0, stop, previous = null, handlers = null, indexOffset = 0, signal,
			layoutFragments = fragments, layoutIndexOffset = indexOffset } = {},
	) {
		super();
		this.#fragments = fragments;
		this.#previous = previous;
		this.#contentStyles = contentStyles;
		this.#handlers = handlers;
		this.#indexOffset = indexOffset;
		this.#position = start;
		this.#stop = stop;
		this.#signal = signal;
		this.#layoutFragments = layoutFragments;
		this.#layoutIndexOffset = layoutIndexOffset;
	}

	/**
	 * Compose the next selected fragmentainer, after its layout has settled.
	 * @returns {IteratorResult<Element>} The next element or exhaustion.
	 */
	next() {
		if (this.#exhausted) return { value: undefined, done: true };
		this.#signal?.throwIfAborted();
		if (!this.#contentStyles || this.#position >= Math.min(this.#stop ?? this.#fragments.length, this.#fragments.length)) {
			this.#exhausted = true;
			return { value: undefined, done: true };
		}
		if (!this.#started) {
			this.#started = true;
			this.#handlers?.beforeComposition({
				fromIndex: this.#indexOffset + this.#position,
				fragments: this.#layoutFragments,
				indexOffset: this.#layoutIndexOffset,
			});
		}
		return { value: this.#createFragmentainer(this.#position++), done: false };
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
	#createFragmentainer(index) {
		const fragment = this.#fragments[index];
		const { contentArea } = fragment.constraints;

		const el = document.createElement("fragment-container");
		el.fragmentIndex = this.#indexOffset + index;
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

		if (fragment.isBlank) {
			el.setAttribute("data-blank-page", "");
			el.expectedBlockSize = contentArea.blockSize;
			el.overflowThreshold = 0;
		} else {
			const prevBreakToken = prev?.breakToken ?? null;
			const content = fragment.build(prevBreakToken);
			restoreComposedCounters(content, fragment, counterSnapshot);
			el.appendChild(content);

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
