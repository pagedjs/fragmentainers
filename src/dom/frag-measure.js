import { OVERRIDES } from "../compositor/overrides.js";

/**
 * Custom elements for CSS-isolated measurement and rendering.
 *
 * <content-measure> — off-screen measurement container with Shadow DOM.
 *   Injects content + CSS into a shadow root so the host page's styles
 *   don't affect layout measurements.
 *
 * <fragment-container> — visible page container with Shadow DOM.
 *   Wraps rendered fragment output to prevent CSS leakage from the host page.
 *
 * Both elements use `all: initial` on :host to reset inherited CSS properties
 * (font-size, line-height, etc.) to browser defaults, preventing the host
 * page's styles from affecting content inside the shadow root.
 */

// ---------------------------------------------------------------------------
// <content-measure> — off-screen measurement
// ---------------------------------------------------------------------------

/**
 * Host styles for measurement mode.
 * - all: initial resets inherited properties to browser defaults
 * - contain: layout paint (not strict — strict includes size → 0×0)
 */
const MEASURE_HOST_STYLES = `
  :host {
    all: initial;
    display: block;
    contain: layout paint;
  }
`;

class ContentMeasureElement extends HTMLElement {
  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
    this._wrapper = null;
    this._contentCSSText = "";
    this._currentInlineSize = undefined;
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
   * Inject content and CSS into the shadow root for measurement.
   *
   * @param {Object} options
   * @param {string} options.bodyHTML — HTML content to inject
   * @param {{ css: string, cssBaseURL: string }[]} options.cssEntries — CSS sources
   * @param {string} options.baseURL — base URL for rebasing relative paths
   * @param {boolean} [options.forPrint] — resolve @media print/screen for print context
   * @returns {Element} the wrapper element (contentRoot) for buildLayoutTree
   */
  injectContent({ bodyHTML, cssEntries, baseURL, forPrint = false }) {
    const { cssText, html } = preprocessContent({ bodyHTML, cssEntries, baseURL, forPrint });
    return this.injectRawContent(html, cssText);
  }

  /**
   * Inject pre-processed HTML and CSS into the shadow root.
   * Lower-level injection to avoid re-processing CSS.
   *
   * @param {string} html — rebased HTML content
   * @param {string} cssText — rebased + rewritten CSS text
   * @returns {Element} the wrapper element (contentRoot) for buildLayoutTree
   */
  injectRawContent(html, cssText) {
    this._shadow.innerHTML = "";

    // Host styles
    const hostStyle = document.createElement("style");
    hostStyle.textContent = MEASURE_HOST_STYLES;
    this._shadow.appendChild(hostStyle);

    this._contentCSSText = cssText;
    const contentStyle = document.createElement("style");
    contentStyle.textContent = cssText;
    this._shadow.appendChild(contentStyle);

    // Create wrapper div that content CSS targets via .frag-body
    this._wrapper = document.createElement("div");
    this._wrapper.className = "frag-body";
    this._wrapper.innerHTML = html;
    this._shadow.appendChild(this._wrapper);

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
   * Get the content styles for reuse in <fragment-container> rendering.
   * Call after injectContent() to capture styles for rendering.
   *
   * @returns {{ sheets: CSSStyleSheet[], cssText: string }}
   */
  getContentStyles() {
    return {
      sheets: [...this._shadow.adoptedStyleSheets],
      cssText: this._contentCSSText,
    };
  }
}

customElements.define("content-measure", ContentMeasureElement);

// ---------------------------------------------------------------------------
// <fragment-container> — visible page rendering
// ---------------------------------------------------------------------------

const CONTAINER_HOST_STYLES = `
  :host {
    all: initial;
    display: block;
    contain: strict;
  }
`;

class FragmentContainerElement extends HTMLElement {
  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
    this._wrapper = null;
    this._fragmentIndex = -1;
    this._resizeObserver = null;
    this._mutationObserver = null;
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

