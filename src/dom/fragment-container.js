/**
 * <fragment-container> — visible page container with Shadow DOM.
 *
 * Wraps rendered fragment output to prevent CSS leakage from the
 * host page. Uses `all: initial` on :host to reset inherited CSS
 * properties to browser defaults. Body/html-targeting rules are
 * re-applied as :host overrides via the adopted stylesheet pipeline.
 *
 * Content is appended to a <slot> element as fallback content,
 * keeping it inside the shadow DOM where only adopted stylesheets apply.
 */

import { OVERRIDES } from "../styles/overrides.js";

const CONTAINER_HOST_STYLES = `
  :host {
    all: initial;
    display: block;
    contain: strict;
    text-rendering: geometricPrecision;
  }
  slot {
    display: block;
    min-height: 100%;
  }
`;

export class FragmentContainerElement extends HTMLElement {
  #shadow;
  #slot = null;
  #fragmentIndex = -1;
  #resizeObserver = null;
  #mutationObserver = null;
  #mutationBuffer = [];
  #notifyPending = false;
  #expectedBlockSize = null;
  #overflowThreshold = 0;
  #namedPage = null;
  #pageConstraints = null;

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
    style.textContent = CONTAINER_HOST_STYLES;
    this.#shadow.appendChild(style);
    this.#slot = document.createElement("slot");
    this.#shadow.appendChild(this.#slot);
  }

  get fragmentIndex() {
    return this.#fragmentIndex;
  }
  set fragmentIndex(idx) {
    this.#fragmentIndex = idx;
  }

  get namedPage() {
    return this.#namedPage;
  }
  set namedPage(value) {
    this.#namedPage = value || null;
  }

  get pageConstraints() {
    return this.#pageConstraints;
  }
  set pageConstraints(value) {
    this.#pageConstraints = value || null;
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
      const renderedBlockSize =
        entry.contentBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
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
   * Attach ResizeObserver and MutationObserver on the content slot.
   * Deferred via requestAnimationFrame to skip the initial
   * ResizeObserver notification.
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
      this.#mutationObserver.observe(this.#slot, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      });
    });
  }

  /**
   * Disconnect all observers.
   */
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
   * Adopt content styles and prepare the slot for rendering.
   *
   * When contentStyles is provided (from ContentMeasureElement.getContentStyles())
   * uses those cached styles. Clears any existing content in the slot.
   *
   * @param {Object} [contentStyles] — from ContentMeasureElement.getContentStyles()
   * @param {Object} [counterSnapshot] — counter state from previous fragmentainer
   * @returns {Element} slot element to append rendered content into
   */
  setupForRendering(contentStyles, counterSnapshot = null) {
    this.#ensureSetup();
    this.#slot.innerHTML = "";

    if (contentStyles.sheets.length > 0) {
      this.#shadow.adoptedStyleSheets = [...contentStyles.sheets, OVERRIDES];
    } else {
      this.#shadow.adoptedStyleSheets = [OVERRIDES];
    }

    // Seed counter values from the previous fragmentainer's snapshot.
    // Inserted before OVERRIDES so OVERRIDES has higher cascade priority.
    if (counterSnapshot && Object.keys(counterSnapshot).length > 0) {
      const counterSheet = new CSSStyleSheet();
      const pairs = Object.entries(counterSnapshot)
        .map(([name, value]) => `${name} ${value}`)
        .join(" ");
      counterSheet.replaceSync(`:host { counter-set: ${pairs}; }`);
      const sheets = this.#shadow.adoptedStyleSheets;
      this.#shadow.adoptedStyleSheets = [
        ...sheets.slice(0, -1),
        counterSheet,
        sheets[sheets.length - 1],
      ];
    }

    return this.#slot;
  }

  /**
   * The slot element inside the shadow root — content container.
   */
  get contentRoot() {
    return this.#slot;
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

  /**
   * Adopt a per-fragment nth-selector override stylesheet.
   * Inserted before OVERRIDES so it wins by source order over the
   * original nth pseudo-classes but OVERRIDES still has highest priority.
   *
   * @param {CSSStyleSheet} nthSheet
   */
  adoptNthSheet(nthSheet) {
    const sheets = this.#shadow.adoptedStyleSheets;
    // Insert before OVERRIDES (last sheet)
    this.#shadow.adoptedStyleSheets = [
      ...sheets.slice(0, -1),
      nthSheet,
      sheets[sheets.length - 1],
    ];
  }
}

customElements.define("fragment-container", FragmentContainerElement);
