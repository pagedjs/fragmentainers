/**
 * CSS utilities for the viewer layer.
 *
 * Handles URL rebasing, body/html selector rewriting, and document
 * stylesheet copying for viewer HTML files that load remote content.
 */

import { OVERRIDES } from "../src/styles/overrides.js";
import { rewriteNthSelectorsOnSheet } from "../src/styles/nth-selectors.js";

/**
 * Copy document-level stylesheets into a shadow root via adoptedStyleSheets,
 * rewriting body/html selectors to target .frag-body/:host.
 *
 * @param {ShadowRoot} shadowRoot
 * @returns {Map} nthFormulas from nth-selector rewriting
 */
export function copyDocumentStyles(shadowRoot) {
  const sheets = [];
  const nthFormulas = new Map();
  for (const sheet of document.styleSheets) {
    try {
      const copy = new CSSStyleSheet();
      let rules = "";
      for (const rule of sheet.cssRules) {
        rules += rewriteBodySelectors(rule.cssText) + "\n";
      }
      copy.replaceSync(rules);
      rewriteNthSelectorsOnSheet(copy, nthFormulas);
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
export function rewriteBodySelectors(cssText) {
  let result = cssText.replace(/\bhtml\s+body\b/g, "body");
  result = result.replace(
    /(?:^|(?<=,\s*|}\s*))\bhtml\b(?=[{\s,.#:[>+~])/gm,
    ":host",
  );
  result = result.replace(/\bbody\b(?=[{\s,.#:[>+~])/g, ".frag-body");
  return result;
}

/**
 * Pre-process content: rebase URLs, rewrite CSS selectors, and
 * return CSSStyleSheet objects ready for shadow DOM adoption.
 *
 * @param {Object} options
 * @param {string} options.bodyHTML
 * @param {{ css: string, cssBaseURL: string }[]} options.cssEntries
 * @param {string} options.baseURL
 * @returns {{ html: string, sheets: CSSStyleSheet[] }}
 */
export function preprocessContent({ bodyHTML, cssEntries, baseURL }) {
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

  const cssText = rewriteBodySelectors(rebasedCSS);

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(cssText);
  return { html: rebasedHTML, sheets: [sheet] };
}
