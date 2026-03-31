/**
 * <fragment-container> — visible page container with Shadow DOM.
 *
 * Wraps rendered fragment output to prevent CSS leakage from the
 * host page. Uses `all: initial` on :host to reset inherited CSS
 * properties to browser defaults.
 */

import { OVERRIDES } from "../compositor/overrides.js";
import { resolveMediaForPrintRules } from "./content-measure.js";
import { rewriteNthSelectors } from "../nth-selectors.js";

const CONTAINER_HOST_STYLES = `
  :host {
    all: initial;
    display: block;
    contain: strict;
  }
`;

export class FragmentContainerElement extends HTMLElement {
  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
    this._wrapper = null;
    this._fragmentIndex = -1;
    this._resizeObserver = null;
    this._mutationObserver = null;
    this._mutationBuffer = [];
    this._notifyPending = false;
  }

  get fragmentIndex() { return this._fragmentIndex; }
  set fragmentIndex(idx) { this._fragmentIndex = idx; }

  /**
   * Coalesce multiple observer fires into one fragment-change event.
   * Uses queueMicrotask so a mutation that also causes a resize
   * dispatches only once.
   */
  _scheduleNotify() {
    if (this._notifyPending) return;
    this._notifyPending = true;
    queueMicrotask(() => {
      this._notifyPending = false;
      this.dispatchEvent(new CustomEvent("fragment-change", {
        bubbles: true,
        detail: { index: this._fragmentIndex },
      }));
    });
  }

  /**
   * Attach ResizeObserver and MutationObserver on the content wrapper.
   * Deferred via requestAnimationFrame to skip the initial
   * ResizeObserver notification.
   */
  startObserving() {
    if (this._resizeObserver) return;
    requestAnimationFrame(() => {
      this._resizeObserver = new ResizeObserver(() => this._scheduleNotify());
      this._resizeObserver.observe(this._wrapper);

      this._mutationObserver = new MutationObserver((mutations) => {
        this._mutationBuffer.push(...mutations);
        this._scheduleNotify();
      });
      this._mutationObserver.observe(this._wrapper, {
        childList: true, subtree: true, characterData: true, attributes: true,
      });
    });
  }

  /**
   * Disconnect all observers.
   */
  stopObserving() {
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._mutationObserver?.disconnect();
    this._mutationObserver = null;
    this._mutationBuffer = [];
  }

  /**
   * Return and drain all buffered MutationRecords, plus any
   * pending undelivered records from the observer.
   * @returns {MutationRecord[]}
   */
  takeMutationRecords() {
    if (this._mutationObserver) {
      this._mutationBuffer.push(...this._mutationObserver.takeRecords());
    }
    return this._mutationBuffer.splice(0);
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
   * @param {boolean} [forPrint] — resolve @media print/screen for print context
   * @returns {Element} wrapper element to append rendered content into
   */
  setupForRendering(contentStyles, counterSnapshot = null, forPrint = false) {
    this._shadow.innerHTML = "";
    this._nthFormulas = null;

    // Host styles
    const hostStyle = document.createElement("style");
    hostStyle.textContent = CONTAINER_HOST_STYLES;
    this._shadow.appendChild(hostStyle);

    if (contentStyles) {
      // Use cached styles from <content-measure>
      if (contentStyles.sheets.length > 0) {
        this._shadow.adoptedStyleSheets = [...contentStyles.sheets, OVERRIDES];
      } else {
        this._shadow.adoptedStyleSheets = [OVERRIDES];
      }
      if (contentStyles.cssText) {
        const contentStyle = document.createElement("style");
        contentStyle.textContent = contentStyles.cssText;
        this._shadow.appendChild(contentStyle);
      }
      this._nthFormulas = contentStyles.nthFormulas || null;
    } else {
      // Copy stylesheets from the current document
      this._nthFormulas = copyDocumentStyles(this._shadow, forPrint);
    }

    // Seed counter values from the previous fragmentainer's snapshot.
    // Inserted before OVERRIDES so OVERRIDES has higher cascade priority.
    if (counterSnapshot && Object.keys(counterSnapshot).length > 0) {
      const counterSheet = new CSSStyleSheet();
      const pairs = Object.entries(counterSnapshot)
        .map(([name, value]) => `${name} ${value}`)
        .join(" ");
      counterSheet.replaceSync(`.frag-body { counter-set: ${pairs}; }`);
      const sheets = this._shadow.adoptedStyleSheets;
      this._shadow.adoptedStyleSheets = [
        ...sheets.slice(0, -1), counterSheet, sheets[sheets.length - 1]
      ];
    }

    // Create wrapper div that content CSS targets via .frag-body
    this._wrapper = document.createElement("div");
    this._wrapper.className = "frag-body";

    this._shadow.appendChild(this._wrapper);
    return this._wrapper;
  }

  /**
   * The wrapper element inside the shadow root.
   */
  get contentRoot() {
    return this._wrapper;
  }

  /**
   * Nth-selector formula descriptors extracted during stylesheet rewriting.
   * Pass to renderFragmentTree() so the compositor can stamp matching attributes.
   * @returns {Map|null}
   */
  get nthFormulas() {
    return this._nthFormulas;
  }
}

customElements.define("fragment-container", FragmentContainerElement);

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Copy document-level stylesheets into a shadow root via adoptedStyleSheets,
 * rewriting body/html selectors to target .frag-body/:host.
 *
 * @param {ShadowRoot} shadowRoot
 * @param {boolean} forPrint — resolve @media print/screen rules for print context
 */
function copyDocumentStyles(shadowRoot, forPrint = false) {
  const sheets = [];
  const nthFormulas = new Map();
  for (const sheet of document.styleSheets) {
    try {
      const copy = new CSSStyleSheet();
      let rules = "";
      if (forPrint) {
        rules = rewriteBodySelectors(resolveMediaForPrintRules(sheet.cssRules));
      } else {
        for (const rule of sheet.cssRules) {
          rules += rewriteBodySelectors(rule.cssText) + "\n";
        }
      }
      const nth = rewriteNthSelectors(rules, nthFormulas);
      copy.replaceSync(nth.cssText);
      sheets.push(copy);
    } catch (_) {
      // Cross-origin stylesheet — cssRules access throws SecurityError
    }
  }
  shadowRoot.adoptedStyleSheets = [...sheets, OVERRIDES];
  return nthFormulas;
}

/**
 * Rewrite `body` and `html` selectors in CSS text to target
 * the `.frag-body` wrapper inside the shadow root.
 *
 * @param {string} cssText
 * @returns {string}
 */
function rewriteBodySelectors(cssText) {
  let result = cssText.replace(/\bhtml\s+body\b/g, "body");
  result = result.replace(
    /(?:^|(?<=,\s*|}\s*))\bhtml\b(?=[{\s,.#:[>+~])/gm,
    ":host",
  );
  result = result.replace(/\bbody\b(?=[{\s,.#:[>+~])/g, ".frag-body");
  return result;
}
