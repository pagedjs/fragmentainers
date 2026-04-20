const WHITESPACE_RE = /\s/;

export const STRUCTURAL_PSEUDO_RE =
	/:(nth-child|nth-of-type|nth-last-child|nth-last-of-type|first-child|last-child|first-of-type|last-of-type|only-child|only-of-type)\b(\([^)]*\))?/g;

/**
 * Split a selector list on top-level commas, honoring `()`/`[]`/string depth.
 *
 * @param {string} selectorText
 * @returns {string[]}
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
 *
 * @param {string} selector
 * @returns {{ compound: string, combinator: string|null }[]}
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

