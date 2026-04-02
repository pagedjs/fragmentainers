/**
 * ContentParser — parse an HTML string into a DocumentFragment + CSSStyleSheets
 * with all relative URLs resolved against the content's origin.
 *
 * Replaces the fetchAndParse / preprocessContent pipeline that previously
 * used regex-based URL rebasing. URL fixups now use CSSOM: source sheets
 * are parsed via replaceSync, then walked rule-by-rule to build a non-mutating
 * override sheet with correctly resolved url() values.
 */

/** Attributes that carry URLs and should be resolved. */
const URL_ATTRS = ["src", "href", "poster", "data"];

/** URLs that are already absolute or use a scheme we should not rewrite. */
const ABSOLUTE_URL_RE =
  /^(?:https?:|data:|blob:|javascript:|mailto:|tel:|#|\/\/)/i;

/** Match url() tokens inside a CSS value string. */
const CSS_URL_RE = /url\(\s*["']?(.*?)["']?\s*\)/g;

/** Rename `position: running(...)` to `--page-position: running(...)` custom property. */
const RUNNING_POSITION_RE = /position\s*:\s*(running\([^)]*\))/gi;

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

  // ---------------------------------------------------------------------------
  // DOM URL resolution
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // CSS sheet construction + CSSOM URL override
  // ---------------------------------------------------------------------------

  /**
   * Build CSSStyleSheets from CSS entries and append a URL override sheet.
   *
   * @param {{ css: string, cssBaseURL: string }[]} cssEntries
   * @returns {CSSStyleSheet[]}
   */
  static #buildSheets(cssEntries) {
    const sheets = [];
    const override = new CSSStyleSheet();

    for (let { css, cssBaseURL } of cssEntries) {
      css = css.replace(
        RUNNING_POSITION_RE,
        "--page-position: $1; display: none",
      );
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      sheets.push(sheet);
      ContentParser.#collectURLOverrides(sheet.cssRules, override, cssBaseURL);
    }

    if (override.cssRules.length > 0) {
      sheets.push(override);
    }

    return sheets;
  }

  /**
   * Recursively walk CSS rules via CSSOM. For any rule whose properties
   * contain url() values, insert an override rule with resolved URLs.
   *
   * Follows the non-mutating override pattern from body-selectors.js.
   *
   * @param {CSSRuleList} rules
   * @param {CSSStyleSheet} target — override sheet to insert into
   * @param {string} cssBaseURL
   */
  static #collectURLOverrides(rules, target, cssBaseURL) {
    for (const rule of rules) {
      if (rule instanceof CSSFontFaceRule) {
        ContentParser.#collectFontFaceOverride(rule, target, cssBaseURL);
      } else if (rule.selectorText !== undefined && rule.style) {
        ContentParser.#collectStyleOverride(rule, target, cssBaseURL);
      } else if (rule.cssRules) {
        // Grouping rule (@media, @supports, @layer, etc.) — recurse
        const wrapper = new CSSStyleSheet();
        ContentParser.#collectURLOverrides(rule.cssRules, wrapper, cssBaseURL);
        if (wrapper.cssRules.length > 0) {
          let innerCSS = "";
          for (const r of wrapper.cssRules) {
            innerCSS += r.cssText + "\n";
          }
          const condition = rule.cssText.substring(
            0,
            rule.cssText.indexOf("{"),
          );
          target.insertRule(
            `${condition}{ ${innerCSS} }`,
            target.cssRules.length,
          );
        }
      }
    }
  }

  /**
   * For a CSSStyleRule, iterate its declared properties via CSSOM.
   * If any value contains url(), build an override rule with only
   * the url-bearing properties resolved.
   */
  static #collectStyleOverride(rule, target, cssBaseURL) {
    const overrides = [];

    for (let i = 0; i < rule.style.length; i++) {
      const prop = rule.style[i];
      const value = rule.style.getPropertyValue(prop);
      if (value.includes("url(")) {
        const resolved = ContentParser.#resolveURLsInValue(value, cssBaseURL);
        if (resolved !== value) {
          const priority = rule.style.getPropertyPriority(prop);
          overrides.push({ prop, value: resolved, priority });
        }
      }
    }

    if (overrides.length > 0) {
      const declarations = overrides
        .map(
          ({ prop, value, priority }) =>
            `${prop}: ${value}${priority ? " !important" : ""}`,
        )
        .join("; ");
      target.insertRule(
        `${rule.selectorText} { ${declarations} }`,
        target.cssRules.length,
      );
    }
  }

  /**
   * For a @font-face rule, rebuild the entire block with resolved src URLs.
   */
  static #collectFontFaceOverride(rule, target, cssBaseURL) {
    const srcValue = rule.style.getPropertyValue("src");
    if (!srcValue || !srcValue.includes("url(")) return;

    const resolved = ContentParser.#resolveURLsInValue(srcValue, cssBaseURL);
    if (resolved === srcValue) return;

    // Rebuild the @font-face block with all descriptors, replacing src
    let declarations = "";
    for (let i = 0; i < rule.style.length; i++) {
      const prop = rule.style[i];
      const val = prop === "src" ? resolved : rule.style.getPropertyValue(prop);
      declarations += `${prop}: ${val}; `;
    }

    target.insertRule(`@font-face { ${declarations} }`, target.cssRules.length);
  }

  /**
   * Replace url() tokens in a CSS value string with resolved absolute URLs.
   *
   * @param {string} value — CSS property value (e.g. "url(img/bg.png)")
   * @param {string} cssBaseURL — base URL for the stylesheet
   * @returns {string} value with resolved URLs
   */
  static #resolveURLsInValue(value, cssBaseURL) {
    return value.replace(CSS_URL_RE, (match, path) => {
      if (ABSOLUTE_URL_RE.test(path)) return match;
      try {
        return `url("${new URL(path, cssBaseURL).href}")`;
      } catch {
        return match;
      }
    });
  }
}
