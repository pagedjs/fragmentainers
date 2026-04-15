import { walkRules } from "./walk-rules.js";

const STRUCTURAL_PSEUDO_RE =
	/:(nth-child|nth-of-type|nth-last-child|nth-last-of-type|first-child|last-child|first-of-type|last-of-type|only-child|only-of-type)\b/;

const cache = new WeakMap();

/**
 * Strip structural-pseudo rules and wrap survivors in an anonymous
 * `@layer { … }` so StyleResolver's named `@layer nth` wins by layer
 * order. Cached per input via WeakMap.
 *
 * @param {CSSStyleSheet[]} sheets
 * @returns {CSSStyleSheet[]}
 */
export function prepareAuthorSheetsForFragment(sheets) {
	return sheets.map(prepareOne);
}

function prepareOne(input) {
	const cached = cache.get(input);
	if (cached) return cached;

	let rules;
	try {
		rules = input.cssRules;
	} catch {
		cache.set(input, input);
		return input;
	}

	const parts = [];
	walkRules(rules, (rule, wrappers) => {
		if (rule.selectorText && STRUCTURAL_PSEUDO_RE.test(rule.selectorText)) return;
		let ruleText = rule.cssText;
		for (let i = wrappers.length - 1; i >= 0; i--) {
			ruleText = `${wrappers[i]} { ${ruleText} }`;
		}
		parts.push(ruleText);
	});

	const out = new CSSStyleSheet();
	try {
		out.replaceSync(`@layer {\n${parts.join("\n")}\n}`);
	} catch {
		/* fall through — empty sheet */
	}
	cache.set(input, out);
	return out;
}
