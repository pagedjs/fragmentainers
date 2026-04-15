import { ConstraintSpace, FRAGMENTATION_PAGE } from "../fragmentation/constraint-space.js";
import { BREAK_TOKEN_INLINE } from "../fragmentation/tokens.js";
import { cssValue, parseNumeric } from "../styles/css-values.js";
import { walkRules } from "../styles/walk-rules.js";

// Named page sizes (CSS pixels at 96 DPI, floor-rounded to match resolveSize)
export const NAMED_SIZES = {
	A6: { inlineSize: 396, blockSize: 559 },
	A5: { inlineSize: 559, blockSize: 793 },
	A4: { inlineSize: 793, blockSize: 1122 },
	A3: { inlineSize: 1122, blockSize: 1587 },
	B5: { inlineSize: 665, blockSize: 944 },
	B4: { inlineSize: 944, blockSize: 1334 },
	LETTER: { inlineSize: 816, blockSize: 1056 },
	LEGAL: { inlineSize: 816, blockSize: 1344 },
	LEDGER: { inlineSize: 1056, blockSize: 1632 },
};

// Named page sizes in original CSS units (for subpixel-accurate rendering)
export const NAMED_SIZES_CSS = {
	A6: { inline: [105, "mm"], block: [148, "mm"] },
	A5: { inline: [148, "mm"], block: [210, "mm"] },
	A4: { inline: [210, "mm"], block: [297, "mm"] },
	A3: { inline: [297, "mm"], block: [420, "mm"] },
	B5: { inline: [176, "mm"], block: [250, "mm"] },
	B4: { inline: [250, "mm"], block: [353, "mm"] },
	LETTER: { inline: [8.5, "in"], block: [11, "in"] },
	LEGAL: { inline: [8.5, "in"], block: [14, "in"] },
	LEDGER: { inline: [11, "in"], block: [17, "in"] },
};

/**
 * Parsed representation of a CSS `@page` rule.
 */
export class PageRule {
	/**
	 * @param {object} opts
	 * @param {string|null} [opts.name] - Named page type ('chapter', 'cover'), or null for universal
	 * @param {string[]} [opts.pseudoClasses] - Subset of 'first', 'left', 'right', 'blank'
	 * @param {string|number[]|null} [opts.size] - 'a4', 'letter landscape', [width, height], or null
	 * @param {object|null} [opts.margin] - { top, right, bottom, left } in CSS px
	 * @param {string|null} [opts.pageOrientation] - 'rotate-left', 'rotate-right', or null
	 * @param {CSSUnitValue[]|null} [opts.rawSize] - [inline, block] as CSSUnitValues with original units
	 * @param {object|null} [opts.rawMargin] - { top, right, bottom, left } as CSSUnitValues
	 */
	constructor({ name, pseudoClasses, size, margin, pageOrientation, rawSize, rawMargin } = {}) {
		this.name = name || null;
		this.pseudoClasses = pseudoClasses ?? [];
		this.size = size ?? null;
		this.margin = margin ?? null;
		this.pageOrientation = pageOrientation ?? null;
		this.rawSize = rawSize ?? null;
		this.rawMargin = rawMargin ?? null;
	}
}

/**
 * Compute CSS Paged Media §3.4 specificity as a tuple [f, g, h]:
 *   f — 1 if a page type name is present, else 0
 *   g — count of :first / :blank pseudo-classes
 *   h — count of :left / :right pseudo-classes
 * Compared lexicographically; higher wins.
 *
 * @param {PageRule} rule
 * @returns {[number, number, number]}
 */
export function pageRuleSpecificity(rule) {
	let g = 0;
	let h = 0;
	for (const pc of rule.pseudoClasses) {
		if (pc === "first" || pc === "blank") g++;
		else if (pc === "left" || pc === "right") h++;
	}
	return [rule.name ? 1 : 0, g, h];
}

/**
 * Lexicographic comparator over [f, g, h] tuples.
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 * @returns {number}
 */
