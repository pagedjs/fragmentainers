/**
 * Nth-child/nth-of-type selector rewriting for fragmented content.
 *
 * When content is split across fragment containers (shadow DOM), structural
 * pseudo-classes like :nth-child() match the cloned tree instead of the
 * original document order. This module extracts nth-selector descriptors
 * from stylesheets and generates per-fragment override stylesheets that
 * target elements by their unique data-ref attribute.
 *
 * Two-phase approach:
 *   1. Extract — scan stylesheets, collect nth-rule descriptors (base
 *      selector, nth formula parts, declarations, grouping wrappers)
 *   2. Build — after rendering each fragment, walk its elements, compute
 *      original positions, and generate a per-fragment stylesheet with
 *      :is([data-ref=...]) selectors targeting the correct elements
 */

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

/**
 * Structural pseudo-class pattern to match.
 */
const NTH_PSEUDO_RE = /:(nth-child|nth-of-type|nth-last-child|nth-last-of-type|first-child|last-child|first-of-type|last-of-type|only-child|only-of-type)\b(\([^)]*\))?/g;

/**
 * Parse an nth pseudo-class match into formula parts.
 *
 * @param {string} pseudo — e.g. "first-child", "nth-child"
 * @param {string} [args] — e.g. "(odd)", "(3)" — only for nth-* variants
 * @returns {{ a: number, b: number, isType: boolean, isLast: boolean }[]}
 */
function parseNthParts(pseudo, args) {
  switch (pseudo) {
    case "first-child":
      return [{ a: 0, b: 1, isType: false, isLast: false }];
    case "last-child":
      return [{ a: 0, b: 1, isType: false, isLast: true }];
    case "first-of-type":
      return [{ a: 0, b: 1, isType: true, isLast: false }];
    case "last-of-type":
      return [{ a: 0, b: 1, isType: true, isLast: true }];
    case "only-child":
      return [
        { a: 0, b: 1, isType: false, isLast: false },
        { a: 0, b: 1, isType: false, isLast: true },
      ];
    case "only-of-type":
      return [
        { a: 0, b: 1, isType: true, isLast: false },
        { a: 0, b: 1, isType: true, isLast: true },
      ];
    case "nth-child":
    case "nth-of-type":
    case "nth-last-child":
    case "nth-last-of-type": {
      const expr = args.slice(1, -1).trim();
      const { a, b } = parseAnPlusB(expr);
      const isType = pseudo.includes("of-type");
      const isLast = pseudo.includes("last");
      return [{ a, b, isType, isLast }];
    }
    default:
      return [];
  }
}

/**
 * Compute the original structural position of an element in the source DOM.
 *
 * @param {Element} sourceEl — the source DOM element
 * @returns {{ childIndex: number, typeIndex: number, childFromEnd: number,
 *             typeFromEnd: number, totalChildren: number, totalOfType: number }|null}
 */
export function computeOriginalPosition(sourceEl) {
  if (!sourceEl || !sourceEl.parentElement) return null;

  const parent = sourceEl.parentElement;
  const siblings = parent.children;
  const tagName = sourceEl.tagName;
  const totalChildren = siblings.length;

  let totalOfType = 0;
  for (const sib of siblings) {
    if (sib.tagName === tagName) totalOfType++;
  }

  let childIndex = 0;
  let typeIndex = 0;
  let childFromEnd = 0;
  let typeFromEnd = 0;
  let typeCount = 0;
  for (let i = 0; i < siblings.length; i++) {
    if (siblings[i].tagName === tagName) typeCount++;
    if (siblings[i] === sourceEl) {
      childIndex = i + 1;
      typeIndex = typeCount;
      childFromEnd = totalChildren - i;
      typeFromEnd = totalOfType - typeCount + 1;
    }
  }

  if (childIndex === 0) return null;

  return { childIndex, typeIndex, childFromEnd, typeFromEnd, totalChildren, totalOfType };
}

/**
 * Test whether a position matches all nth formula parts.
 *
 * @param {{ childIndex: number, typeIndex: number, childFromEnd: number, typeFromEnd: number }} pos
 * @param {{ a: number, b: number, isType: boolean, isLast: boolean }[]} nthParts
 * @returns {boolean}
 */
function matchesAllParts(pos, nthParts) {
  for (const part of nthParts) {
    const idx = part.isLast
      ? (part.isType ? pos.typeFromEnd : pos.childFromEnd)
      : (part.isType ? pos.typeIndex : pos.childIndex);
    if (!matchesAnPlusB(idx, { a: part.a, b: part.b })) return false;
  }
  return true;
}

