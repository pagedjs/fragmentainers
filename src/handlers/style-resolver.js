import { LayoutHandler } from "./handler.js";
import { walkRules } from "../styles/walk-rules.js";
import {
	splitSelectorList,
	tokenizeSelector,
	STRUCTURAL_PSEUDO_RE,
} from "../styles/selector-utils.js";
import { parseAnPlusB, matchesAnPlusB } from "../styles/an-plus-b.js";

/**
 * Replays structural-pseudo matches per element after fragmentation.
 *
 * During `afterMeasurementSetup`, walks the source DOM once and stamps
 * `data-ref="N"` on every element whose source cascade matches a rule
 * containing `:nth-child`, `:last-of-type`, etc. `cloneNode` carries
 * the attribute into each fragment.
 *
 * The per-element override sheet emits the original rule's selector
 * with the structural-pseudo segment swapped for `[data-ref="N"]`, so
 * the source-position-correct value re-applies on the clone via the
 * composite scoped sheet. Pairs with `emitNeutralizationCss`, which
 * unsets the original structural-pseudo rules so cloned-only matches
 * can't leak through.
 */

export { parseAnPlusB, matchesAnPlusB };

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
 * Compute the 1-based structural position of an element among its siblings.
 *
 * @param {Element} sourceEl
 * @returns {{ childIndex, typeIndex, childFromEnd, typeFromEnd, totalChildren, totalOfType } | null}
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

// Returns null if the compound has an nth pseudo nested inside `()`
// (e.g. `:not(:first-child)`); those selectors can't be cleanly rewritten.
function extractCompoundNth(compoundText) {
	const nthParts = [];
	let nested = false;
	STRUCTURAL_PSEUDO_RE.lastIndex = 0;
	const stripped = compoundText.replace(STRUCTURAL_PSEUDO_RE, (match, pseudo, args, offset) => {
		let d = 0;
		for (let i = 0; i < offset; i++) {
			const c = compoundText[i];
			if (c === "(") d++;
			else if (c === ")") d--;
		}
		if (d > 0) { nested = true; return match; }
		nthParts.push(...parseNthParts(pseudo, args));
		return "";
	});
	if (nested) return null;
	return { strippedCompound: stripped.trim() || "*", nthParts };
}

function compileSelector(selector) {
	const tokens = tokenizeSelector(selector);
	if (tokens.length === 0) return null;
	const compounds = [];
	let foundAny = false;
	for (const tok of tokens) {
		const extracted = extractCompoundNth(tok.compound);
		if (!extracted) return null;
		if (extracted.nthParts.length > 0) foundAny = true;
		compounds.push({
			strippedCompound: extracted.strippedCompound,
			combinator: tok.combinator,
			nthParts: extracted.nthParts,
		});
	}
	if (!foundAny) return null;
	return { compounds };
}

function safeMatches(el, selector) {
	try {
		return el.matches(selector);
	} catch {
		return false;
	}
}

/**
 * Walk the source-DOM ancestor/sibling chain to verify the compound
 * chain matches the subject element and each compound's nth parts match
 * their element's position.
 */
function matchesCompoundChain(subjectSource, compounds) {
	const last = compounds.length - 1;
	const subject = compounds[last];
	if (!safeMatches(subjectSource, subject.strippedCompound)) return false;
	if (subject.nthParts.length > 0) {
		const pos = computeOriginalPosition(subjectSource);
		if (!pos || !matchesAllParts(pos, subject.nthParts)) return false;
	}
	let current = subjectSource;
	for (let i = last - 1; i >= 0; i--) {
		const comp = compounds[i];
		const combinator = comp.combinator;
		let found = null;
		if (combinator === " ") {
			let p = current.parentElement;
			while (p) {
				if (matchesSingleCompound(p, comp)) { found = p; break; }
				p = p.parentElement;
			}
		} else if (combinator === ">") {
			const p = current.parentElement;
			if (p && matchesSingleCompound(p, comp)) found = p;
		} else if (combinator === "+") {
			const s = current.previousElementSibling;
			if (s && matchesSingleCompound(s, comp)) found = s;
		} else if (combinator === "~") {
			let s = current.previousElementSibling;
			while (s) {
				if (matchesSingleCompound(s, comp)) { found = s; break; }
				s = s.previousElementSibling;
			}
		}
		if (!found) return false;
		current = found;
	}
	return true;
}

function matchesSingleCompound(el, comp) {
	if (!safeMatches(el, comp.strippedCompound)) return false;
	if (comp.nthParts.length === 0) return true;
	const pos = computeOriginalPosition(el);
	return !!pos && matchesAllParts(pos, comp.nthParts);
}

