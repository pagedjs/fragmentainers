import { ConstraintSpace } from "../core/constraint-space.js";
import { FRAGMENTATION_PAGE, NAMED_SIZES, BREAK_TOKEN_INLINE } from "../core/constants.js";

/**
 * Parse a CSS length string into a CSSUnitValue.
 * Returns null for non-length values (keywords, named sizes, etc.).
 * @param {string} str - e.g. "105mm", "20px", "1in"
 * @returns {CSSUnitValue|null}
 */
export function parseCSSUnitValue(str) {
	const match = str.trim().match(/^([\d.]+)(px|in|cm|mm|pt)?$/);
	if (!match) return null;
	const value = parseFloat(match[1]);
	const unit = match[2] || "px";
	return new CSSUnitValue(value, unit);
}

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
	let px;
	switch (unit) {
		case "px":
			px = value;
			break;
		case "in":
			px = value * 96;
			break;
		case "cm":
			px = (value * 96) / 2.54;
			break;
		case "mm":
			px = (value * 96) / 25.4;
			break;
		case "pt":
			px = (value * 96) / 72;
			break;
		default:
			px = value;
	}
	// Snap to 1/64px grid to match Chromium's LayoutUnit quantization
	// (truncates toward zero, not round-to-nearest).
	// Add a small epsilon before flooring to absorb floating-point
	// precision loss (e.g. 25.4 * 96 / 25.4 → 95.9999... not 96).
	return Math.floor(px * 64 + 1e-6) / 64;
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
	 * @param {CSSUnitValue[]|null} [opts.rawSize] - [inline, block] as CSSUnitValues with original units
	 * @param {object|null} [opts.rawMargin] - { top, right, bottom, left } as CSSUnitValues
	 */
	constructor({ name, pseudoClass, size, margin, pageOrientation, rawSize, rawMargin } = {}) {
		this.name = name || null;
		this.pseudoClass = pseudoClass || null;
		this.size = size ?? null;
		this.margin = margin ?? null;
		this.pageOrientation = pageOrientation ?? null;
		this.rawSize = rawSize ?? null;
		this.rawMargin = rawMargin ?? null;
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
	 * @param {PageRule[]} [opts.matchedRules] - The @page rules that matched this page
	 * @param {object|null} [opts.cssText] - Original CSS unit values for rendering
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
		matchedRules = [],
		cssText = null,
	}) {
		this.pageIndex = pageIndex;
		this.namedPage = namedPage;
		this.pageBoxSize = pageBoxSize;
		this.margins = margins;
		this.contentArea = contentArea;
		this.isFirstPage = isFirstPage;
		this.isLeftPage = isLeftPage;
		this.isBlank = isBlank;
		this.matchedRules = matchedRules;
		this.cssText = cssText;
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
export class PageResolver {
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
	 * @returns {PageResolver}
	 */
	static fromDocument(size) {
		const rules = [];
		if (typeof document !== "undefined" && document.styleSheets) {
			for (const sheet of document.styleSheets) {
				try {
					collectPageRules(sheet.cssRules, rules);
				} catch {
					/* cross-origin sheet */
				}
			}
		}
		return new PageResolver(rules, size);
	}

	/**
	 * Create a resolver by collecting @page rules from an array of CSSStyleSheets.
	 *
	 * @param {CSSStyleSheet[]} sheets - Stylesheets to scan for @page rules
	 * @param {{ inlineSize: number, blockSize: number }} [size] - Fallback size (default: US Letter)
	 * @returns {PageResolver}
	 */
	static fromStyleSheets(sheets, size) {
		const rules = [];
		for (const sheet of sheets) {
			try {
				collectPageRules(sheet.cssRules, rules);
			} catch {
				/* cross-origin sheet */
			}
		}
		return new PageResolver(rules, size);
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
		const namedPage = rootNode ? resolveNamedPageForBreakToken(rootNode, breakToken) : null;
		const matchingRules = this.matchRules(pageIndex, namedPage, isBlank);
		const resolved = this.cascadeRules(matchingRules);
		const pageSize = this.resolveSize(resolved.size);
		const orientedSize = this.applyOrientation(pageSize, resolved.pageOrientation);
		const margins = this.resolveMargins(resolved.margin, orientedSize);
		const contentArea = {
			inlineSize: orientedSize.inlineSize - margins.left - margins.right,
			blockSize: orientedSize.blockSize - margins.top - margins.bottom,
		};

		// Build cssText with original CSS units using CSSUnitValue arithmetic.
		// Falls back to null when raw values are unavailable or units are mixed.
		const cssText = buildCSSText(resolved.rawSize, resolved.rawMargin, resolved.pageOrientation);

		return new PageConstraints({
			pageIndex,
			namedPage,
			pageBoxSize: orientedSize,
			margins,
			contentArea,
			isFirstPage: pageIndex === 0,
			isLeftPage: this.isLeftPage(pageIndex),
			isBlank,
			matchedRules: matchingRules,
			cssText,
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
			if (rule.pseudoClass === "left" && !this.isLeftPage(pageIndex)) return false;
			if (rule.pseudoClass === "right" && this.isLeftPage(pageIndex)) return false;
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
		const result = {
			size: null,
			margin: null,
			pageOrientation: null,
			rawSize: null,
			rawMargin: null,
		};

		// Stable sort by specificity — Array.sort is stable in modern engines
		const sorted = [...matchingRules].sort((a, b) => {
			const specA = (a.name ? 2 : 0) + (a.pseudoClass ? 1 : 0);
			const specB = (b.name ? 2 : 0) + (b.pseudoClass ? 1 : 0);
			return specA - specB;
		});

		for (const rule of sorted) {
			if (rule.size != null) {
				result.size = rule.size;
				result.rawSize = rule.rawSize;
			}
			if (rule.margin != null) {
				result.margin = { ...result.margin, ...rule.margin };
				result.rawMargin = { ...result.rawMargin, ...rule.rawMargin };
			}
			if (rule.pageOrientation != null) result.pageOrientation = rule.pageOrientation;
		}

		return result;
	}

	/** Resolve CSS size property to physical dimensions in CSS pixels. */
	resolveSize(sizeValue) {
		if (!sizeValue || sizeValue === "auto") return { ...this.size };

		if (typeof sizeValue === "string") {
			const parts = sizeValue.toLowerCase().split(/\s+/);
			const name = parts.find((p) => NAMED_SIZES[p.toUpperCase()]);
			const orientation = parts.find((p) => p === "landscape" || p === "portrait");

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
			if (lengths.length === 1) return { inlineSize: lengths[0], blockSize: lengths[0] };
			if (lengths.length >= 2) return { inlineSize: lengths[0], blockSize: lengths[1] };
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
	const pageOrientation = rule.style.getPropertyValue("page-orientation").trim() || null;

	// Extract original CSS unit values from the specified style
	const rawSize = parseRawPageSize(rule.style);
	const rawMargin = parseRawPageMargins(rule.style);

	return new PageRule({ name, pseudoClass, size, margin, pageOrientation, rawSize, rawMargin });
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
	const hasOrientation = parts.some((p) => p === "landscape" || p === "portrait");

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

/**
 * Extract the `size` descriptor as CSSUnitValue pair [inline, block].
 * Returns null for named sizes, orientation-only, or unparseable values.
 * @param {CSSStyleDeclaration} style
 * @returns {CSSUnitValue[]|null}
 */
function parseRawPageSize(style) {
	const sizeStr = style.getPropertyValue("size").trim();
	if (!sizeStr) return null;

	const parts = sizeStr.split(/\s+/);
	const values = parts.map(parseCSSUnitValue).filter((v) => v !== null);
	if (values.length === 1) return [values[0], values[0]];
	if (values.length >= 2) return [values[0], values[1]];
	return null;
}

/**
 * Extract margin longhands as CSSUnitValue objects.
 * Returns null if no margins are specified.
 * @param {CSSStyleDeclaration} style
 * @returns {{ top: CSSUnitValue, right: CSSUnitValue, bottom: CSSUnitValue, left: CSSUnitValue }|null}
 */
function parseRawPageMargins(style) {
	const SIDES = ["top", "right", "bottom", "left"];
	let rawMargin = null;
	const zero = new CSSUnitValue(0, "px");

	for (const side of SIDES) {
		const raw = style.getPropertyValue(`margin-${side}`).trim();
		if (raw) {
			const val = parseCSSUnitValue(raw);
			if (val !== null) {
				if (!rawMargin) rawMargin = { top: zero, right: zero, bottom: zero, left: zero };
				rawMargin[side] = val;
			}
		}
	}

	return rawMargin;
}

/**
 * Build a cssText object with original CSS unit values for rendering.
 * Uses CSSUnitValue arithmetic to compute the content area in original units.
 * Returns null when raw values are unavailable.
 *
 * @param {CSSUnitValue[]|null} rawSize - [inline, block] from cascaded rules
 * @param {object|null} rawMargin - { top, right, bottom, left } CSSUnitValues
 * @param {string|null} pageOrientation - 'rotate-left', 'rotate-right', or null
 * @returns {object|null}
 */
function buildCSSText(rawSize, rawMargin, pageOrientation) {
	if (!rawSize) return null;

	let [inlineSize, blockSize] = rawSize;

	// Apply orientation by swapping dimensions
	if (pageOrientation === "rotate-left" || pageOrientation === "rotate-right") {
		[inlineSize, blockSize] = [blockSize, inlineSize];
	}

	const margin = rawMargin || {
		top: new CSSUnitValue(0, "px"),
		right: new CSSUnitValue(0, "px"),
		bottom: new CSSUnitValue(0, "px"),
		left: new CSSUnitValue(0, "px"),
	};

	// Compute content area using CSSUnitValue arithmetic.
	// sub() works when units are the same (e.g. mm - mm).
	// For mixed units, fall back to null.
	let contentInline, contentBlock;
	try {
		contentInline = inlineSize.sub(margin.left).sub(margin.right);
		contentBlock = blockSize.sub(margin.top).sub(margin.bottom);
	} catch {
		return {
			pageBoxSize: { inline: inlineSize, block: blockSize },
			margin,
			contentArea: null,
		};
	}

	return {
		pageBoxSize: { inline: inlineSize, block: blockSize },
		contentArea: { inline: contentInline, block: contentBlock },
		margin,
	};
}

/**
 * Check if a CSS break value requires a specific page side.
 * Only left/right/recto/verso are side-specific; page/column/always are not.
 * @param {string} value
 * @returns {boolean}
 */
export function isSideSpecificBreak(value) {
	return value === "left" || value === "right" || value === "recto" || value === "verso";
}

/**
 * Return the required page side for a side-specific break value.
 * Normalizes recto → "right" and verso → "left" (LTR page progression).
 * @param {string} value
 * @returns {"left"|"right"|null}
 */
export function requiredPageSide(value) {
	if (value === "right" || value === "recto") return "right";
	if (value === "left" || value === "verso") return "left";
	return null;
}

/**
 * Walk the break token tree to find the forcedBreakValue that triggered the break.
 * Follows the last child at each level (the active break path).
 * @param {import("../core/tokens.js").BlockBreakToken|null} breakToken
 * @returns {string|null}
 */
export function resolveForcedBreakValue(breakToken) {
	if (!breakToken) return null;
	let current = breakToken;
	while (current.childBreakTokens && current.childBreakTokens.length > 0) {
		const lastChild = current.childBreakTokens[current.childBreakTokens.length - 1];
		if (lastChild.isForcedBreak && lastChild.forcedBreakValue) {
			return lastChild.forcedBreakValue;
		}
		if (lastChild.isBreakBefore) break;
		current = lastChild;
	}
	return current.forcedBreakValue || null;
}

/**
 * Resolve the break-before CSS value of the first child that will appear
 * on the next page. Used to detect side-specific breaks when blockOffset === 0
 * prevented the forced break from firing in layoutBlockContainer.
 *
 * @param {import("../core/helpers.js").LayoutNode} rootNode
 * @param {import("../core/tokens.js").BlockBreakToken|null} breakToken
 * @returns {string|null}
 */
export function resolveNextPageBreakBefore(rootNode, breakToken) {
	if (!breakToken) {
		return rootNode.children[0]?.breakBefore || null;
	}
	let current = breakToken;
	while (current.childBreakTokens && current.childBreakTokens.length > 0) {
		const lastChild = current.childBreakTokens[current.childBreakTokens.length - 1];
		if (lastChild.isBreakBefore) {
			return lastChild.node?.breakBefore || null;
		}
		current = lastChild;
	}
	if (current.type === BREAK_TOKEN_INLINE) return null;

	const nextChild = findNextUnvisitedChild(rootNode, breakToken);
	return nextChild?.breakBefore || null;
}

/**
 * Read the CSS `page` property from a node.
 * @param {import("../core/helpers.js").LayoutNode} node
 * @returns {string|null}
 */
export function getNamedPage(node) {
	if (!node) return null;
	return node.page || null;
}

/**
 * Walk the break token tree to find the named page for the next page.
 *
 * Determines which element will be first on the next page and reads its
 * CSS `page` property to drive @page rule resolution.
 *
 * @param {import("../core/helpers.js").LayoutNode} rootNode
 * @param {import("../core/tokens.js").BlockBreakToken|null} breakToken
 * @returns {string|null}
 */
export function resolveNamedPageForBreakToken(rootNode, breakToken) {
	if (!breakToken) {
		const firstChild = rootNode.children[0];
		return getNamedPage(firstChild);
	}

	let current = breakToken;
	while (current.childBreakTokens && current.childBreakTokens.length > 0) {
		const lastChild = current.childBreakTokens[current.childBreakTokens.length - 1];
		if (lastChild.isBreakBefore) {
			return getNamedPage(lastChild.node);
		}
		current = lastChild;
	}

	if (current.type === BREAK_TOKEN_INLINE) {
		return getNamedPage(current.node);
	}

	return getNamedPage(findNextUnvisitedChild(rootNode, breakToken));
}

/**
 * Find the next child that hasn't been fully laid out, given a break token.
 * Walks from the deepest break token child up to find a next sibling.
 *
 * @param {import("../core/helpers.js").LayoutNode} rootNode
 * @param {import("../core/tokens.js").BlockBreakToken} breakToken
 * @returns {import("../core/helpers.js").LayoutNode|null}
 */
function findNextUnvisitedChild(rootNode, breakToken) {
	const path = [];
	let current = breakToken;
	let parentNode = rootNode;
	while (current.childBreakTokens && current.childBreakTokens.length > 0) {
		const lastChild = current.childBreakTokens[current.childBreakTokens.length - 1];
		path.push({ parentNode, childToken: lastChild });
		parentNode = lastChild.node;
		current = lastChild;
	}

	for (let i = path.length - 1; i >= 0; i--) {
		const { parentNode: parent, childToken } = path[i];
		const children = parent.children;
		const idx = children.indexOf(childToken.node);
		if (idx !== -1 && idx + 1 < children.length) {
			return children[idx + 1];
		}
	}

	return null;
}