      this._mutationObserver = new MutationObserver(() => this._scheduleNotify());
      this._mutationObserver.observe(this._wrapper, {
        childList: true, subtree: true, characterData: true,
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
    } else {
      // Copy stylesheets from the current document
      copyDocumentStyles(this._shadow, forPrint);
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
}

customElements.define("fragment-container", FragmentContainerElement);

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/**
 * Resolve @media rules for a print context:
 * - `@media print` → unwrap (include child rules without the wrapper)
 * - `@media screen` (without print) → remove entirely
 * - Other @media → keep as-is
 *
 * Recurses into nested @media and other grouping rules.
 *
 * @param {CSSRuleList} rules
 * @returns {string} filtered CSS text
 */
function resolveMediaForPrintRules(rules) {
  let result = "";
  for (const rule of rules) {
    if (rule instanceof CSSMediaRule) {
      const text = rule.conditionText.toLowerCase();
      const hasPrint = /\bprint\b/.test(text);
      const hasScreen = /\bscreen\b/.test(text);
      if (hasPrint && !hasScreen) {
        // Print-only media — unwrap child rules
        result += resolveMediaForPrintRules(rule.cssRules);
        continue;
      }
      if (hasScreen && !hasPrint) {
        // Screen-only media — remove
        continue;
      }
      // Both, neither, or complex — keep as-is
    }
    result += rule.cssText + "\n";
  }
  return result;
}

/**
 * Filter CSS text to resolve @media print/screen rules.
 * Parses the text via CSSStyleSheet, resolves media rules, returns filtered text.
 *
 * @param {string} cssText
 * @returns {string} filtered CSS text
 */
function resolveMediaForPrintText(cssText) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(cssText);
  return resolveMediaForPrintRules(sheet.cssRules);
}

/**
 * Copy document-level stylesheets into a shadow root via adoptedStyleSheets,
 * rewriting body/html selectors to target .frag-body/:host.
 *
 * @param {ShadowRoot} shadowRoot
 * @param {boolean} forPrint — resolve @media print/screen rules for print context
 */
function copyDocumentStyles(shadowRoot, forPrint = false) {
  const sheets = [];
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
      copy.replaceSync(rules);
      sheets.push(copy);
    } catch (_) {
      // Cross-origin stylesheet — cssRules access throws SecurityError
    }
  }
  shadowRoot.adoptedStyleSheets = [...sheets, OVERRIDES];
}

/**
 * Rewrite `body` and `html` selectors in CSS text to target
 * the `.frag-body` wrapper inside the shadow root.
 *
 * Handles common patterns:
 * - `body { }` → `.frag-body { }`
 * - `body.class { }` → `.frag-body.class { }`
 * - `body > div { }` → `.frag-body > div { }`
 * - `html body { }` → `.frag-body { }`
 * - `html { }` → `:host { }`
 *
 * @param {string} cssText
 * @returns {string}
 */
function rewriteBodySelectors(cssText) {
  // Replace `html` followed by whitespace+body with just body
  let result = cssText.replace(/\bhtml\s+body\b/g, "body");

  // Replace standalone `html` selectors with :host
  result = result.replace(
    /(?:^|(?<=,\s*|}\s*))\bhtml\b(?=[{\s,.#:[>+~])/gm,
    ":host",
  );

  // Replace `body` selectors with `.frag-body`
  result = result.replace(/\bbody\b(?=[{\s,.#:[>+~])/g, ".frag-body");

  return result;
}

/**
 * Pre-process content: rebase URLs and rewrite CSS selectors.
 * Shared by injectContent() and external callers.
 *
 * @param {Object} options
 * @param {string} options.bodyHTML
 * @param {{ css: string, cssBaseURL: string }[]} options.cssEntries
 * @param {string} options.baseURL
 * @param {boolean} [options.forPrint] — resolve @media print/screen for print context
 * @returns {{ cssText: string, html: string }}
 */
function preprocessContent({ bodyHTML, cssEntries, baseURL, forPrint = false }) {
  const rebasedCSS = cssEntries
    .map(({ css, cssBaseURL }) =>
      css.replace(
        /url\(\s*['"]?(?!data:|https?:|\/\/)(.*?)['"]?\s*\)/g,
        (_match, path) => `url('${cssBaseURL}${path}')`,
      ),
    )
    .join("\n");

  const rebasedHTML = bodyHTML
    .replace(
      /src\s*=\s*["'](?!data:|https?:|\/\/)(.*?)["']/g,
      (_match, path) => `src="${baseURL}${path}"`,
    )
    .replace(
      /href\s*=\s*["'](?!data:|https?:|\/\/|#)(.*?)["']/g,
      (_match, path) => `href="${baseURL}${path}"`,
    );

  let cssText = rewriteBodySelectors(rebasedCSS);
  if (forPrint) {
    cssText = resolveMediaForPrintText(cssText);
  }
  return { cssText, html: rebasedHTML };
}

export {
  ContentMeasureElement,
  FragmentContainerElement,
  resolveMediaForPrintRules,
  resolveMediaForPrintText,
};
