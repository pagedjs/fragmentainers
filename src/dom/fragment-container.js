/**
 * <fragment-container> — visible page container with Shadow DOM.
 *
 * Wraps rendered fragment output to prevent CSS leakage from the
 * host page. Uses `all: initial` on :host to reset inherited CSS
 * properties to browser defaults.
 */

import { OVERRIDES } from "../compositor/overrides.js";

const CONTAINER_HOST_STYLES = `
  :host {
    all: initial;
    display: block;
    contain: strict;
  }
`;

export class FragmentContainerElement extends HTMLElement {
  #shadow;
  #wrapper = null;
  #fragmentIndex = -1;
  #resizeObserver = null;
  #mutationObserver = null;
  #mutationBuffer = [];
  #notifyPending = false;
  #nthFormulas = null;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "closed" });
  }

  get fragmentIndex() {
    return this.#fragmentIndex;
  }
  set fragmentIndex(idx) {
    this.#fragmentIndex = idx;
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
   * Attach ResizeObserver and MutationObserver on the content wrapper.
   * Deferred via requestAnimationFrame to skip the initial
   * ResizeObserver notification.
   */
  startObserving() {
    if (this.#resizeObserver) return;
    requestAnimationFrame(() => {
      this.#resizeObserver = new ResizeObserver(() => this.#scheduleNotify());
      this.#resizeObserver.observe(this.#wrapper);

      this.#mutationObserver = new MutationObserver((mutations) => {
        this.#mutationBuffer.push(...mutations);
        this.#scheduleNotify();
      });
      this.#mutationObserver.observe(this.#wrapper, {
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
   * Set up the shadow root with content styles for rendering.
   * Dimensions must be set on the host element by the caller.
   *
   * When contentStyles is provided (from ContentMeasureElement.getContentStyles()),
   * uses those cached styles. Otherwise copies stylesheets from the current
   * document so rendered content matches the page's styling.
   *
   * @param {Object} [contentStyles] — from ContentMeasureElement.getContentStyles()
   * @param {Object} [counterSnapshot] — counter state from previous fragmentainer
   * @returns {Element} wrapper element to append rendered content into
   */
  setupForRendering(contentStyles, counterSnapshot = null) {
    this.#shadow.innerHTML = "";
    this.#nthFormulas = null;

    // Host styles
    const hostStyle = document.createElement("style");
    hostStyle.textContent = CONTAINER_HOST_STYLES;
    this.#shadow.appendChild(hostStyle);

    if (contentStyles.sheets.length > 0) {
      this.#shadow.adoptedStyleSheets = [...contentStyles.sheets, OVERRIDES];
    } else {
      this.#shadow.adoptedStyleSheets = [OVERRIDES];
    }
    this.#nthFormulas = contentStyles.nthFormulas || null;

    // Seed counter values from the previous fragmentainer's snapshot.
    // Inserted before OVERRIDES so OVERRIDES has higher cascade priority.
    if (counterSnapshot && Object.keys(counterSnapshot).length > 0) {
      const counterSheet = new CSSStyleSheet();
      const pairs = Object.entries(counterSnapshot)
        .map(([name, value]) => `${name} ${value}`)
        .join(" ");
      counterSheet.replaceSync(`.frag-body { counter-set: ${pairs}; }`);
      const sheets = this.#shadow.adoptedStyleSheets;
      this.#shadow.adoptedStyleSheets = [
        ...sheets.slice(0, -1),
        counterSheet,
        sheets[sheets.length - 1],
      ];
    }

    // Create wrapper div that content CSS targets via .frag-body
    this.#wrapper = document.createElement("div");
    this.#wrapper.className = "frag-body";

    this.#shadow.appendChild(this.#wrapper);
    return this.#wrapper;
  }

  /**
   * The wrapper element inside the shadow root.
   */
  get contentRoot() {
    return this.#wrapper;
  }

  /**
   * Nth-selector formula descriptors extracted during stylesheet rewriting.
   * Pass to renderFragmentTree() so the compositor can stamp matching attributes.
   * @returns {Map|null}
   */
  get nthFormulas() {
    return this.#nthFormulas;
  }
}

customElements.define("fragment-container", FragmentContainerElement);
