import { ConstraintSpace, FRAGMENTATION_PAGE } from "../fragmentation/constraint-space.js";
import { BREAK_TOKEN_INLINE } from "../fragmentation/tokens.js";
import { parseNumeric } from "../styles/css-values.js";
import { walkRules } from "../styles/walk-rules.js";
import { parseAnPlusB, matchesAnPlusB } from "../styles/an-plus-b.js";

// Named page sizes from CSS Paged Media Level 3 §3.1
// (CSS pixels at 96 DPI, rounded to match resolveSize)
export const NAMED_SIZES = {
	A5: { inlineSize: 559, blockSize: 794 },
	A4: { inlineSize: 794, blockSize: 1123 },
	A3: { inlineSize: 1123, blockSize: 1587 },
	B5: { inlineSize: 665, blockSize: 945 },
	B4: { inlineSize: 945, blockSize: 1334 },
	"JIS-B5": { inlineSize: 688, blockSize: 972 },
	"JIS-B4": { inlineSize: 972, blockSize: 1376 },
	LETTER: { inlineSize: 816, blockSize: 1056 },
	LEGAL: { inlineSize: 816, blockSize: 1344 },
	LEDGER: { inlineSize: 1056, blockSize: 1632 },
};

const MARGIN_SIDES = ["top", "right", "bottom", "left"];

/**
 * Structured form of a single `@page` at-rule.
 *
 * @property {string|null} name - Named page type ('chapter', 'cover'), or null for universal
 * @property {string[]} pseudo - Page pseudo-classes: 'first', 'left', 'right', 'blank'
 * @property {{a: number, b: number}|null} nth - `:nth(An+B)` coefficients, or null
 * @property {string|null} size - CSS size value ("A4", "210mm 297mm", ...), or null
 * @property {{ top: string|null, right: string|null, bottom: string|null, left: string|null }|null} margin - CSS lengths, or null
 * @property {string|null} pageOrientation - 'rotate-left', 'rotate-right', or null
 */
export class PageRule {
	constructor({ name, pseudo, nth, size, margin, pageOrientation } = {}) {
		this.name = name || null;
		this.pseudo = pseudo ?? [];
		this.nth = nth ?? null;
		this.size = size ?? null;
		this.margin = margin ?? null;
		this.pageOrientation = pageOrientation ?? null;
	}

	/**
	 * CSS Paged Media §3.4 specificity as [f, g, h]:
	 *   f — 1 if a page type name is present, else 0
	 *   g — count of :first / :blank / :nth pseudo-classes
	 *   h — count of :left / :right pseudo-classes
	 * @returns {[number, number, number]}
	 */
	get specificity() {
		let g = 0;
		let h = 0;
		for (const pc of this.pseudo) {
			if (pc === "first" || pc === "blank") g++;
			else if (pc === "left" || pc === "right") h++;
		}
		if (this.nth) g++;
		return [this.name ? 1 : 0, g, h];
	}

