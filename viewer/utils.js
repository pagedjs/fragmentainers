/**
 * CSS media resolution utilities for print context.
 *
 * Callers that need @media print/screen filtering should apply these
 * before passing stylesheets to FragmentainerLayout.
 */

/**
 * Resolve @media rules for a print context:
 * - `@media print` — unwrap (include child rules without the wrapper)
 * - `@media screen` (without print) — remove entirely
 * - Other @media — keep as-is
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
        result += resolveMediaForPrintRules(rule.cssRules);
        continue;
      }
      if (hasScreen && !hasPrint) {
        continue;
      }
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
