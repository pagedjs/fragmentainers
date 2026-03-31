/**
 * <content-measure> — off-screen measurement container with Shadow DOM.
 *
 * Injects content + CSS into a shadow root so the host page's styles
 * don't affect layout measurements. Uses `all: initial` on :host to
 * reset inherited CSS properties to browser defaults.
 */

import { buildNthOverrideSheet } from "../nth-selectors.js";

const MEASURE_HOST_STYLES = `
  :host {
    all: initial;
    display: block;
    contain: layout paint;
  }
`;

export class ContentMeasureElement extends HTMLElement {
  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "closed" });
    this._wrapper = null;
    this._nthOverrideSheet = null;
    this._nthFormulas = new Map();
    this._currentInlineSize = undefined;
    this._refMap = new Map();
    this._sourceRefs = new WeakMap();
    this._nextRefId = 0;
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
    if (this._currentInlineSize === inlineSize) return;
    this._currentInlineSize = inlineSize;
    this.style.width = `${inlineSize}px`;
    void this.offsetHeight; // Force synchronous reflow
  }

  /**
   * Inject a DocumentFragment and CSSStyleSheets into the shadow root.
   *
   * @param {DocumentFragment} fragment — content to inject
   * @param {CSSStyleSheet[]} [styles] — sheets to adopt for measurement
   * @returns {Element} the wrapper element (contentRoot) for buildLayoutTree
   */
  injectFragment(fragment, styles = []) {
    this._shadow.innerHTML = "";

    // Host styles
    const hostStyle = document.createElement("style");
    hostStyle.textContent = MEASURE_HOST_STYLES;
    this._shadow.appendChild(hostStyle);

    // Adopt caller-provided sheets as-is for measurement.
    // Build a separate override sheet with attribute-selector equivalents
    // of nth pseudo-classes for rendering (original sheets stay unmodified).
    this._shadow.adoptedStyleSheets = [...styles];
    const nth = buildNthOverrideSheet(styles);
    this._nthOverrideSheet = nth.sheet;
    this._nthFormulas = nth.formulas;

    // Create wrapper div that content CSS targets via .frag-body
    this._wrapper = document.createElement("div");
    this._wrapper.className = "frag-body";
    this._wrapper.appendChild(fragment);
    this._shadow.appendChild(this._wrapper);

    // Build ref maps for clone-to-source mapping (no DOM mutation)
    this._refMap = new Map();
    this._sourceRefs = new WeakMap();
    this._nextRefId = 0;
    for (const el of this._wrapper.querySelectorAll("*")) {
      this._trackElement(el);
    }

    return this._wrapper;
  }

  /**
   * The wrapper element inside the shadow root.
   * Pass this to buildLayoutTree().
   */
  get contentRoot() {
    return this._wrapper;
  }

  /**
   * Get the content styles and ref maps for reuse in rendering.
   * Call after injectFragment() to capture styles.
   *
   * @returns {{ sheets: CSSStyleSheet[], nthFormulas: Map, sourceRefs: WeakMap }}
   */
  getContentStyles() {
    const sheets = this._nthOverrideSheet && this._nthOverrideSheet.cssRules.length > 0
      ? [...this._shadow.adoptedStyleSheets, this._nthOverrideSheet]
      : [...this._shadow.adoptedStyleSheets];
    return { sheets, nthFormulas: this._nthFormulas, sourceRefs: this._sourceRefs };
  }

  /** @returns {Map<string, Element>} ref string → source element */
  get refMap() { return this._refMap; }

  /** @returns {WeakMap<Element, string>} source element → ref string */
  get sourceRefs() { return this._sourceRefs; }

  /**
   * Track a new element in the ref maps (no DOM mutation).
   * @param {Element} el
   * @returns {string} the assigned ref
   */
  assignRef(el) { return this._trackElement(el); }

  /**
   * Remove a ref from the maps (e.g., when an element is deleted).
   * @param {string} ref
   */
  removeRef(ref) {
    const el = this._refMap.get(ref);
    if (el) this._sourceRefs.delete(el);
    this._refMap.delete(ref);
  }

  _trackElement(el) {
    const ref = String(this._nextRefId++);
    this._sourceRefs.set(el, ref);
    this._refMap.set(ref, el);
    return ref;
  }
}

customElements.define("content-measure", ContentMeasureElement);
