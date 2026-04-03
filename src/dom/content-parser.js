/**
 * ContentParser — parse an HTML string into a DocumentFragment + CSSStyleSheets
 * with all relative URLs resolved against the content's origin.
 *
 * Replaces the fetchAndParse / preprocessContent pipeline that previously
 * used regex-based URL rebasing. CSS url() resolution is handled natively
 * by the browser via CSSStyleSheet's baseURL constructor option.
 */

/** Attributes that carry URLs and should be resolved. */
const URL_ATTRS = ["src", "href", "poster", "data"];

/** URLs that are already absolute or use a scheme we should not rewrite. */
const ABSOLUTE_URL_RE =
  /^(?:https?:|data:|blob:|javascript:|mailto:|tel:|#|\/\/)/i;

/** Rename `position: running(...)` to `--page-position: running(...)` custom property. */
const RUNNING_POSITION_RE = /position\s*:\s*(running\([^)]*\))/gi;

/** Rewrite `float: footnote` to a custom property + display: none. */
const FLOAT_FOOTNOTE_RE = /float\s*:\s*footnote/gi;

/** Rewrite `footnote-display` to a custom property. */
const FOOTNOTE_DISPLAY_RE = /footnote-display\s*:/gi;

/** Rewrite `footnote-policy` to a custom property. */
const FOOTNOTE_POLICY_RE = /footnote-policy\s*:/gi;

/** Rewrite `::footnote-call` pseudo-element to attribute selector. */
const FOOTNOTE_CALL_RE = /::footnote-call/g;

/** Rewrite `::footnote-marker` pseudo-element to attribute selector. */
const FOOTNOTE_MARKER_RE = /::footnote-marker/g;

export class ContentParser {
  #fragment;
  #styles;

  constructor(fragment, styles) {
    this.#fragment = fragment;
    this.#styles = styles;
  }

  /** @returns {DocumentFragment} body content with resolved URLs */
  get fragment() {
    return this.#fragment;
  }

  /** @returns {CSSStyleSheet[]} source sheets + URL override sheet */
  get styles() {
    return this.#styles;
  }

  /**
   * Parse an HTML string and return a ContentParser with a ready-to-use
   * DocumentFragment and resolved CSSStyleSheets.
   *
   * @param {string} content — full HTML document string
   * @param {string} baseURL — base URL for resolving relative paths
   * @returns {Promise<ContentParser>}
   */
  static async fromString(content, baseURL) {
    baseURL = new URL(baseURL, document.baseURI).href;
    const doc = new DOMParser().parseFromString(content, "text/html");

    const fragment = ContentParser.html(doc, baseURL);
    const styles = await ContentParser.css(doc, baseURL);

    return new ContentParser(fragment, styles);
  }

  /**
   * Extract body content from a parsed document into a DocumentFragment
   * with all relative URLs resolved.
   *
   * @param {Document} doc — parsed HTML document
   * @param {string} baseURL — absolute base URL for resolving relative paths
   * @returns {DocumentFragment}
   */
  static html(doc, baseURL) {
    const fragment = document.createDocumentFragment();
    const template = doc.querySelector("template#flow");
    const source = template ? template.content : doc.body;

    while (source.firstChild) {
      fragment.appendChild(document.adoptNode(source.firstChild));
    }

    ContentParser.#resolveFragmentURLs(fragment, baseURL);
    return fragment;
  }

  /**
   * Collect and build CSSStyleSheets from a parsed document's
   * inline styles and linked stylesheets, with resolved URLs.
   *
   * @param {Document} doc — parsed HTML document
   * @param {string} baseURL — absolute base URL for resolving relative paths
   * @returns {Promise<CSSStyleSheet[]>}
   */
  static async css(doc, baseURL) {
    const cssEntries = [];

    for (const style of doc.querySelectorAll("style")) {
      cssEntries.push({ css: style.textContent, cssBaseURL: baseURL });
    }

    for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
      const href = link.getAttribute("href");
      if (!href) continue;
      try {
        const cssURL = new URL(href, baseURL).href;
        const response = await fetch(cssURL);
        const cssBaseURL = cssURL.substring(0, cssURL.lastIndexOf("/") + 1);
        cssEntries.push({ css: await response.text(), cssBaseURL });
      } catch (e) {
        console.warn(`Failed to fetch stylesheet: ${href}`, e);
      }
    }

    return ContentParser.#buildSheets(cssEntries);
  }

  /**
   * Convert the current document's styleSheets into constructed
   * CSSStyleSheets that can be adopted into shadow roots.
   * Cross-origin sheets that cannot be read are silently skipped.
   *
   * @returns {CSSStyleSheet[]}
   */
  static collectDocumentStyles() {
    if (typeof document === "undefined") return [];
    const sheets = [];
    for (const sheet of document.styleSheets) {
      try {
        const constructed = new CSSStyleSheet();
        let css = "";
        for (const rule of sheet.cssRules) {
          css += rule.cssText + "\n";
        }
        constructed.replaceSync(css);
        sheets.push(constructed);
      } catch {
        // Cross-origin sheets can't be read — skip
      }
    }

    return sheets;
  }

  // DOM URL resolution

  /**
   * Walk every element in the fragment and resolve relative URL attributes.
   */
  static #resolveFragmentURLs(fragment, baseURL) {
    for (const el of fragment.querySelectorAll("*")) {
      for (const attr of URL_ATTRS) {
        const value = el.getAttribute(attr);
        if (value && !ABSOLUTE_URL_RE.test(value)) {
          try {
            el.setAttribute(attr, new URL(value, baseURL).href);
          } catch {
            // Malformed URL — leave as-is
          }
        }
      }
    }
  }

  /**
   * Build CSSStyleSheets from CSS entries, using baseURL for native
   * relative url() resolution.
   *
   * @param {{ css: string, cssBaseURL: string }[]} cssEntries
   * @returns {CSSStyleSheet[]}
   */
  static #buildSheets(cssEntries) {
    const sheets = [];

    for (let { css, cssBaseURL } of cssEntries) {
      css = css.replace(
        RUNNING_POSITION_RE,
        "--page-position: $1; display: none",
      );
      css = css.replace(FLOAT_FOOTNOTE_RE, "--float: footnote; display: none");
      css = css.replace(FOOTNOTE_DISPLAY_RE, "--footnote-display:");
      css = css.replace(FOOTNOTE_POLICY_RE, "--footnote-policy:");
      css = css.replace(FOOTNOTE_CALL_RE, "[data-footnote-call]::after");
      css = css.replace(FOOTNOTE_MARKER_RE, "[data-footnote-marker]::marker");
      const sheet = new CSSStyleSheet({ baseURL: cssBaseURL });
      sheet.replaceSync(css);
      sheets.push(sheet);
    }

    return sheets;
  }
}