/**
 * @typedef {Object} NthDescriptor
 * @property {string} baseSelector — selector with nth pseudo-classes removed
 * @property {{ a: number, b: number, isType: boolean, isLast: boolean }[]} nthParts
 * @property {string} cssText — the rule's declarations
 * @property {string[]} wrappers — grouping rule preambles (e.g. "@media (...)")
 */

/**
 * Extract nth-rule descriptors from a CSSRuleList.
 *
 * @param {CSSRuleList} ruleList
 * @param {NthDescriptor[]} descriptors — accumulator
 * @param {string[]} wrappers — current grouping rule stack
 */
function extractFromRuleList(ruleList, descriptors, wrappers) {
  for (const rule of ruleList) {
    if (rule.selectorText !== undefined) {
      const parts = [];
      const baseSelector = rule.selectorText.replace(NTH_PSEUDO_RE, (match, pseudo, args) => {
        parts.push(...parseNthParts(pseudo, args));
        return "";
      });
      if (parts.length > 0) {
        descriptors.push({
          baseSelector: baseSelector.trim() || "*",
          nthParts: parts,
          cssText: rule.style.cssText,
          wrappers: [...wrappers],
        });
      }
    } else if (rule.cssRules) {
      const preamble = rule.cssText.substring(0, rule.cssText.indexOf("{")).trim();
      extractFromRuleList(rule.cssRules, descriptors, [...wrappers, preamble]);
    }
  }
}

/**
 * Extract nth-selector descriptors from stylesheets without mutating them.
 *
 * @param {CSSStyleSheet[]} sheets
 * @returns {NthDescriptor[]}
 */
export function extractNthDescriptors(sheets) {
  const descriptors = [];
  for (const sheet of sheets) {
    extractFromRuleList(sheet.cssRules, descriptors, []);
  }
  return descriptors;
}

/**
 * Build a per-fragment override stylesheet that targets elements by data-ref.
 *
 * Walks all elements in the rendered slot, computes their original position
 * in the source DOM, checks against each nth descriptor, and generates
 * CSS rules using :is([data-ref=...]) to target matching elements.
 *
 * @param {Element} slot — the fragment container's slot element
 * @param {NthDescriptor[]} descriptors — from extractNthDescriptors
 * @param {Map<string, Element>} refMap — ref string → source element
 * @returns {CSSStyleSheet|null} — null if no rules generated
 */
export function buildPerFragmentNthSheet(slot, descriptors, refMap) {
  if (descriptors.length === 0) return null;

  // Collect matching refs per descriptor
  const refLists = descriptors.map(() => []);

  // Position cache: source element → computed position (avoids recomputing
  // when the same source element appears in multiple clones)
  const positionCache = new WeakMap();

  for (const el of slot.querySelectorAll("*")) {
    const ref = el.getAttribute("data-ref");
    if (ref === null) continue;

    const sourceEl = refMap.get(ref);
    if (!sourceEl) continue;

    let pos = positionCache.get(sourceEl);
    if (!pos) {
      pos = computeOriginalPosition(sourceEl);
      if (!pos) continue;
      positionCache.set(sourceEl, pos);
    }

    for (let d = 0; d < descriptors.length; d++) {
      if (matchesAllParts(pos, descriptors[d].nthParts)) {
        refLists[d].push(ref);
      }
    }
  }

  // Build rules
  const rules = [];
  for (let d = 0; d < descriptors.length; d++) {
    if (refLists[d].length === 0) continue;
    const { baseSelector, cssText, wrappers } = descriptors[d];
    const refSelector = refLists[d].map(r => `[data-ref="${r}"]`).join(",");
    const fullSelector = baseSelector
      ? `${baseSelector}:is(${refSelector})`
      : `:is(${refSelector})`;
    let ruleText = `${fullSelector} { ${cssText} }`;

    // Wrap in grouping rules (innermost first, build outward)
    for (let w = wrappers.length - 1; w >= 0; w--) {
      ruleText = `${wrappers[w]} { ${ruleText} }`;
    }

    rules.push(ruleText);
  }

  if (rules.length === 0) return null;

  const sheet = new CSSStyleSheet();
  for (const rule of rules) {
    sheet.insertRule(rule, sheet.cssRules.length);
  }
  return sheet;
}

