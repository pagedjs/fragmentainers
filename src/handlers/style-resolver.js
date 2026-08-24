import { LayoutHandler } from "./handler.js";
import { walkRules } from "../styles/walk-rules.js";
import {
	splitSelectorList,
	tokenizeSelector,
	STRUCTURAL_PSEUDO_RE,
} from "../styles/selector-utils.js";
import { parseAnPlusB, matchesAnPlusB } from "../styles/an-plus-b.js";

/**
 * Replays source-tree selector matches per element after fragmentation.
 *
 * Structural-pseudo matches are resolved from original sibling positions.
 * Sibling-combinator matches are captured by `prepareContent`, before the
 * measurer partitions top-level content into segments. `data-ref="N"`
 * stamps then travel into each fragment through `cloneNode`.
 *
 * The per-element override sheet emits the original rule's selector
 * with source-dependent parts removed and `[data-ref="N"]` attached to
 * the matched subject, so the source-tree value re-applies on the clone.
 * Pairs with `emitNeutralizationCss`, which prevents clone-local selector
 * matches from leaking through.
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
	const parent = sourceEl?.parentElement ?? sourceEl?.parentNode;
	if (!parent?.children) return null;
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
	let hasStructural = false;
	let replayStart = 0;
	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i];
		const extracted = extractCompoundNth(tok.compound);
		if (!extracted) return null;
		if (extracted.nthParts.length > 0) hasStructural = true;
		if (tok.combinator === "+" || tok.combinator === "~") replayStart = i + 1;
		compounds.push({
			strippedCompound: extracted.strippedCompound,
			combinator: tok.combinator,
			nthParts: extracted.nthParts,
		});
	}
	const hasSibling = replayStart > 0;
	if (!hasStructural && !hasSibling) return null;
	return { compounds, hasSibling, replayStart };
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

// Rebuild the clone-stable suffix of a selector, with `[data-ref="N"]`
// appended to its subject. Sibling-dependent prefixes are omitted because
// the source sibling may be in a different fragmentainer.
function buildRefSelector(compounds, ref, start = 0) {
	let out = "";
	const last = compounds.length - 1;
	for (let i = start; i <= last; i++) {
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
	#refByDescriptorSet = new Map();
	#sourceSiblingMatches = new WeakMap();
	#sourceElements = new WeakSet();
	#sheet = null;

	resetRules() {
		this.#descriptors = [];
		this.#nextRefId = 0;
		this.#refByDescriptorSet.clear();
		this.#sourceSiblingMatches = new WeakMap();
		this.#sourceElements = new WeakSet();
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
				hasSibling: compiled.hasSibling,
				replayStart: compiled.replayStart,
				declarations: declarationsAsImportant(rule.style),
				wrappers: [...context.wrappers],
				refs: new Set(),
			});
		}
	}

	prepareContent(contentRoot) {
		const siblingDescriptors = [];
		for (let d = 0; d < this.#descriptors.length; d++) {
			if (this.#descriptors[d].hasSibling) siblingDescriptors.push(d);
		}
		if (siblingDescriptors.length === 0) return;

		for (const el of contentRoot.querySelectorAll("*")) {
			this.#sourceElements.add(el);
			this.#sourceSiblingMatches.delete(el);
			let matched = null;
			for (const d of siblingDescriptors) {
				if (!matchesCompoundChain(el, this.#descriptors[d].compounds)) continue;
				if (!matched) matched = new Set();
				matched.add(d);
			}
			if (matched) this.#sourceSiblingMatches.set(el, matched);
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
		// Elements that match the same set of descriptors share one ref (and thus
		// one selector clause). The map persists while segments are activated so
		// an identical source match keeps the same stamp throughout the flow.
		for (const el of contentRoot.querySelectorAll("*")) {
			let key = "";
			const matched = [];
			for (let d = 0; d < this.#descriptors.length; d++) {
				const desc = this.#descriptors[d];
				const isMatch =
					desc.hasSibling && this.#sourceElements.has(el)
						? (this.#sourceSiblingMatches.get(el)?.has(d) ?? false)
						: matchesCompoundChain(el, desc.compounds);
				if (isMatch) {
					matched.push(d);
					key += `${d},`;
				}
			}
			if (matched.length === 0) {
				if (el.hasAttribute("data-ref")) el.removeAttribute("data-ref");
				continue;
			}
			let ref = this.#refByDescriptorSet.get(key);
			if (ref === undefined) {
				ref = String(this.#nextRefId++);
				this.#refByDescriptorSet.set(key, ref);
				for (const d of matched) this.#descriptors[d].refs.add(ref);
			}
			el.setAttribute("data-ref", ref);
		}
		this.#sheet = this.#buildSheet();
	}

	#buildSheet() {
		const ruleTexts = [];
		for (const desc of this.#descriptors) {
			if (desc.refs.size === 0) continue;
			const sel = [...desc.refs]
				.map((r) => buildRefSelector(desc.compounds, r, desc.replayStart))
				.join(", ");
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