export function compareSpecificity(a, b) {
	return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
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
	 * @param {boolean} opts.isFirst
	 * @param {boolean} opts.isVerso
	 * @param {boolean} opts.isRecto
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
		isFirst,
		isVerso,
		isRecto,
		isBlank = false,
		matchedRules = [],
		cssText = null,
	}) {
		this.pageIndex = pageIndex;
		this.namedPage = namedPage;
		this.pageBoxSize = pageBoxSize;
		this.margins = margins;
		this.contentArea = contentArea;
		this.isFirst = isFirst;
		this.isVerso = isVerso;
		this.isRecto = isRecto;
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

		const verso = this.isVerso(pageIndex);
		return new PageConstraints({
			pageIndex,
			namedPage,
			pageBoxSize: orientedSize,
			margins,
			contentArea,
			isFirst: pageIndex === 0,
			isVerso: verso,
			isRecto: !verso,
			isBlank,
			matchedRules: matchingRules,
			cssText: {},
		});
	}

	/**
	 * Match @page rules applicable to this page context.
	 * A rule matches if its name matches (or is universal) AND every
	 * pseudo-class in its selector matches the page context.
	 */
	matchRules(pageIndex, namedPage, isBlank = false) {
		return this.pageRules.filter((rule) => {
			if (rule.name && rule.name !== namedPage) return false;

			for (const pc of rule.pseudoClasses) {
				if (pc === "first" && pageIndex !== 0) return false;
				if (pc === "left" && !this.isVerso(pageIndex)) return false;
				if (pc === "right" && this.isVerso(pageIndex)) return false;
				if (pc === "blank" && !isBlank) return false;
			}

			return true;
		});
	}

	/**
	 * Cascade matched rules per CSS Paged Media §3.4.
	 * Sorts by lexicographic [f, g, h] specificity; Array.sort's stability
	 * preserves document order as the tiebreaker.
	 */
	cascadeRules(matchingRules) {
		const result = {
			size: null,
			margin: null,
			pageOrientation: null,
			rawSize: null,
			rawMargin: null,
		};

		const sorted = [...matchingRules].sort((a, b) =>
			compareSpecificity(pageRuleSpecificity(a), pageRuleSpecificity(b)),
		);

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
		let inlineSize, blockSize;

		if (!sizeValue || sizeValue === "auto") {
			({ inlineSize, blockSize } = this.size);
		} else if (typeof sizeValue === "string") {
			const parts = sizeValue.toLowerCase().split(/\s+/);
			const name = parts.find((p) => NAMED_SIZES[p.toUpperCase()]);
			const orientation = parts.find((p) => p === "landscape" || p === "portrait");

			if (name) {
				const size = NAMED_SIZES[name.toUpperCase()];
				inlineSize = orientation === "landscape" ? size.blockSize : size.inlineSize;
				blockSize = orientation === "landscape" ? size.inlineSize : size.blockSize;
			} else if (sizeValue === "landscape") {
				inlineSize = this.size.blockSize;
				blockSize = this.size.inlineSize;
			} else if (sizeValue === "portrait") {
				({ inlineSize, blockSize } = this.size);
			} else {
				const size = parts
					.map((s) => parseNumeric(s)?.to("px").value ?? null)
					.filter((v) => v !== null);
				inlineSize = size[0] ?? this.size.inlineSize;
				blockSize = size[1] ?? size[0] ?? this.size.blockSize;
			}
		} else if (Array.isArray(sizeValue)) {
			inlineSize = sizeValue[0];
			blockSize = sizeValue[1] ?? sizeValue[0];
		} else {
			({ inlineSize, blockSize } = this.size);
		}

		return { inlineSize: Math.floor(inlineSize), blockSize: Math.floor(blockSize) };
	}

	/** Apply page-orientation by swapping dimensions. */
	applyOrientation(size, orientation) {
		if (orientation === "rotate-left" || orientation === "rotate-right") {
			return { inlineSize: size.blockSize, blockSize: size.inlineSize };
		}
		return size;
	}

	/** Resolve margin declarations to pixel values. */
	resolveMargins(marginDecl) {
		const SIDES = ["top", "right", "bottom", "left"];
		const margins = {};
		for (const side of SIDES) {
			margins[side] = Math.floor(marginDecl?.[side] ?? 0);
		}
		return margins;
	}

	/** In LTR page progression, page 0 is recto (right), page 1 is verso (left). */
	isVerso(pageIndex) {
		return pageIndex % 2 === 1;
	}

	/** Inverse of isVerso — true when the page is recto (right). */
	isRecto(pageIndex) {
		return !this.isVerso(pageIndex);
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
	walkRules(cssRules, (rule) => {
		if (rule instanceof CSSPageRule) {
			const parsed = parseOnePageRule(rule);
			if (parsed) out.push(parsed);
		}
	});
	return out;
}

const VALID_PAGE_PSEUDOS = new Set(["first", "left", "right", "blank"]);

/**
 * Parse an @page selector into an optional name and pseudo-class list.
 * Returns null if any pseudo is outside the CSS Paged Media allowlist
 * (matches the spec's "invalid rule dropped" behavior).
 *
 * @param {string} selectorText
 * @returns {{ name: string|null, pseudoClasses: string[] }|null}
 */
export function parsePageSelector(selectorText) {
	const trimmed = (selectorText || "").trim();
	if (!trimmed) return { name: null, pseudoClasses: [] };

	const parts = trimmed.split(":");
	const name = parts[0] || null;
	const seen = new Set();
	const pseudoClasses = [];
	for (const raw of parts.slice(1)) {
		const pc = raw.toLowerCase();
		if (!VALID_PAGE_PSEUDOS.has(pc)) return null;
		if (seen.has(pc)) continue;
		seen.add(pc);
		pseudoClasses.push(pc);
	}
	return { name, pseudoClasses };
}

/**
 * Extract a PageRule from a CSSPageRule instance, or null if the
 * selector contains an unknown pseudo-class.
 * @param {CSSPageRule} rule
 * @returns {PageRule|null}
 */
