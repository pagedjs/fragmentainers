/**
 * Body/html selector rewriting for shadow DOM fragmentation.
 *
 * When content is rendered inside shadow DOM containers, `body` and `html`
 * selectors don't match — the shadow root uses a `.frag-body` wrapper
 * instead of <body> and `:host` instead of <html>.
 *
 * This module builds an override CSSStyleSheet with rewritten selectors,
 * following the same non-mutating pattern as buildNthOverrideSheet in
 * nth-selectors.js. The override sheet is appended after the original
 * sheets so rewritten rules win by source order.
 */

/**
 * Rewrite `body` and `html` selectors in a selectorText string.
 *
 * - `html body` → `.frag-body`
 * - standalone `html` → `:host`
 * - `body` → `.frag-body`
 *
 * @param {string} selectorText
 * @returns {string} rewritten selector text
 */
export function rewriteBodySelectorText(selectorText) {
  // Collapse `html body` to a single `.frag-body` match first
  let result = selectorText.replace(/\bhtml\s+body\b/g, ".frag-body");
  // Standalone `html` → `:host` (at start of selector or after comma)
  result = result.replace(
    /(?:^|(?<=,\s*))\bhtml\b(?=[\s,.#:[>+~]|$)/gm,
    ":host",
  );
  // `body` → `.frag-body` (word-boundary guards prevent matching e.g. `tbody`)
  result = result.replace(/\bbody\b(?=[\s,.#:[>+~]|$)/g, ".frag-body");
  return result;
}

/**
 * Recursively collect override rules for body/html selectors
 * into a target CSSStyleSheet without mutating the source rules.
 *
 * @param {CSSRuleList} ruleList — source rules to scan
 * @param {CSSStyleSheet|CSSGroupingRule} target — where to insert overrides
 */
function collectBodyOverrides(ruleList, target) {
  for (const rule of ruleList) {
    if (rule.selectorText !== undefined) {
      const rewritten = rewriteBodySelectorText(rule.selectorText);
      if (rewritten !== rule.selectorText) {
        target.insertRule(
          `${rewritten} { ${rule.style.cssText} }`,
          target.cssRules.length,
        );
      }
    } else if (rule.cssRules) {
      // Grouping rule — reconstruct wrapper, recurse, keep only if non-empty
      const wrapper = new CSSStyleSheet();
      collectBodyOverrides(rule.cssRules, wrapper);
      if (wrapper.cssRules.length > 0) {
        let innerCSS = "";
        for (const r of wrapper.cssRules) {
          innerCSS += r.cssText + "\n";
        }
        target.insertRule(
          `${rule.cssText.substring(0, rule.cssText.indexOf("{"))}{ ${innerCSS} }`,
          target.cssRules.length,
        );
      }
    }
  }
}

/**
 * Build an override CSSStyleSheet containing `.frag-body` / `:host`
 * equivalents of `body` / `html` selectors found in the input sheets.
 * The input sheets are NOT mutated.
 *
 * @param {CSSStyleSheet[]} sheets — source sheets to scan
 * @returns {{ sheet: CSSStyleSheet }}
 */
export function buildBodyOverrideSheet(sheets) {
  const overrideSheet = new CSSStyleSheet();
  for (const sheet of sheets) {
    collectBodyOverrides(sheet.cssRules, overrideSheet);
  }
  return { sheet: overrideSheet };
}
