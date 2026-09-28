import { defineElement } from "./define.js";

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

/**
 * Off-screen measurement container with Shadow DOM.
 *
 * Injects content and CSS into a shadow root so the host page's styles do
 * not affect measurements. `all: initial` resets inherited properties;
 * body/html rules are reapplied as host overrides. The slot's fallback
 * content stays in the shadow tree and uses the adopted measurement sheets.
 *
 * @returns {ContentMeasureElement} Measurement container element
 */
export class ContentMeasureElement extends HTMLElement {
	#shadow;
	#slot = null;
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
		this.#syncLang();
	}

	#syncLang() {
		if (!this.#slot) return;
		const lang = this.getAttribute("lang") || document.documentElement.lang || "";
		if (lang) {
			this.#slot.setAttribute("lang", lang);
		} else {
			this.#slot.removeAttribute("lang");
		}
	}

	/**
	 * Synchronize this measurement container with a fragmentainer's
	 * constraint space by updating its inline size. The browser lays out at
	 * the new width on the next geometry read, so a caller batching several
	 * writes before that read pays for one layout, not one per write.
	 *
	 * No-ops when the inline size hasn't changed.
	 *
	 * @param {import('../fragmentation/constraint-space.js').ConstraintSpace} constraintSpace
	 */
	applyConstraintSpace(constraintSpace) {
		const inlineSize = constraintSpace.availableInlineSize;
		if (this.#currentInlineSize === inlineSize) return;
		this.#currentInlineSize = inlineSize;
		this.style.width = constraintSpace.cssInlineSize || `${inlineSize}px`;
	}

	/**
	 * Inject a DocumentFragment and adopt CSSStyleSheets for measurement.
	 *
	 * @param {DocumentFragment} fragment — content to inject
	 * @param {CSSStyleSheet[]} [styles] — sheets to adopt for measurement
	 * @returns {Element} the slot element (contentRoot) to wrap with a DOMLayoutNode
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
		this.#shadow.adoptedStyleSheets = [...styles];
		this.#syncLang();
		return this.#slot;
	}

	/**
	 * The slot element inside the shadow root — content container.
	 * Wrap with `new DOMLayoutNode()` to build a layout tree.
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

defineElement("content-measure", ContentMeasureElement);
