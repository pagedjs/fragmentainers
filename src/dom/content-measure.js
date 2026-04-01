/**
 * <content-measure> — off-screen measurement container with Shadow DOM.
 *
 * Injects content + CSS into a shadow root so the host page's styles
 * don't affect layout measurements. Uses `all: initial` on :host to
 * reset inherited CSS properties to browser defaults.
 */

import { buildNthOverrideSheet } from "../styles/nth-selectors.js";
import { buildBodyOverrideSheet } from "../styles/body-selectors.js";

const MEASURE_HOST_STYLES = `
  :host {
    all: initial;
    display: block;
    position: fixed;
    left: -99999px;
    contain: strict;
  }
`;

export class ContentMeasureElement extends HTMLElement {
  #shadow;
  #wrapper = null;
  #bodyOverrideSheet = null;
  #nthOverrideSheet = null;
  #nthFormulas = new Map();
  #currentInlineSize = undefined;
  #trackRefs = false;
  #refMap = new Map();
  #sourceRefs = new WeakMap();
  #nextRefId = 0;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "closed" });
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
    this.style.width = `${inlineSize}px`;
    void this.offsetHeight; // Force synchronous reflow
  }

  /** Enable ref tracking for clone-to-source mapping (needed for MutationSync). */
  set trackRefs(value) {
    this.#trackRefs = !!value;
  }

  get trackRefs() {
    return this.#trackRefs;
  }

  /**
   * Inject a DocumentFragment and CSSStyleSheets into the shadow root.
   *
   * @param {DocumentFragment} fragment — content to inject
   * @param {CSSStyleSheet[]} [styles] — sheets to adopt for measurement
   * @returns {Element} the wrapper element (contentRoot) for buildLayoutTree
   */
  injectFragment(fragment, styles = []) {
    this.setupEmpty(styles);
    this.#wrapper.appendChild(fragment);

    if (this.#trackRefs) {
      for (const el of this.#wrapper.querySelectorAll("*")) {
        this.#trackElement(el);
      }
    }

    return this.#wrapper;
  }

  /**
   * Set up the shadow DOM, stylesheets, and wrapper — but inject no content.
   *
   * @param {CSSStyleSheet[]} [styles] — sheets to adopt for measurement
   * @returns {Element} the wrapper element (contentRoot)
   */
  setupEmpty(styles = []) {
    this.#shadow.innerHTML = "";

    // Host styles
    const hostStyle = document.createElement("style");
    hostStyle.textContent = MEASURE_HOST_STYLES;
    this.#shadow.appendChild(hostStyle);

    // Build override sheets for body/html selectors and nth pseudo-classes.
    // Original sheets are NOT mutated — overrides are appended after them
    // in adoptedStyleSheets so rewritten rules win by source order.
    const body = buildBodyOverrideSheet(
      styles,
      document.body,
      document.documentElement,
    );
    this.#bodyOverrideSheet = body.sheet;
    this.#shadow.adoptedStyleSheets =
      this.#bodyOverrideSheet.cssRules.length > 0
        ? [...styles, this.#bodyOverrideSheet]
        : [...styles];
    const nth = buildNthOverrideSheet(styles);
    this.#nthOverrideSheet = nth.sheet;
    this.#nthFormulas = nth.formulas;

    // Create wrapper div that content CSS targets via .frag-body
    this.#wrapper = document.createElement("div");
    this.#wrapper.className = "frag-body";
    this.#shadow.appendChild(this.#wrapper);

    this.#refMap = new Map();
    this.#sourceRefs = new WeakMap();
    this.#nextRefId = 0;

    return this.#wrapper;
  }

  /**
   * The wrapper element inside the shadow root.
   * Pass this to buildLayoutTree().
   */
  get contentRoot() {
    return this.#wrapper;
  }

  /**
   * Get the content styles and ref maps for reuse in rendering.
   * Call after injectFragment() to capture styles.
   *
   * @returns {{ sheets: CSSStyleSheet[], nthFormulas: Map, sourceRefs: WeakMap }}
   */
  getContentStyles() {
    const sheets =
      this.#nthOverrideSheet && this.#nthOverrideSheet.cssRules.length > 0
        ? [...this.#shadow.adoptedStyleSheets, this.#nthOverrideSheet]
        : [...this.#shadow.adoptedStyleSheets];
    return {
      sheets,
      nthFormulas: this.#nthFormulas,
      sourceRefs: this.#trackRefs ? this.#sourceRefs : null,
    };
  }

  /** @returns {Map<string, Element>} ref string → source element */
  get refMap() {
    return this.#refMap;
  }

  /** @returns {WeakMap<Element, string>} source element → ref string */
  get sourceRefs() {
    return this.#sourceRefs;
  }

  /**
   * Track a new element in the ref maps (no DOM mutation).
   * @param {Element} el
   * @returns {string} the assigned ref
   */
  assignRef(el) {
    return this.#trackElement(el);
  }

  /**
   * Remove a ref from the maps (e.g., when an element is deleted).
   * @param {string} ref
   */
  removeRef(ref) {
    const el = this.#refMap.get(ref);
    if (el) this.#sourceRefs.delete(el);
    this.#refMap.delete(ref);
  }

  #trackElement(el) {
    const ref = String(this.#nextRefId++);
    this.#sourceRefs.set(el, ref);
    this.#refMap.set(ref, el);
    return ref;
  }
}

customElements.define("content-measure", ContentMeasureElement);