function parseOnePageRule(rule) {
	const parsed = parsePageSelector(rule.selectorText);
	if (!parsed) return null;

	const size = parsePageSize(rule.style);
	const margin = parsePageMargins(rule.style);
	const pageOrientation = rule.style.getPropertyValue("page-orientation").trim() || null;

	// Extract original CSS unit values from the specified style
	const rawSize = parseRawPageSize(rule.style);
	const rawMargin = parseRawPageMargins(rule.style);

	return new PageRule({
		name: parsed.name,
		pseudoClasses: parsed.pseudoClasses,
		size,
		margin,
		pageOrientation,
		rawSize,
		rawMargin,
	});
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

	const size = parts
		.map((s) => parseNumeric(s)?.to("px").value ?? null)
		.filter((v) => v !== null);
	if (size.length === 1) return [size[0], size[0]];
	if (size.length >= 2) return [size[0], size[1]];

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
			const val = parseNumeric(raw)?.to("px").value;
			if (val != null) {
				if (!margin) margin = { top: 0, right: 0, bottom: 0, left: 0 };
				margin[side] = val;
			}
		}
	}

	// Firefox may not expand the margin shorthand to longhands in @page rules.
	// Fall back to parsing the shorthand directly.
	if (!margin) {
		const shorthand = style.getPropertyValue("margin").trim();
		if (shorthand) {
			const parts = shorthand
				.split(/\s+/)
				.map((s) => parseNumeric(s)?.to("px").value ?? null)
				.filter((v) => v !== null);
			if (parts.length === 1) {
				margin = { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
			} else if (parts.length === 2) {
				margin = { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
			} else if (parts.length === 3) {
				margin = { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
			} else if (parts.length >= 4) {
				margin = { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
			}
		}
	}

	return margin;
}

/**
 * Extract the `size` descriptor as a typed [inline, block] pair
 * preserving original CSS units for cssText generation.
 * Returns null for unparseable values.
 * @param {CSSStyleDeclaration} style
 */
function parseRawPageSize(style) {
	const sizeStr = style.getPropertyValue("size").trim();
	if (!sizeStr) return null;

	const parts = sizeStr.split(/\s+/);

	// Handle named sizes (a4, letter, etc.) with optional orientation
	const namePart = parts.find((p) => NAMED_SIZES_CSS[p.toUpperCase()]);
	if (namePart) {
		const css = NAMED_SIZES_CSS[namePart.toUpperCase()];
		const orientation = parts.find((p) => p === "landscape" || p === "portrait");
		let inlineVal = cssValue(css.inline[0], css.inline[1]);
		let blockVal = cssValue(css.block[0], css.block[1]);
		if (orientation === "landscape") {
			[inlineVal, blockVal] = [blockVal, inlineVal];
		}
		return [inlineVal, blockVal];
	}

	const values = parts.map(parseNumeric).filter((v) => v !== null);
	if (values.length === 1) return [values[0], values[0]];
	if (values.length >= 2) return [values[0], values[1]];
	return null;
}

/**
 * Extract margin longhands as typed values preserving original units.
 * Returns null if no margins are specified.
 * @param {CSSStyleDeclaration} style
 */
function parseRawPageMargins(style) {
	const SIDES = ["top", "right", "bottom", "left"];
	let rawMargin = null;
	const zero = cssValue(0, "px");

	for (const side of SIDES) {
		const raw = style.getPropertyValue(`margin-${side}`).trim();
		if (raw) {
			const val = parseNumeric(raw);
			if (val !== null) {
				if (!rawMargin) rawMargin = { top: zero, right: zero, bottom: zero, left: zero };
				rawMargin[side] = val;
			}
		}
	}

	// Shorthand fallback (Firefox may not expand margin to longhands in @page)
	if (!rawMargin) {
		const shorthand = style.getPropertyValue("margin").trim();
		if (shorthand) {
			const parts = shorthand
				.split(/\s+/)
				.map(parseNumeric)
				.filter((v) => v !== null);
			if (parts.length === 1) {
				rawMargin = { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
			} else if (parts.length === 2) {
				rawMargin = { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
			} else if (parts.length === 3) {
				rawMargin = { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
			} else if (parts.length >= 4) {
				rawMargin = { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
			}
		}
	}

	return rawMargin;
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
 * @param {import("../fragmentation/tokens.js").BlockBreakToken|null} breakToken
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
 * prevented the forced break from firing in BlockContainerAlgorithm.
 *
 * @param {import("../layout/layout-node.js").LayoutNode} rootNode
 * @param {import("../fragmentation/tokens.js").BlockBreakToken|null} breakToken
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
 * @param {import("../layout/layout-node.js").LayoutNode} node
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
 * @param {import("../layout/layout-node.js").LayoutNode} rootNode
 * @param {import("../fragmentation/tokens.js").BlockBreakToken|null} breakToken
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
 * @param {import("../layout/layout-node.js").LayoutNode} rootNode
 * @param {import("../fragmentation/tokens.js").BlockBreakToken} breakToken
 * @returns {import("../layout/layout-node.js").LayoutNode|null}
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
