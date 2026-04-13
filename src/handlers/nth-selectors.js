import { LayoutHandler } from "./handler.js";
import { handlers } from "./registry.js";
import { walkRules } from "../styles/walk-rules.js";

/**
 * Layout module for nth-child/nth-of-type selector rewriting.
 *
 * When content is split across fragment containers (shadow DOM), structural
 * pseudo-classes like :nth-child() match the cloned tree instead of the
 * original document order. This module generates per-fragment override
 * stylesheets that re-apply the correct rules.
 *
 * Registered by default.
 */

const NTH_PSEUDO_RE =
	/:(nth-child|nth-of-type|nth-last-child|nth-last-of-type|first-child|last-child|first-of-type|last-of-type|only-child|only-of-type)\b(\([^)]*\))?/g;

/**
 * Parse a CSS An+B expression into { a, b } coefficients.
 */
export function parseAnPlusB(expr) {
	const s = expr.replace(/\s+/g, "").toLowerCase();
	if (s === "odd") return { a: 2, b: 1 };
	if (s === "even") return { a: 2, b: 0 };
	if (!s.includes("n")) return { a: 0, b: parseInt(s, 10) };
	const [aPart, bPart] = s.split("n");
	let a;
	if (aPart === "" || aPart === "+") a = 1;
	else if (aPart === "-") a = -1;
	else a = parseInt(aPart, 10);
	return { a, b: bPart ? parseInt(bPart, 10) : 0 };
}

/**
 * Test whether a 1-based index matches an An+B formula.
 */
export function matchesAnPlusB(index, { a, b }) {
	if (a === 0) return index === b;
	const n = (index - b) / a;
	return Number.isInteger(n) && n >= 0;
}

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

function matchesAllParts(pos, nthParts) {
	for (const part of nthParts) {
		const idx = part.isLast
			? part.isType
				? pos.typeFromEnd
				: pos.childFromEnd
			: part.isType
				? pos.typeIndex
				: pos.childIndex;
		if (!matchesAnPlusB(idx, { a: part.a, b: part.b })) return false;
	}
	return true;
}

function extractFromRuleList(ruleList, descriptors, wrappers) {
	walkRules(ruleList, (rule, ruleWrappers) => {
		if (rule.selectorText === undefined) return;
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
				wrappers: [...ruleWrappers],
			});
		}
	}, wrappers);
}

/**
 * Extract nth-selector descriptors from stylesheets.
 */
export function extractNthDescriptors(sheets) {
	const descriptors = [];
	for (const sheet of sheets) {
		extractFromRuleList(sheet.cssRules, descriptors, []);
	}
	return descriptors;
}

/**
 * Build a per-fragment override stylesheet.
 *
 * Walks all elements in the slot, resolves their source via the shared
 * clone map, computes original positions, stamps data-ref on matching
 * elements, and generates CSS rules using :is([data-ref=...]) selectors.
 */
export function buildPerFragmentNthSheet(slot, descriptors) {
	if (descriptors.length === 0) return null;

	const refLists = descriptors.map(() => []);
	const positionCache = new WeakMap();
	let nextRefId = 0;

	for (const el of slot.querySelectorAll("*")) {
		const sourceEl = handlers.getSource(el);
		if (!sourceEl) continue;

		let pos = positionCache.get(sourceEl);
		if (!pos) {
			pos = computeOriginalPosition(sourceEl);
			if (!pos) continue;
			positionCache.set(sourceEl, pos);
		}

		let ref = null;
		for (let d = 0; d < descriptors.length; d++) {
			if (matchesAllParts(pos, descriptors[d].nthParts)) {
				if (ref === null) {
					ref = String(nextRefId++);
					el.setAttribute("data-ref", ref);
				}
				refLists[d].push(ref);
			}
		}
	}

	const rules = [];
	for (let d = 0; d < descriptors.length; d++) {
		if (refLists[d].length === 0) continue;
		const { baseSelector, cssText, wrappers } = descriptors[d];
		const refSelector = refLists[d].map((r) => `[data-ref="${r}"]`).join(",");
		const fullSelector = baseSelector
			? `${baseSelector}:is(${refSelector})`
			: `:is(${refSelector})`;
		let ruleText = `${fullSelector} { ${cssText} }`;
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

class NthSelectors extends LayoutHandler {
	#descriptors = [];

	resetRules() {
		this.#descriptors = [];
	}

	matchRule(rule, context) {
		const parts = [];
		const baseSelector = rule.selectorText.replace(NTH_PSEUDO_RE, (match, pseudo, args) => {
			parts.push(...parseNthParts(pseudo, args));
			return "";
		});
		if (parts.length > 0) {
			this.#descriptors.push({
				baseSelector: baseSelector.trim() || "*",
				nthParts: parts,
				cssText: rule.style.cssText,
				wrappers: [...context.wrappers],
			});
		}
	}

	layout() {
		return {
			reservedBlockStart: 0,
			reservedBlockEnd: 0,
			afterRender: (wrapper) => {
				if (this.#descriptors.length === 0) return;
				const nthSheet = buildPerFragmentNthSheet(wrapper, this.#descriptors);
				if (nthSheet) {
					wrapper.getRootNode().host.adoptNthSheet(nthSheet);
				}
			},
		};
	}
}

export { NthSelectors };
