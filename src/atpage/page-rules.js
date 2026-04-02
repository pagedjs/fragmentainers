import { ConstraintSpace } from "../core/constraint-space.js";
import { FRAGMENTATION_PAGE, NAMED_SIZES } from "../core/constants.js";
import { resolveNamedPageForBreakToken } from "../core/helpers.js";

/**
 * Parse a CSS length string to CSS pixels (96 DPI).
 * @param {string} str
 * @returns {number|null}
 */
export function parseCSSLength(str) {
  const match = str.trim().match(/^([\d.]+)(px|in|cm|mm|pt)?$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = match[2] || "px";
  switch (unit) {
    case "px":
      return value;
    case "in":
      return value * 96;
    case "cm":
      return (value * 96) / 2.54;
    case "mm":
      return (value * 96) / 25.4;
    case "pt":
      return (value * 96) / 72;
    default:
      return value;
  }
}

/**
 * Parsed representation of a CSS `@page` rule.
 */
export class PageRule {
  /**
   * @param {object} opts
   * @param {string|null} [opts.name] - Named page type ('chapter', 'cover'), or null for universal
   * @param {string|null} [opts.pseudoClass] - 'first', 'left', 'right', 'blank', or null
   * @param {string|number[]|null} [opts.size] - 'a4', 'letter landscape', [width, height], or null
   * @param {object|null} [opts.margin] - { top, right, bottom, left } in CSS px
   * @param {string|null} [opts.pageOrientation] - 'rotate-left', 'rotate-right', or null
   */
  constructor({ name, pseudoClass, size, margin, pageOrientation } = {}) {
    this.name = name || null;
    this.pseudoClass = pseudoClass || null;
    this.size = size ?? null;
    this.margin = margin ?? null;
    this.pageOrientation = pageOrientation ?? null;
  }
}

/**
 * Resolved page dimensions for one page — the fragmentainer definition.
 */
export class PageConstraints {
  /**
   * @param {object} opts
   * @param {number} opts.pageIndex
   * @param {string|null} opts.namedPage
   * @param {{ inlineSize: number, blockSize: number }} opts.pageBoxSize - Full page dimensions
   * @param {{ top: number, right: number, bottom: number, left: number }} opts.margins
   * @param {{ inlineSize: number, blockSize: number }} opts.contentArea - The fragmentainer
   * @param {boolean} opts.isFirstPage
   * @param {boolean} opts.isLeftPage
   * @param {boolean} [opts.isBlank]
   */
  constructor({
    pageIndex,
    namedPage,
    pageBoxSize,
    margins,
    contentArea,
    isFirstPage,
    isLeftPage,
    isBlank = false,
  }) {
    this.pageIndex = pageIndex;
    this.namedPage = namedPage;
    this.pageBoxSize = pageBoxSize;
    this.margins = margins;
    this.contentArea = contentArea;
    this.isFirstPage = isFirstPage;
    this.isLeftPage = isLeftPage;
    this.isBlank = isBlank;
  }

  /** Build a ConstraintSpace for layout from these page constraints. */
  toConstraintSpace() {
    return new ConstraintSpace({
      availableInlineSize: this.contentArea.inlineSize,
      availableBlockSize: this.contentArea.blockSize,
      fragmentainerBlockSize: this.contentArea.blockSize,
      blockOffsetInFragmentainer: 0,
      fragmentationType: FRAGMENTATION_PAGE,
    });
  }
}

/**
 * Resolves page dimensions per-page by implementing `@page` rule matching and cascade.
 */
export class PageSizeResolver {
  /**
   * @param {PageRule[]} pageRules - Parsed @page rules (document order)
   * @param {{ inlineSize: number, blockSize: number }} [size] - Fallback size (default: US Letter)
   */
  constructor(pageRules, size = NAMED_SIZES.LETTER) {
    this.pageRules = pageRules;
    this.size = size;
  }

  /**
   * Create a resolver by collecting @page rules from document.styleSheets.
   *
   * @param {{ inlineSize: number, blockSize: number }} [size] - Fallback size (default: US Letter)
   * @returns {PageSizeResolver}
   */
  static fromDocument(size) {
    const rules = [];
    if (typeof document !== "undefined" && document.styleSheets) {
      for (const sheet of document.styleSheets) {
        try { collectPageRules(sheet.cssRules, rules); } catch { /* cross-origin sheet */ }
      }
    }
    return new PageSizeResolver(rules, size);
  }

  /**
   * Create a resolver by collecting @page rules from an array of CSSStyleSheets.
   *
   * @param {CSSStyleSheet[]} sheets - Stylesheets to scan for @page rules
   * @param {{ inlineSize: number, blockSize: number }} [size] - Fallback size (default: US Letter)
   * @returns {PageSizeResolver}
   */
  static fromStyleSheets(sheets, size) {
    const rules = [];
    for (const sheet of sheets) {
      try { collectPageRules(sheet.cssRules, rules); } catch { /* cross-origin sheet */ }
    }
    return new PageSizeResolver(rules, size);
  }

  /**
   * Resolve the constraint space for a specific page.
   *
   * @param {number} pageIndex - Zero-based page number
   * @param {import('./helpers.js').LayoutNode|null} rootNode - Root layout node (for named page resolution)
   * @param {import('./tokens.js').BreakToken|null} breakToken - Current break token
   * @returns {PageConstraints}
   */
  resolve(pageIndex, rootNode, breakToken, isBlank = false) {
    const namedPage = rootNode
      ? resolveNamedPageForBreakToken(rootNode, breakToken)
      : null;
    const matchingRules = this.matchRules(pageIndex, namedPage, isBlank);
    const resolved = this.cascadeRules(matchingRules);
    const pageSize = this.resolveSize(resolved.size);
    const orientedSize = this.applyOrientation(
      pageSize,
      resolved.pageOrientation,
    );
    const margins = this.resolveMargins(resolved.margin, orientedSize);
    const contentArea = {
      inlineSize: orientedSize.inlineSize - margins.left - margins.right,
      blockSize: orientedSize.blockSize - margins.top - margins.bottom,
    };

    return new PageConstraints({
      pageIndex,
      namedPage,
      pageBoxSize: orientedSize,
      margins,
      contentArea,
      isFirstPage: pageIndex === 0,
      isLeftPage: this.isLeftPage(pageIndex),
      isBlank,
    });
  }

  /**
   * Match @page rules applicable to this page context.
   * A rule matches if its name matches (or is universal) AND its pseudo-class
   * matches (or has none).
   */
  matchRules(pageIndex, namedPage, isBlank = false) {
    return this.pageRules.filter((rule) => {
      // Named rule must match the page's named page
      if (rule.name && rule.name !== namedPage) return false;

      // Pseudo-class must match the page context
      if (rule.pseudoClass === "first" && pageIndex !== 0) return false;
      if (rule.pseudoClass === "left" && !this.isLeftPage(pageIndex))
        return false;
      if (rule.pseudoClass === "right" && this.isLeftPage(pageIndex))
        return false;
      if (rule.pseudoClass === "blank" && !isBlank) return false;

      return true;
    });
  }

  /**
   * Cascade matched rules — sort by specificity, later/more-specific rules win.
   * Specificity: universal(0) < pseudo-class(1) < named(2) < named+pseudo(3).
   * Within same specificity, document order (array index) wins.
   */
  cascadeRules(matchingRules) {
    const result = { size: null, margin: null, pageOrientation: null };

    // Stable sort by specificity — Array.sort is stable in modern engines
    const sorted = [...matchingRules].sort((a, b) => {
      const specA = (a.name ? 2 : 0) + (a.pseudoClass ? 1 : 0);
      const specB = (b.name ? 2 : 0) + (b.pseudoClass ? 1 : 0);
      return specA - specB;
    });

    for (const rule of sorted) {
      if (rule.size != null) result.size = rule.size;
      if (rule.margin != null)
        result.margin = { ...result.margin, ...rule.margin };
      if (rule.pageOrientation != null)
        result.pageOrientation = rule.pageOrientation;
    }

    return result;
  }

  /** Resolve CSS size property to physical dimensions in CSS pixels. */
  resolveSize(sizeValue) {
    if (!sizeValue || sizeValue === "auto") return { ...this.size };

    if (typeof sizeValue === "string") {
      const parts = sizeValue.toLowerCase().split(/\s+/);
      const name = parts.find((p) => NAMED_SIZES[p.toUpperCase()]);
      const orientation = parts.find(
        (p) => p === "landscape" || p === "portrait",
      );

      if (name) {
        const size = { ...NAMED_SIZES[name.toUpperCase()] };
        if (orientation === "landscape") {
          return { inlineSize: size.blockSize, blockSize: size.inlineSize };
        }
        return size;
      }

      // Bare 'landscape' / 'portrait' — rotate the default size
      if (sizeValue === "landscape") {
        return {
          inlineSize: this.size.blockSize,
          blockSize: this.size.inlineSize,
        };
      }
      if (sizeValue === "portrait") return { ...this.size };

      // Try parsing as one or two length values
      const lengths = parts.map(parseCSSLength).filter((v) => v !== null);
      if (lengths.length === 1)
        return { inlineSize: lengths[0], blockSize: lengths[0] };
      if (lengths.length >= 2)
        return { inlineSize: lengths[0], blockSize: lengths[1] };
    }

    // Array: [width, height] or [side]
    if (Array.isArray(sizeValue)) {
      return {
        inlineSize: sizeValue[0],
        blockSize: sizeValue[1] ?? sizeValue[0],
      };
    }

    return { ...this.size };
  }

  /** Apply page-orientation by swapping dimensions. */
  applyOrientation(size, orientation) {
    if (orientation === "rotate-left" || orientation === "rotate-right") {
      return { inlineSize: size.blockSize, blockSize: size.inlineSize };
    }
    return size;
  }

  /** Resolve margin declarations to pixel values. */
  resolveMargins(marginDecl, _pageSize) {
    const defaults = { top: 0, right: 0, bottom: 0, left: 0 };
    if (!marginDecl) return defaults;
    return {
      top: marginDecl.top ?? 0,
      right: marginDecl.right ?? 0,
      bottom: marginDecl.bottom ?? 0,
      left: marginDecl.left ?? 0,
    };
  }

  /** In LTR page progression, page 0 is right (recto), page 1 is left (verso). */
  isLeftPage(pageIndex) {
    return pageIndex % 2 === 1;
  }
}

/**
 * Parse @page rules from CSS text strings using the browser's CSSOM.
 *
 * @param {Iterable<string>} cssTexts - CSS source strings to parse
 * @returns {PageRule[]}
 */
export function parsePageRulesFromCSS(cssTexts) {
  const rules = [];
  for (const text of cssTexts) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    collectPageRules(sheet.cssRules, rules);
  }
  return rules;
}

