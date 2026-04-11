/**
 * <content-measure> — off-screen measurement container with Shadow DOM.
 *
 * Injects content + CSS into a shadow root so the host page's styles
 * don't affect layout measurements. Uses `all: initial` on :host to
 * reset inherited CSS properties to browser defaults. Body/html-targeting
 * rules are re-applied as :host overrides so inherited properties
 * flow correctly to content inside the slot.
 *
 * Content is appended to a <slot> element as fallback content,
 * keeping it inside the shadow DOM where only adopted stylesheets apply.
 */

import { buildBodyOverrideSheet } from "../styles/body-selectors.js";

const MEASURE_HOST_STYLES = `
  :host {
    all: initial;
    display: block;
    position: fixed;
    left: -99999px;
    contain: strict;
  }
  slot {
    display: block;
  }
`;

export class ContentMeasureElement extends HTMLElement {
	#shadow;
	#slot = null;
	#bodyOverrideSheet = null;
	#currentInlineSize = undefined;

	constructor() {
		super();
		this.#shadow = this.attachShadow({ mode: "open" });
	}

	connectedCallback() {
		this.setAttribute("role", "none");
		this.#ensureSetup();
	}

	/**
	 * Build the one-time shadow DOM structure (host styles + slot).
	 * Called lazily — safe to invoke before or after connection.
	 */
	#ensureSetup() {
		if (this.#slot) return;
		const style = document.createElement("style");
		style.textContent = MEASURE_HOST_STYLES;
		this.#shadow.appendChild(style);
		this.#slot = document.createElement("slot");
		this.#shadow.appendChild(this.#slot);
	}

	/**
	 * Synchronize this measurement container with a fragmentainer's
	 * constraint space. Updates the container's inline size and forces
	 * a synchronous browser reflow so that subsequent
	 * getBoundingClientRect() and Range.getClientRects() calls return
	 * values at the correct width.
	 *
	 * No-ops when the inline size hasn't changed.
	 *
	 * @param {import('../constraint-space.js').ConstraintSpace} constraintSpace
	 */
	applyConstraintSpace(constraintSpace) {
		const inlineSize = constraintSpace.availableInlineSize;
		if (this.#currentInlineSize === inlineSize) return;
		this.#currentInlineSize = inlineSize;
		this.style.width = constraintSpace.cssInlineSize || `${inlineSize}px`;
		void this.offsetHeight; // Force synchronous reflow
	}

	/**
	 * Inject a DocumentFragment and adopt CSSStyleSheets for measurement.
	 *
	 * @param {DocumentFragment} fragment — content to inject
	 * @param {CSSStyleSheet[]} [styles] — sheets to adopt for measurement
	 * @returns {Element} the slot element (contentRoot) for buildLayoutTree
	 */
	injectFragment(fragment, styles = []) {
		this.setupEmpty(styles);
		this.#slot.appendChild(fragment);
		return this.#slot;
	}

	/**
	 * Set up stylesheets and clear content — but inject nothing.
	 *
	 * @param {CSSStyleSheet[]} [styles] — sheets to adopt for measurement
	 * @returns {Element} the slot element (contentRoot)
	 */
	setupEmpty(styles = []) {
		this.#ensureSetup();
		this.#slot.innerHTML = "";

		const body = buildBodyOverrideSheet(styles, document.body, document.documentElement);
		this.#bodyOverrideSheet = body.sheet;
		this.#shadow.adoptedStyleSheets =
			this.#bodyOverrideSheet.cssRules.length > 0
				? [...styles, this.#bodyOverrideSheet]
				: [...styles];

		return this.#slot;
	}

	/**
	 * The slot element inside the shadow root — content container.
	 * Pass this to buildLayoutTree().
	 */
	get contentRoot() {
		return this.#slot;
	}

	/**
	 * Get the content styles for composition.
	 * Call after injectFragment() to capture styles.
	 *
	 * @returns {{ sheets: CSSStyleSheet[] }}
	 */
	getContentStyles() {
		return {
			sheets: [...this.#shadow.adoptedStyleSheets],
		};
	}
}

customElements.define("content-measure", ContentMeasureElement);