// Serialize a CSSStyleDeclaration as `prop: value !important;` text.
// `!important` is needed so the per-element override beats unlayered
// author rules in the document cascade.
function declarationsAsImportant(style) {
	const parts = [];
	for (let i = 0; i < style.length; i++) {
		const prop = style[i];
		const value = style.getPropertyValue(prop);
		parts.push(`${prop}: ${value} !important;`);
	}
	return parts.join(" ");
}

// Rebuild a selector from `strippedCompound` parts joined by their
// combinators, with `[data-ref="N"]` appended to the subject (rightmost)
// compound so the rule pins to one element rather than re-evaluating
// position on the clone.
function buildRefSelector(compounds, ref) {
	let out = "";
	const last = compounds.length - 1;
	for (let i = 0; i <= last; i++) {
		const c = compounds[i];
		const compound = i === last ? `${c.strippedCompound}[data-ref="${ref}"]` : c.strippedCompound;
		out += compound;
		if (i < last) out += c.combinator === " " ? " " : ` ${c.combinator} `;
	}
	return out;
}

/**
 * Extract compound-aware descriptors from stylesheets. Exposed for tests.
 */
export function extractNthDescriptors(sheets) {
	const descriptors = [];
	for (const sheet of sheets) {
		walkRules(sheet.cssRules, (rule, wrappers) => {
			if (rule instanceof CSSPageRule) return;
			if (rule.selectorText === undefined) return;
			for (const sel of splitSelectorList(rule.selectorText)) {
				const compiled = compileSelector(sel);
				if (!compiled) continue;
				descriptors.push({
					compounds: compiled.compounds,
					declarations: declarationsAsImportant(rule.style),
					wrappers: [...wrappers],
				});
			}
		});
	}
	return descriptors;
}

class StyleResolver extends LayoutHandler {
	#descriptors = [];
	#nextRefId = 0;
	#sheet = null;

	resetRules() {
		this.#descriptors = [];
		this.#nextRefId = 0;
		this.#sheet = null;
	}

	matchRule(rule, context) {
		if (rule instanceof CSSPageRule) return;
		if (!rule.selectorText) return;
		for (const sel of splitSelectorList(rule.selectorText)) {
			const compiled = compileSelector(sel);
			if (!compiled) continue;
			this.#descriptors.push({
				compounds: compiled.compounds,
				declarations: declarationsAsImportant(rule.style),
				wrappers: [...context.wrappers],
				refs: new Set(),
			});
		}
	}

	afterMeasurementSetup(contentRoot) {
		this.resolveStyles(contentRoot);
	}

	/**
	 * Walk the source DOM, stamp `data-ref` on matching elements, and
	 * build the shared override sheet. Idempotent for the same root and
	 * ruleset.
	 *
	 * @param {Element} contentRoot
	 */
	resolveStyles(contentRoot) {
		if (this.#descriptors.length === 0) {
			for (const el of contentRoot.querySelectorAll("[data-ref]")) {
				el.removeAttribute("data-ref");
			}
			return;
		}
		for (const el of contentRoot.querySelectorAll("*")) {
			let ref;
			for (const desc of this.#descriptors) {
				if (!matchesCompoundChain(el, desc.compounds)) continue;
				if (ref === undefined) ref = String(this.#nextRefId++);
				desc.refs.add(ref);
			}
			if (ref !== undefined) {
				el.setAttribute("data-ref", ref);
			} else if (el.hasAttribute("data-ref")) {
				el.removeAttribute("data-ref");
			}
		}
		this.#sheet = this.#buildSheet();
	}

	#buildSheet() {
		const ruleTexts = [];
		for (const desc of this.#descriptors) {
			if (desc.refs.size === 0) continue;
			const sel = [...desc.refs].map((r) => buildRefSelector(desc.compounds, r)).join(", ");
			let rt = `${sel} { ${desc.declarations} }`;
			for (let i = desc.wrappers.length - 1; i >= 0; i--) {
				rt = `${desc.wrappers[i]} { ${rt} }`;
			}
			ruleTexts.push(rt);
		}
		if (ruleTexts.length === 0) return null;
		const sheet = new CSSStyleSheet();
		try {
			sheet.replaceSync(ruleTexts.join("\n"));
		} catch {
			/* invalid declaration */
		}
		return sheet;
	}

	getAdoptedSheets() {
		return this.#sheet ? [this.#sheet] : [];
	}
}

export { StyleResolver };