/**
 * Recursively collect CSSPageRule instances from a rule list,
 * descending into grouping rules like @layer, @supports, @media.
 *
 * @param {CSSRuleList} cssRules
 * @param {PageRule[]} [out] - accumulator (created if omitted)
 * @returns {PageRule[]}
 */
export function collectPageRules(cssRules, out = []) {
  for (const rule of cssRules) {
    if (rule instanceof CSSPageRule) {
      out.push(parseOnePageRule(rule));
    } else if (rule.cssRules) {
      collectPageRules(rule.cssRules, out);
    }
  }
  return out;
}

/**
 * Extract a PageRule from a CSSPageRule instance.
 * @param {CSSPageRule} rule
 * @returns {PageRule}
 */
function parseOnePageRule(rule) {
  // Parse selector: optional name, optional :pseudo
  let name = null;
  let pseudoClass = null;
  const selector = rule.selectorText.trim();
  if (selector) {
    const selectorMatch = selector.match(/^(\w+)?\s*(?::(\w+))?$/);
    if (selectorMatch) {
      name = selectorMatch[1] || null;
      pseudoClass = selectorMatch[2] || null;
    }
  }

  const size = parsePageSize(rule.style);
  const margin = parsePageMargins(rule.style);
  const pageOrientation =
    rule.style.getPropertyValue("page-orientation").trim() || null;

  return new PageRule({ name, pseudoClass, size, margin, pageOrientation });
}

