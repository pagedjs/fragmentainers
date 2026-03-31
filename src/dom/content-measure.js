/**
 * <content-measure> — off-screen measurement container with Shadow DOM.
 *
 * Injects content + CSS into a shadow root so the host page's styles
 * don't affect layout measurements. Uses `all: initial` on :host to
 * reset inherited CSS properties to browser defaults.
 */

import { rewriteNthSelectorsOnSheet } from "../nth-selectors.js";
import { copyDocumentStyles, rewriteBodySelectors } from "./css-utils.js";

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
    this._shadow = this.attachShadow({ mode: "open" });
    this._wrapper = null;
    this._contentSheet = null;
    this._nthFormulas = new Map();
    this._currentInlineSize = undefined;
    this._refMap = new Map();
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

    // Original CSS goes into <style> for measurement — structural
    // pseudo-classes match the source DOM tree during layout.
    const contentStyle = document.createElement("style");
    contentStyle.textContent = cssText;

    // Create a separate CSSStyleSheet with rewritten nth-selectors
    // for rendering containers (where the DOM structure differs).
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    const nth = rewriteNthSelectorsOnSheet(sheet);
    this._contentSheet = nth.sheet;
    this._nthFormulas = nth.formulas;
    this._shadow.appendChild(contentStyle);

    // Create wrapper div that content CSS targets via .frag-body
    this._wrapper = document.createElement("div");
    this._wrapper.className = "frag-body";
    this._wrapper.innerHTML = html;
    this._shadow.appendChild(this._wrapper);

    // Assign data-ref to every element for clone-to-source mapping
    this._refMap = new Map();
    this._nextRefId = 0;
    for (const el of this._wrapper.querySelectorAll("*")) {
      this._assignRefToElement(el);
    }

    return this._wrapper;
  }

  /**
   * Inject a DocumentFragment and optional CSSStyleSheets into the shadow root.
   * Used by FragmentainerLayout to set up measurement internally.
   *
   * @param {DocumentFragment} fragment — content to inject
   * @param {CSSStyleSheet[]|null} [styles] — caller-provided sheets, or null to copy document.styleSheets
   * @returns {Element} the wrapper element (contentRoot) for buildLayoutTree
   */
  injectFragment(fragment, styles = null) {
    this._shadow.innerHTML = "";

    // Host styles
    const hostStyle = document.createElement("style");
    hostStyle.textContent = MEASURE_HOST_STYLES;
    this._shadow.appendChild(hostStyle);

    if (styles) {
      // Caller-provided sheets — apply as-is for measurement,
      // create a rewritten copy with nth-selectors for rendering
      this._shadow.adoptedStyleSheets = [...styles];
      const renderSheet = new CSSStyleSheet();
      for (const s of styles) {
        for (const rule of s.cssRules) {
          renderSheet.insertRule(rule.cssText, renderSheet.cssRules.length);
        }
      }
      const nth = rewriteNthSelectorsOnSheet(renderSheet);
      this._contentSheet = nth.sheet;
      this._nthFormulas = nth.formulas;
    } else {
      // Copy document stylesheets
      this._contentSheet = null;
      this._nthFormulas = copyDocumentStyles(this._shadow);
    }

    // Create wrapper div that content CSS targets via .frag-body
    this._wrapper = document.createElement("div");
    this._wrapper.className = "frag-body";
    this._wrapper.appendChild(fragment);
    this._shadow.appendChild(this._wrapper);

    // Assign data-ref to every element for clone-to-source mapping
    this._refMap = new Map();
    this._nextRefId = 0;
    for (const el of this._wrapper.querySelectorAll("*")) {
      this._assignRefToElement(el);
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
   * Get the content styles for reuse in <fragment-container> rendering.
   * Call after injectContent() to capture styles for rendering.
   *
   * @returns {{ sheets: CSSStyleSheet[], cssText: string }}
   */
  getContentStyles() {
    const sheets = this._contentSheet
      ? [...this._shadow.adoptedStyleSheets, this._contentSheet]
      : [...this._shadow.adoptedStyleSheets];
    return { sheets, nthFormulas: this._nthFormulas };
  }

  /** @returns {Map<string, Element>} ref string → source element */
  get refMap() { return this._refMap; }

  /**
   * Assign a data-ref to a new element and add it to the ref map.
   * @param {Element} el
   * @returns {string} the assigned ref
   */
  assignRef(el) { return this._assignRefToElement(el); }

  /**
   * Remove a ref from the map (e.g., when an element is deleted).
   * @param {string} ref
   */
  removeRef(ref) { this._refMap.delete(ref); }

  _assignRefToElement(el) {
    const ref = String(this._nextRefId++);
    el.setAttribute("data-ref", ref);
    this._refMap.set(ref, el);
    return ref;
  }
}

customElements.define("content-measure", ContentMeasureElement);

// ---------------------------------------------------------------------------
// CSS utilities
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
export function resolveMediaForPrintRules(rules) {
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
export function resolveMediaForPrintText(cssText) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(cssText);
  return resolveMediaForPrintRules(sheet.cssRules);
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
