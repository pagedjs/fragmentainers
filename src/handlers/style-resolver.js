import { LayoutHandler } from "./handler.js";
import { walkRules } from "../styles/walk-rules.js";

/**
 * Replays structural-pseudo matches across fragment shadow roots.
 *
 * During afterMeasurementSetup, walks the source DOM once and stamps
 * `data-ref="N"` on every element whose source cascade matches a rule
 * containing `:nth-child`, `:last-of-type`, etc. cloneNode carries the
 * attribute into each fragment. A single `@layer nth` sheet adopted
 * into every fragment shadow re-applies the author declarations to the
 * stamped elements.
 *
 * Pairs with `prepareAuthorSheetsForFragment` in
 * `src/styles/strip-structural-pseudos.js`, which removes the author's
 * position-based rules before adoption so they can't misfire against
 * clones whose sibling indexes differ from their source.
 */

const NTH_PSEUDO_RE =
	/:(nth-child|nth-of-type|nth-last-child|nth-last-of-type|first-child|last-child|first-of-type|last-of-type|only-child|only-of-type)\b(\([^)]*\))?/g;

const WHITESPACE_RE = /\s/;

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

/**
 * Split a selector list on top-level commas, honoring ()/[]/string depth.
 */
export function splitSelectorList(selectorText) {
	const results = [];
	let depth = 0;
	let bracket = 0;
	let inString = null;
	let start = 0;
	for (let i = 0; i < selectorText.length; i++) {
		const ch = selectorText[i];
		if (inString) {
			if (ch === "\\") { i++; continue; }
			if (ch === inString) inString = null;
			continue;
		}
		if (ch === '"' || ch === "'") { inString = ch; continue; }
		if (ch === "(") depth++;
		else if (ch === ")") depth--;
		else if (ch === "[") bracket++;
		else if (ch === "]") bracket--;
		else if (ch === "," && depth === 0 && bracket === 0) {
			const s = selectorText.slice(start, i).trim();
			if (s) results.push(s);
			start = i + 1;
		}
	}
	const tail = selectorText.slice(start).trim();
	if (tail) results.push(tail);
	return results;
}

/**
 * Tokenize a selector into compound tokens. `combinator` is the
 * combinator linking the compound to the next one on its right
 * (" ", ">", "+", "~"); the rightmost token has combinator = null.
 */
export function tokenizeSelector(selector) {
	const tokens = [];
	let depth = 0;
	let bracket = 0;
	let inString = null;
	let buf = "";
	const flush = (combinator) => {
		const t = buf.trim();
		if (t) tokens.push({ compound: t, combinator });
		buf = "";
	};
	let i = 0;
	while (i < selector.length) {
		const ch = selector[i];
		if (inString) {
			buf += ch;
			if (ch === "\\" && i + 1 < selector.length) { buf += selector[i + 1]; i += 2; continue; }
			if (ch === inString) inString = null;
			i++;
			continue;
		}
		if (ch === '"' || ch === "'") { inString = ch; buf += ch; i++; continue; }
		if (depth > 0 || bracket > 0) {
			if (ch === "(") depth++;
			else if (ch === ")") depth--;
			else if (ch === "[") bracket++;
			else if (ch === "]") bracket--;
			buf += ch;
			i++;
			continue;
		}
		if (ch === "(") { depth++; buf += ch; i++; continue; }
		if (ch === "[") { bracket++; buf += ch; i++; continue; }
		if (WHITESPACE_RE.test(ch)) {
			let j = i + 1;
			while (j < selector.length && WHITESPACE_RE.test(selector[j])) j++;
			const next = j < selector.length ? selector[j] : "";
			if (next === ">" || next === "+" || next === "~") {
				let k = j + 1;
				while (k < selector.length && WHITESPACE_RE.test(selector[k])) k++;
				flush(next);
				i = k;
				continue;
			}
			if (!next) { i = j; continue; }
			if (buf.trim()) {
				flush(" ");
				i = j;
				continue;
			}
			i = j;
			continue;
		}
		if (ch === ">" || ch === "+" || ch === "~") {
			let k = i + 1;
			while (k < selector.length && WHITESPACE_RE.test(selector[k])) k++;
			flush(ch);
			i = k;
			continue;
		}
		buf += ch;
		i++;
	}
	flush(null);
	return tokens;
}

// Returns null if the compound has an nth pseudo nested inside `()`
// (e.g. `:not(:first-child)`); those selectors can't be cleanly rewritten.
function extractCompoundNth(compoundText) {
	const nthParts = [];
	let nested = false;
	const stripped = compoundText.replace(NTH_PSEUDO_RE, (match, pseudo, args, offset) => {
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
					cssText: rule.style.cssText,
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
				cssText: rule.style.cssText,
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
			const sel = [...desc.refs].map((r) => `[data-ref="${r}"]`).join(",");
			let rt = `${sel} { ${desc.cssText} }`;
			for (let i = desc.wrappers.length - 1; i >= 0; i--) {
				rt = `${desc.wrappers[i]} { ${rt} }`;
			}
			ruleTexts.push(rt);
		}
		if (ruleTexts.length === 0) return null;
		const sheet = new CSSStyleSheet();
		try {
			sheet.replaceSync(`@layer nth {\n${ruleTexts.join("\n")}\n}`);
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
