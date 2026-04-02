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

import { extractNthDescriptors } from "../styles/nth-selectors.js";
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
  #nthDescriptors = [];
  #currentInlineSize = undefined;
  #trackRefs = false;
  #refMap = new Map();
  #sourceRefs = new WeakMap();
  #nextRefId = 0;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "closed" });
  }

  connectedCallback() {
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
   * Inject a DocumentFragment and adopt CSSStyleSheets for measurement.
   *
   * @param {DocumentFragment} fragment — content to inject
   * @param {CSSStyleSheet[]} [styles] — sheets to adopt for measurement
   * @returns {Element} the slot element (contentRoot) for buildLayoutTree
   */
  injectFragment(fragment, styles = []) {
    this.setupEmpty(styles);
    this.#slot.appendChild(fragment);

    if (this.#trackRefs) {
      for (const el of this.#slot.querySelectorAll("*")) {
        this.#trackElement(el);
      }
    }

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

    // Build override sheets for body/html selectors.
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

    // Extract nth-selector descriptors (without mutating sheets).
    // Per-fragment override sheets are built at render time.
    this.#nthDescriptors = extractNthDescriptors(styles);

    // Auto-enable ref tracking when nth descriptors exist — the
    // per-fragment stylesheet builder needs data-ref on every element.
    if (this.#nthDescriptors.length > 0) this.#trackRefs = true;

    this.#refMap = new Map();
    this.#sourceRefs = new WeakMap();
    this.#nextRefId = 0;

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
   * Get the content styles and ref maps for reuse in rendering.
   * Call after injectFragment() to capture styles.
   *
   * @returns {{ sheets: CSSStyleSheet[], nthDescriptors: NthDescriptor[],
   *             sourceRefs: WeakMap, refMap: Map }}
   */
  getContentStyles() {
    return {
      sheets: [...this.#shadow.adoptedStyleSheets],
      nthDescriptors: this.#nthDescriptors,
      sourceRefs: this.#trackRefs ? this.#sourceRefs : null,
      refMap: this.#trackRefs ? this.#refMap : null,
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

  /** @returns {number} the next ref ID (for saving/restoring ref state) */
  get nextRefId() {
    return this.#nextRefId;
  }

  /**
   * Replace ref state with previously saved maps. Used when recreating
   * a measurer from a DocumentFragment whose elements were already tracked.
   *
   * @param {Map<string, Element>} refMap
   * @param {WeakMap<Element, string>} sourceRefs
   * @param {number} nextRefId
   */
  transferRefs(refMap, sourceRefs, nextRefId) {
    this.#refMap = refMap;
    this.#sourceRefs = sourceRefs;
    this.#nextRefId = nextRefId;
  }

  #trackElement(el) {
    const ref = String(this.#nextRefId++);
    this.#sourceRefs.set(el, ref);
    this.#refMap.set(ref, el);
    return ref;
  }
}

customElements.define("content-measure", ContentMeasureElement);
