import { ConstraintSpace } from "./constraint-space.js";
import { FRAGMENTATION_PAGE, NAMED_SIZES } from "./constants.js";

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
    case "px": return value;
    case "in": return value * 96;
    case "cm": return value * 96 / 2.54;
    case "mm": return value * 96 / 25.4;
    case "pt": return value * 96 / 72;
    default: return value;
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
   */
  constructor({ pageIndex, namedPage, pageBoxSize, margins, contentArea,
                isFirstPage, isLeftPage }) {
    this.pageIndex = pageIndex;
    this.namedPage = namedPage;
    this.pageBoxSize = pageBoxSize;
    this.margins = margins;
    this.contentArea = contentArea;
    this.isFirstPage = isFirstPage;
    this.isLeftPage = isLeftPage;
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
   * @param {{ inlineSize: number, blockSize: number }} defaultSize
   */
  constructor(pageRules, defaultSize) {
    this.pageRules = pageRules;
    this.defaultSize = defaultSize;
  }

  /**
   * Resolve the constraint space for a specific page.
   *
   * @param {number} pageIndex - Zero-based page number
   * @param {string|null} namedPage - The CSS `page` property value, or null for auto
   * @param {number|null} totalPages - Total page count (for future use)
   * @returns {PageConstraints}
   */
  resolve(pageIndex, namedPage, totalPages) {
    const matchingRules = this.matchRules(pageIndex, namedPage, totalPages);
    const resolved = this.cascadeRules(matchingRules);
    const pageSize = this.resolveSize(resolved.size);
    const orientedSize = this.applyOrientation(pageSize, resolved.pageOrientation);
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
    });
  }

  /**
   * Match @page rules applicable to this page context.
   * A rule matches if its name matches (or is universal) AND its pseudo-class
   * matches (or has none).
   */
  matchRules(pageIndex, namedPage) {
    return this.pageRules.filter(rule => {
      // Named rule must match the page's named page
      if (rule.name && rule.name !== namedPage) return false;

      // Pseudo-class must match the page context
      if (rule.pseudoClass === "first" && pageIndex !== 0) return false;
      if (rule.pseudoClass === "left" && !this.isLeftPage(pageIndex)) return false;
      if (rule.pseudoClass === "right" && this.isLeftPage(pageIndex)) return false;
      if (rule.pseudoClass === "blank") return false; // not yet supported

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
      if (rule.margin != null) result.margin = { ...result.margin, ...rule.margin };
      if (rule.pageOrientation != null) result.pageOrientation = rule.pageOrientation;
    }

    return result;
  }

  /** Resolve CSS size property to physical dimensions in CSS pixels. */
  resolveSize(sizeValue) {
    if (!sizeValue || sizeValue === "auto") return { ...this.defaultSize };

    if (typeof sizeValue === "string") {
      const parts = sizeValue.toLowerCase().split(/\s+/);
      const name = parts.find(p => NAMED_SIZES[p.toUpperCase()]);
      const orientation = parts.find(p => p === "landscape" || p === "portrait");

      if (name) {
        const size = { ...NAMED_SIZES[name.toUpperCase()] };
        if (orientation === "landscape") {
          return { inlineSize: size.blockSize, blockSize: size.inlineSize };
        }
        return size;
      }

      // Bare 'landscape' / 'portrait' — rotate the default size
      if (sizeValue === "landscape") {
        return { inlineSize: this.defaultSize.blockSize, blockSize: this.defaultSize.inlineSize };
      }
      if (sizeValue === "portrait") return { ...this.defaultSize };

      // Try parsing as one or two length values
      const lengths = parts.map(parseCSSLength).filter(v => v !== null);
      if (lengths.length === 1) return { inlineSize: lengths[0], blockSize: lengths[0] };
      if (lengths.length >= 2) return { inlineSize: lengths[0], blockSize: lengths[1] };
    }

    // Array: [width, height] or [side]
    if (Array.isArray(sizeValue)) {
      return { inlineSize: sizeValue[0], blockSize: sizeValue[1] ?? sizeValue[0] };
    }

    return { ...this.defaultSize };
  }

  /** Apply page-orientation by swapping dimensions. */
  applyOrientation(size, orientation) {
    if (orientation === "rotate-left" || orientation === "rotate-right") {
      return { inlineSize: size.blockSize, blockSize: size.inlineSize };
    }
    return size;
  }

  /** Resolve margin declarations to pixel values. */
  resolveMargins(marginDecl, pageSize) {
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

// ---- @page rule parsing ----

/**
 * Parse @page rules from <style> elements.
 *
 * @param {Iterable<HTMLStyleElement>} styleElements
 * @returns {PageRule[]}
 */
export function parsePageRulesFromStyleSheets(styleElements) {
  const rules = [];
  const PAGE_RE = /@page\s*([^{]*)\{([^}]*)\}/g;

  for (const style of styleElements) {
    const text = style.textContent;
    let match;
    PAGE_RE.lastIndex = 0;

    while ((match = PAGE_RE.exec(text)) !== null) {
      const selector = match[1].trim();
      const body = match[2];

      // Parse selector: optional name, optional :pseudo
      let name = null;
      let pseudoClass = null;
      const selectorMatch = selector.match(/^(\w+)?\s*(?::(\w+))?$/);
      if (selectorMatch) {
        name = selectorMatch[1] || null;
        pseudoClass = selectorMatch[2] || null;
      }

      // Parse size
      let size = null;
      const sizeMatch = body.match(/size\s*:\s*([^;]+)/);
      if (sizeMatch) {
        const sizeStr = sizeMatch[1].trim();
        const parts = sizeStr.split(/\s+/);
        const hasNamedSize = parts.some(p => NAMED_SIZES[p.toUpperCase()]);
        const hasOrientation = parts.some(p => p === "landscape" || p === "portrait");

        if (hasNamedSize || hasOrientation) {
          size = sizeStr.toLowerCase();
        } else {
          const lengths = parts.map(parseCSSLength).filter(v => v !== null);
          if (lengths.length === 1) size = [lengths[0], lengths[0]];
          else if (lengths.length >= 2) size = [lengths[0], lengths[1]];
        }
      }

      // Parse margins
      const margin = parseMarginProperties(body);

      // Parse page-orientation
      let pageOrientation = null;
      const orientMatch = body.match(/page-orientation\s*:\s*([^;]+)/);
      if (orientMatch) {
        pageOrientation = orientMatch[1].trim();
      }

      rules.push(new PageRule({ name, pseudoClass, size, margin, pageOrientation }));
    }
  }

  return rules;
}

/**
 * Parse margin properties from an @page rule body.
 * Handles shorthand `margin` and individual `margin-top` etc.
 */
function parseMarginProperties(body) {
  let margin = null;

  // Shorthand margin
  const shorthandMatch = body.match(/(?:^|;|\s)margin\s*:\s*([^;]+)/);
  if (shorthandMatch) {
    const parts = shorthandMatch[1].trim().split(/\s+/);
    const values = parts.map(parseCSSLength).filter(v => v !== null);
    if (values.length === 1) {
      margin = { top: values[0], right: values[0], bottom: values[0], left: values[0] };
    } else if (values.length === 2) {
      margin = { top: values[0], right: values[1], bottom: values[0], left: values[1] };
    } else if (values.length === 3) {
      margin = { top: values[0], right: values[1], bottom: values[2], left: values[1] };
    } else if (values.length >= 4) {
      margin = { top: values[0], right: values[1], bottom: values[2], left: values[3] };
    }
  }

  // Individual margin properties (override shorthand)
  const sides = ["top", "right", "bottom", "left"];
  for (const side of sides) {
    const re = new RegExp(`margin-${side}\\s*:\\s*([^;]+)`);
    const m = body.match(re);
    if (m) {
      const val = parseCSSLength(m[1].trim());
      if (val !== null) {
        if (!margin) margin = { top: 0, right: 0, bottom: 0, left: 0 };
        margin[side] = val;
      }
    }
  }

  return margin;
}
