/**
 * Nth-child/nth-of-type selector rewriting for fragmented content.
 *
 * When content is split across fragment containers (shadow DOM), structural
 * pseudo-classes like :nth-child() match the cloned tree instead of the
 * original document order. This module rewrites those selectors to use
 * data attributes stamped on cloned elements during rendering.
 *
 * Two-phase approach (mirrors the counter-state pattern):
 *   1. Rewrite — scan stylesheets, replace nth selectors with attribute
 *      selectors, collect formula descriptors
 *   2. Stamp — during rendering, compute each element's original position
 *      and set matching attributes
 */

// ---------------------------------------------------------------------------
// An+B formula parsing
// ---------------------------------------------------------------------------

/**
 * Parse a CSS An+B expression into { a, b } coefficients.
 *
 * Handles: "odd", "even", "3", "-n+6", "2n", "2n+1", "-3n-2", "+n", "n"
 *
 * @param {string} expr — the expression inside :nth-child(...)
 * @returns {{ a: number, b: number }}
 */
export function parseAnPlusB(expr) {
  const s = expr.replace(/\s+/g, "").toLowerCase();

  if (s === "odd") return { a: 2, b: 1 };
  if (s === "even") return { a: 2, b: 0 };

  // No "n" → pure integer offset
  if (!s.includes("n")) {
    return { a: 0, b: parseInt(s, 10) };
  }

  // Split on "n" to get A and B parts
  const [aPart, bPart] = s.split("n");

  let a;
  if (aPart === "" || aPart === "+") a = 1;
  else if (aPart === "-") a = -1;
  else a = parseInt(aPart, 10);

  const b = bPart ? parseInt(bPart, 10) : 0;

  return { a, b };
}

/**
 * Test whether a 1-based index matches an An+B formula.
 *
 * @param {number} index — 1-based position
 * @param {{ a: number, b: number }} formula
 * @returns {boolean}
 */
export function matchesAnPlusB(index, { a, b }) {
  if (a === 0) return index === b;
  const n = (index - b) / a;
  return Number.isInteger(n) && n >= 0;
}

// ---------------------------------------------------------------------------
// Selector rewriting
// ---------------------------------------------------------------------------

/**
 * Structural pseudo-class patterns to rewrite.
 *
 * Each entry maps a regex (matching the pseudo-class in a selector string)
 * to a function that returns the replacement attribute selector and an
 * optional formula descriptor for the compositor to stamp.
 */

const NTH_PSEUDO_RE = /:(nth-child|nth-of-type|nth-last-child|nth-last-of-type|first-child|last-child|first-of-type|last-of-type|only-child|only-of-type)\b(\([^)]*\))?/g;

/**
 * Canonical key for a formula — used to deduplicate identical An+B
 * expressions across rules so the compositor stamps each only once.
 */
function formulaKey(pseudo, a, b) {
  return `${pseudo}:${a}:${b}`;
}

/**
 * Rewrite structural pseudo-classes in a selector string.
 *
 * @param {string} selectorText
 * @param {Map} formulas — accumulator for formula descriptors
 * @returns {string} rewritten selector text
 */
export function rewriteSelectorText(selectorText, formulas) {
  return selectorText.replace(NTH_PSEUDO_RE, (match, pseudo, args) => {
    switch (pseudo) {
      case "first-child":
        return "[data-child-index=\"1\"]";
      case "last-child":
        return "[data-last-child]";
      case "first-of-type":
        return "[data-type-index=\"1\"]";
      case "last-of-type":
        return "[data-last-of-type]";
      case "only-child":
        return "[data-child-index=\"1\"][data-last-child]";
      case "only-of-type":
        return "[data-type-index=\"1\"][data-last-of-type]";
      case "nth-child":
      case "nth-of-type":
      case "nth-last-child":
      case "nth-last-of-type": {
        const expr = args.slice(1, -1).trim(); // strip parens
        const { a, b } = parseAnPlusB(expr);
        const isType = pseudo.includes("of-type");
        const isLast = pseudo.includes("last");

        // Simple index: :nth-child(3) → [data-child-index="3"]
        if (a === 0 && !isLast) {
          const attr = isType ? "data-type-index" : "data-child-index";
          return `[${attr}="${b}"]`;
        }

        // Formula or last-variant: stamp a boolean attribute
        const key = formulaKey(pseudo, a, b);
        if (!formulas.has(key)) {
          const attr = `data-${pseudo}-${a}n${b >= 0 ? "p" : "m"}${Math.abs(b)}`;
          formulas.set(key, { pseudo, a, b, attr, isType, isLast });
        }
        return `[${formulas.get(key).attr}]`;
      }
      default:
        return match;
    }
  });
}

// ---------------------------------------------------------------------------
// CSSOM-based selector rewriting
// ---------------------------------------------------------------------------

/**
 * Recursively rewrite structural pseudo-classes in a CSSRuleList.
 *
 * @param {CSSRuleList} ruleList
 * @param {Map} formulas — accumulator for formula descriptors
 */