	/**
	 * Lexicographic specificity comparison.
	 * @param {PageRule} other
	 * @returns {number} negative if this < other, 0 if equal, positive if this > other
	 */
	compareSpecificity(other) {
		const a = this.specificity;
		const b = other.specificity;
		return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
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
	 * @param {boolean} opts.isFirst
	 * @param {boolean} opts.isVerso
	 * @param {boolean} opts.isRecto
	 * @param {boolean} [opts.isBlank]
	 * @param {PageRule[]} [opts.matchedRules] - The @page rules that matched this page
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
	 * @param {(PageRule | object)[]} rules - @page rules in document order.
	 *   Plain objects are passed to the `PageRule` constructor.
	 * @param {{ inlineSize: number, blockSize: number }} [size] - Fallback size (default: US Letter)
	 */
	constructor(rules, size = NAMED_SIZES.LETTER) {
		this.pageRules = rules.map((r) => (r instanceof PageRule ? r : new PageRule(r)));
		this.size = size;
	}

	/**
	 * Create a resolver by collecting @page rules from document.styleSheets.
	 *
	 * @param {{ inlineSize: number, blockSize: number }} [size] - Fallback size (default: US Letter)
	 * @returns {PageResolver}
	 */
	static fromDocument(size) {
		const sheets =
			typeof document !== "undefined" && document.styleSheets ? [...document.styleSheets] : [];
		return PageResolver.fromStyleSheets(sheets, size);
	}

	/**
	 * Create a resolver by collecting @page rules from an array of CSSStyleSheets.
	 * Cross-origin sheets whose `cssRules` throw are silently skipped.
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
				// cross-origin sheet
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

			for (const pc of rule.pseudo) {
				if (pc === "first" && pageIndex !== 0) return false;
				if (pc === "left" && !this.isVerso(pageIndex)) return false;
				if (pc === "right" && this.isVerso(pageIndex)) return false;
				if (pc === "blank" && !isBlank) return false;
			}

			if (rule.nth && !matchesAnPlusB(pageIndex + 1, rule.nth)) return false;

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
		};

		const sorted = [...matchingRules].sort((a, b) => a.compareSpecificity(b));

		for (const rule of sorted) {
			if (rule.size != null) {
				result.size = rule.size;
			}
			if (rule.margin != null) {
				if (!result.margin) {
					result.margin = { ...rule.margin };
				} else {
					for (const side of MARGIN_SIDES) {
						if (rule.margin[side] != null) result.margin[side] = rule.margin[side];
					}
				}
			}
			if (rule.pageOrientation != null) result.pageOrientation = rule.pageOrientation;
		}

		return result;
	}

	/** Resolve a CSS `size` string to physical dimensions in CSS pixels. */
	resolveSize(sizeValue) {
		if (!sizeValue || sizeValue === "auto") return { ...this.size };

		const parts = sizeValue.toLowerCase().split(/\s+/);
		const name = parts.find((p) => NAMED_SIZES[p.toUpperCase()]);
		const orientation = parts.find((p) => p === "landscape" || p === "portrait");

		let inlineSize, blockSize;
		if (name) {
			const size = NAMED_SIZES[name.toUpperCase()];
			inlineSize = orientation === "landscape" ? size.blockSize : size.inlineSize;
			blockSize = orientation === "landscape" ? size.inlineSize : size.blockSize;
		} else if (orientation === "landscape") {
			inlineSize = this.size.blockSize;
			blockSize = this.size.inlineSize;
		} else if (orientation === "portrait") {
			return { ...this.size };
		} else {
			const px = parts.map((s) => parseNumeric(s)?.to("px").value ?? null).filter((v) => v !== null);
			inlineSize = px[0] ?? this.size.inlineSize;
			blockSize = px[1] ?? px[0] ?? this.size.blockSize;
		}

		return { inlineSize: Math.round(inlineSize), blockSize: Math.round(blockSize) };
	}

	/** Apply page-orientation by swapping dimensions. */
	applyOrientation(size, orientation) {
		if (orientation === "rotate-left" || orientation === "rotate-right") {
			return { inlineSize: size.blockSize, blockSize: size.inlineSize };
		}
		return size;
	}

	/** Resolve CSS margin strings to pixel values. */
	resolveMargins(marginDecl) {
		const margins = {};
		for (const side of MARGIN_SIDES) {
			const raw = marginDecl?.[side];
			if (raw) {
				const parsed = parseNumeric(String(raw).trim());
				margins[side] = Math.round(parsed?.to("px").value ?? 0);
			} else {
				margins[side] = 0;
			}
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
 * Recursively collect PageRules from a CSSRuleList, descending into
 * grouping rules like @layer, @supports, @media.
 *
 * @param {CSSRuleList} cssRules
 * @param {PageRule[]} [out] - accumulator (created if omitted)
 * @returns {PageRule[]}
 */
export function collectPageRules(cssRules, out = []) {
	walkRules(cssRules, (rule) => {
		if (rule instanceof CSSPageRule) {
			const parsed = pageRuleFromCSSPageRule(rule);
			if (parsed) out.push(parsed);
		}
	});
	return out;
}

const BARE_PAGE_PSEUDOS = new Set(["first", "left", "right", "blank"]);

/**
 * Parse an @page selector into an optional name, the bare pseudo-class
 * list, and `:nth()`'s An+B coefficients if present.
 *
 * Returns null for any selector the spec would drop as invalid: unknown
 * pseudo, missing/empty `:nth()` argument, argument on a bare pseudo, or
 * a malformed An+B expression.
 *
 * @param {string} selectorText
 * @returns {{ name: string|null, pseudo: string[], nth: {a: number, b: number}|null }|null}
 */
export function parsePageSelector(selectorText) {
	const s = (selectorText || "").trim();
	if (!s) return { name: null, pseudo: [], nth: null };

	let i = 0;
	let name = null;
	if (s[i] !== ":") {
		let j = i;
		while (j < s.length && s[j] !== ":") j++;
		name = s.slice(i, j).trim() || null;
		i = j;
	}

	const seen = new Set();
	const pseudo = [];
	let nth = null;
	while (i < s.length) {
		if (s[i] !== ":") return null;
		i++;
		let j = i;
		while (j < s.length && s[j] !== ":" && s[j] !== "(") j++;
		const pc = s.slice(i, j).trim().toLowerCase();
		i = j;

		let arg = null;
		if (s[i] === "(") {
			let depth = 1;
			const start = ++i;
			while (i < s.length && depth > 0) {
				if (s[i] === "(") depth++;
				else if (s[i] === ")") depth--;
				if (depth > 0) i++;
			}
			if (depth !== 0) return null;
			arg = s.slice(start, i);
			i++;
		}

		if (pc === "nth") {
			if (arg === null || !arg.trim()) return null;
			if (nth !== null) return null;
			const { a, b } = parseAnPlusB(arg);
			if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
			nth = { a, b };
		} else if (BARE_PAGE_PSEUDOS.has(pc)) {
			if (arg !== null) return null;
			if (seen.has(pc)) continue;
			seen.add(pc);
			pseudo.push(pc);
		} else {
			return null;
		}
	}

	return { name, pseudo, nth };
}

/**
 * Create a `PageRule` from a `CSSPageRule` instance. Returns `null` when
 * the selector contains an unknown pseudo-class.
 *
 * @param {CSSPageRule} cssPageRule
 * @returns {PageRule | null}
 */
function pageRuleFromCSSPageRule(cssPageRule) {
	const parsed = parsePageSelector(cssPageRule.selectorText);
	if (!parsed) return null;

	const style = cssPageRule.style;
	const margin = parseMargins(style);
	const hasMargin = MARGIN_SIDES.some((s) => margin[s]);

	return new PageRule({
		name: parsed.name,
		pseudo: parsed.pseudo,
		nth: parsed.nth,
		size: style.getPropertyValue("size").trim() || null,
		margin: hasMargin ? margin : null,
		pageOrientation: style.getPropertyValue("page-orientation").trim() || null,
	});
}

/**
 * Extract margin longhands from a CSSStyleDeclaration.
 * (Firefox doesn't always expand the shorthand in @page rules).
 *
 * @param {CSSStyleDeclaration} style
 * @returns {{ top: string|null, right: string|null, bottom: string|null, left: string|null }}
 */
function parseMargins(style) {
	let top = style.getPropertyValue("margin-top").trim() || null;
	let right = style.getPropertyValue("margin-right").trim() || null;
	let bottom = style.getPropertyValue("margin-bottom").trim() || null;
	let left = style.getPropertyValue("margin-left").trim() || null;

	if (!top && !right && !bottom && !left) {
		const shorthand = style.getPropertyValue("margin").trim();
		if (shorthand) {
			const parts = shorthand.split(/\s+/);
			if (parts.length === 1) {
				top = right = bottom = left = parts[0];
			} else if (parts.length === 2) {
				top = bottom = parts[0];
				right = left = parts[1];
			} else if (parts.length === 3) {
				top = parts[0];
				right = left = parts[1];
				bottom = parts[2];
			} else if (parts.length >= 4) {
				top = parts[0];
				right = parts[1];
				bottom = parts[2];
				left = parts[3];
			}
		}
	}

	return { top, right, bottom, left };
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