/**
 * Extract the `size` descriptor from a CSSPageRule's style.
 * @param {CSSStyleDeclaration} style
 * @returns {string|number[]|null}
 */
function parsePageSize(style) {
  const sizeStr = style.getPropertyValue("size").trim();
  if (!sizeStr) return null;

  const parts = sizeStr.split(/\s+/);
  const hasNamedSize = parts.some((p) => NAMED_SIZES[p.toUpperCase()]);
  const hasOrientation = parts.some(
    (p) => p === "landscape" || p === "portrait",
  );

  if (hasNamedSize || hasOrientation) {
    return sizeStr.toLowerCase();
  }

  const lengths = parts.map(parseCSSLength).filter((v) => v !== null);
  if (lengths.length === 1) return [lengths[0], lengths[0]];
  if (lengths.length >= 2) return [lengths[0], lengths[1]];

  return null;
}

/**
 * Extract resolved margin values from a CSSPageRule's style.
 * The browser handles shorthand expansion, so we only read longhands.
 * @param {CSSStyleDeclaration} style
 * @returns {{ top: number, right: number, bottom: number, left: number }|null}
 */
function parsePageMargins(style) {
  const SIDES = ["top", "right", "bottom", "left"];
  let margin = null;

  for (const side of SIDES) {
    const raw = style.getPropertyValue(`margin-${side}`).trim();
    if (raw) {
      const val = parseCSSLength(raw);
      if (val !== null) {
        if (!margin) margin = { top: 0, right: 0, bottom: 0, left: 0 };
        margin[side] = val;
      }
    }
  }

  return margin;
}