function rewriteRulesInList(ruleList, formulas) {
  for (const rule of ruleList) {
    if (rule.selectorText !== undefined) {
      // CSSStyleRule — rewrite selector in place
      const rewritten = rewriteSelectorText(rule.selectorText, formulas);
      if (rewritten !== rule.selectorText) {
        rule.selectorText = rewritten;
      }
    } else if (rule.cssRules) {
      // Grouping rule (@media, @supports, @layer, @scope, etc.) — recurse
      rewriteRulesInList(rule.cssRules, formulas);
    }
  }
}

/**
 * Rewrite structural pseudo-classes on a CSSStyleSheet by mutating
 * selectorText on each CSSStyleRule in place.
 *
 * @param {CSSStyleSheet} sheet
 * @param {Map} [formulas] — accumulator for formula descriptors (shared across sheets)
 * @returns {{ sheet: CSSStyleSheet, formulas: Map }}
 */
export function rewriteNthSelectorsOnSheet(sheet, formulas = new Map()) {
  rewriteRulesInList(sheet.cssRules, formulas);
  return { sheet, formulas };
}

// ---------------------------------------------------------------------------
// Non-mutating nth-selector override sheet
// ---------------------------------------------------------------------------

/**
 * Recursively collect override rules for structural pseudo-classes
 * into a target CSSStyleSheet without mutating the source rules.
 *
 * @param {CSSRuleList} ruleList — source rules to scan
 * @param {CSSStyleSheet|CSSGroupingRule} target — where to insert overrides
 * @param {Map} formulas — accumulator for formula descriptors
 */
function collectNthOverrides(ruleList, target, formulas) {
  for (const rule of ruleList) {
    if (rule.selectorText !== undefined) {
      const rewritten = rewriteSelectorText(rule.selectorText, formulas);
      if (rewritten !== rule.selectorText) {
        target.insertRule(
          `${rewritten} { ${rule.style.cssText} }`,
          target.cssRules.length,
        );
      }
    } else if (rule.cssRules) {
      // Grouping rule — reconstruct wrapper, recurse, keep only if non-empty
      const wrapper = new CSSStyleSheet();
      collectNthOverrides(rule.cssRules, wrapper, formulas);
      if (wrapper.cssRules.length > 0) {
        // Re-wrap child rules inside the grouping rule's condition
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
 * Build an override CSSStyleSheet containing attribute-selector equivalents
 * of structural pseudo-classes found in the input sheets. The input sheets
 * are NOT mutated — the override sheet is meant to be appended after them
 * in adoptedStyleSheets so attribute selectors win by source order.
 *
 * @param {CSSStyleSheet[]} sheets — source sheets to scan
 * @param {Map} [formulas] — accumulator for formula descriptors
 * @returns {{ sheet: CSSStyleSheet, formulas: Map }}
 */
export function buildNthOverrideSheet(sheets, formulas = new Map()) {
  const overrideSheet = new CSSStyleSheet();
  for (const sheet of sheets) {
    collectNthOverrides(sheet.cssRules, overrideSheet, formulas);
  }
  return { sheet: overrideSheet, formulas };
}

// ---------------------------------------------------------------------------
// Attribute stamping (called by compositor during rendering)
// ---------------------------------------------------------------------------

/**
 * Compute and stamp structural-position attributes on a cloned element.
 *
 * @param {Element} el — the cloned DOM element
 * @param {import("./dom/layout-node.js").DOMLayoutNode} node — the source layout node
 * @param {Map<string, { pseudo: string, a: number, b: number, attr: string, isType: boolean, isLast: boolean }>} formulas
 *   — formula descriptors from rewriteNthSelectors
 */
export function stampNthAttributes(el, node, formulas) {
  const sourceEl = node.element;
  if (!sourceEl || !sourceEl.parentElement) return;

  const parent = sourceEl.parentElement;
  const siblings = parent.children;
  const tagName = sourceEl.tagName;

  // Compute 1-based child index and type index
  let childIndex = 0;
  let typeIndex = 0;
  let totalChildren = siblings.length;
  let totalOfType = 0;

  // Count total of same type (for last-of-type)
  for (let i = 0; i < siblings.length; i++) {
    if (siblings[i].tagName === tagName) totalOfType++;
  }

  // Find this element's indices
  let childFromEnd = 0;
  let typeFromEnd = 0;
  let typeCount = 0;
  for (let i = 0; i < siblings.length; i++) {
    const sameType = siblings[i].tagName === tagName;
    if (sameType) typeCount++;
    if (siblings[i] === sourceEl) {
      childIndex = i + 1;
      typeIndex = typeCount;
      childFromEnd = totalChildren - i;
      typeFromEnd = totalOfType - typeCount + 1;
    }
  }

  if (childIndex === 0) return; // element not found in parent

  // Always stamp base indices
  el.setAttribute("data-child-index", String(childIndex));
  el.setAttribute("data-type-index", String(typeIndex));

  // Stamp last-child / last-of-type boolean attributes
  if (childIndex === totalChildren) {
    el.setAttribute("data-last-child", "");
  }
  if (typeIndex === totalOfType) {
    el.setAttribute("data-last-of-type", "");
  }

  // Stamp formula-matching boolean attributes
  for (const { a, b, attr, isType, isLast } of formulas.values()) {
    const idx = isLast
      ? (isType ? typeFromEnd : childFromEnd)
      : (isType ? typeIndex : childIndex);
    if (matchesAnPlusB(idx, { a, b })) {
      el.setAttribute(attr, "");
    }
  }
}
