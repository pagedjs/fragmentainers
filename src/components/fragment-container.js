/**
 * <fragment-container> — visible page container.
 *
 * Custom element that hosts the rendered output of one fragmentainer as
 * light-DOM children, projected through a `<slot>` in its shadow root.
 * Anchor link targets remain in the document tree, so hash navigation
 * and PDF link annotations resolve natively.
 *
 * The shadow root holds only the structural scaffold (host CSS +
 * `<slot>`). Author/handler/override stylesheets adopt at the document
 * level via the engine's composite scoped sheet. Each fragment's
 * counter snapshot is set as inline `style.counterSet`; style
 * containment isolates the counter scope per container.
 *
 * Observers target the inner `<slot>` (whose flow size reflects the
 * projected content) — the host is size-contained and fixed-size.
 */

const HOST_STYLES = `
  :host {
    display: block;
    overflow: clip;
    contain: size style;
    block-size: 100%;
  }
  slot {
    display: block;
    height: 100%;
  }
`;

export class FragmentContainerElement extends HTMLElement {
	#shadow;
	#slot;
	#fragmentIndex = -1;
	#resizeObserver = null;
	#mutationObserver = null;
	#mutationBuffer = [];
	#notifyPending = false;
	#expectedBlockSize = null;
	#overflowThreshold = 0;
	#namedPage = null;
	#constraints = null;

	constructor() {
		super();
		this.#shadow = this.attachShadow({ mode: "open" });
		const style = document.createElement("style");
		style.textContent = HOST_STYLES;
		this.#shadow.appendChild(style);
		this.#slot = document.createElement("slot");
		this.#shadow.appendChild(this.#slot);
	}

	connectedCallback() {
		this.setAttribute("role", "none");
	}

	get fragmentIndex() {
		return this.#fragmentIndex;
	}
	set fragmentIndex(idx) {
		this.#fragmentIndex = idx;
		this.dataset.fragment = idx;
	}

	get namedPage() {
		return this.#namedPage;
	}
	set namedPage(value) {
		this.#namedPage = value || null;
		if (this.#namedPage) {
			this.dataset.pageName = this.#namedPage;
		} else {
			delete this.dataset.pageName;
		}
	}

	get constraints() {
		return this.#constraints;
	}
	set constraints(value) {
		this.#constraints = value || null;
	}

	/**
	 * Coalesce multiple observer fires into one fragment-change event.
	 * Uses queueMicrotask so a mutation that also causes a resize
	 * dispatches only once.
	 */
	#scheduleNotify() {
		if (this.#notifyPending) return;
		this.#notifyPending = true;
		queueMicrotask(() => {
			this.#notifyPending = false;
			this.dispatchEvent(
				new CustomEvent("fragment-change", {
					bubbles: true,
					detail: { index: this.#fragmentIndex },
				}),
			);
		});
	}

	/**
	 * Check whether the rendered content height diverges from the
	 * layout-computed expected size. Dispatches an `overflow` event
	 * when the rendered output is taller than what layout predicted.
	 */
	#checkOverflow(entries) {
		if (this.#expectedBlockSize === null) return;
		for (const entry of entries) {
			const renderedBlockSize = entry.contentBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
			const delta = renderedBlockSize - this.#expectedBlockSize;
			if (delta > this.#overflowThreshold) {
				this.dispatchEvent(
					new CustomEvent("overflow", {
						bubbles: true,
						detail: {
							index: this.#fragmentIndex,
							expectedBlockSize: this.#expectedBlockSize,
							renderedBlockSize,
							overflow: delta,
						},
					}),
				);
			}
		}
	}

	/**
	 * Attach ResizeObserver on the slot (tracks projected content's
	 * natural height) and MutationObserver on the host (where slotted
	 * children live).
	 */
	startObserving() {
		if (this.#resizeObserver) return;
		requestAnimationFrame(() => {
			this.#resizeObserver = new ResizeObserver((entries) => {
				this.#checkOverflow(entries);
				this.#scheduleNotify();
			});
			this.#resizeObserver.observe(this.#slot);

			this.#mutationObserver = new MutationObserver((mutations) => {
				this.#mutationBuffer.push(...mutations);
				this.#scheduleNotify();
			});
			this.#mutationObserver.observe(this, {
				childList: true,
				subtree: true,
				characterData: true,
				attributes: true,
			});
		});
	}

	stopObserving() {
		this.#resizeObserver?.disconnect();
		this.#resizeObserver = null;
		this.#mutationObserver?.disconnect();
		this.#mutationObserver = null;
		this.#mutationBuffer = [];
	}

	/**
	 * Return and drain all buffered MutationRecords, plus any
	 * pending undelivered records from the observer.
	 * @returns {MutationRecord[]}
	 */
	takeMutationRecords() {
		if (this.#mutationObserver) {
			this.#mutationBuffer.push(...this.#mutationObserver.takeRecords());
		}
		return this.#mutationBuffer.splice(0);
	}

	disconnectedCallback() {
		this.stopObserving();
	}

	/**
	 * Set the expected block size from layout. The ResizeObserver
	 * compares the rendered content height against this value to
	 * detect when rendering diverges from the layout computation.
	 *
	 * @param {number} blockSize — constraint area height
	 */
	set expectedBlockSize(blockSize) {
		this.#expectedBlockSize = blockSize;
	}

	/**
	 * Set the overflow threshold. The `overflow` event only fires
	 * when the delta exceeds this value (e.g. one line height).
	 *
	 * @param {number} threshold — minimum delta in px to trigger event
	 */
	set overflowThreshold(threshold) {
		this.#overflowThreshold = threshold;
	}
}

customElements.define("fragment-container", FragmentContainerElement);
