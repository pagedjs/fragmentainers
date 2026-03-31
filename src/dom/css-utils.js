/**
 * Shared CSS utilities for shadow DOM containers.
 *
 * Used by both <content-measure> (measurement) and <fragment-container>
 * (rendering) to copy document styles and rewrite selectors.
 */

import { OVERRIDES } from "../compositor/overrides.js";
import { resolveMediaForPrintRules } from "./content-measure.js";
import { rewriteNthSelectorsOnSheet } from "../nth-selectors.js";

/**
 * Copy document-level stylesheets into a shadow root via adoptedStyleSheets,
 * rewriting body/html selectors to target .frag-body/:host.
 *
 * @param {ShadowRoot} shadowRoot
 * @param {boolean} forPrint — resolve @media print/screen rules for print context
 * @returns {Map} nthFormulas from nth-selector rewriting
 */
export function copyDocumentStyles(shadowRoot, forPrint = false) {
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
