import { walkSheets } from "./walk-rules.js";
import {
	splitSelectorList,
	tokenizeSelector,
	STRUCTURAL_PSEUDO_RE,
} from "./selector-utils.js";

function selectorNeedsReplay(selector) {
	STRUCTURAL_PSEUDO_RE.lastIndex = 0;
	if (STRUCTURAL_PSEUDO_RE.test(selector)) return true;
	return tokenizeSelector(selector).some(
		(token) => token.combinator === "+" || token.combinator === "~",
	);
}

function unsetDeclarations(style) {
	const parts = [];
	for (let i = 0; i < style.length; i++) {
		parts.push(`${style[i]}: unset !important;`);
	}
	return parts.join(" ");
}

function wrap(ruleText, wrappers) {
	let css = ruleText;
	for (let i = wrappers.length - 1; i >= 0; i--) {
		css = `${wrappers[i]} { ${css} }`;
	}
	return css;
}

/**
 * For each author rule whose selector depends on source-tree positions,
 * emit a neutralizing override that unsets the same properties on clones.
 * This covers structural pseudos and sibling combinators, both of which can
 * match differently after content is split across fragmentainers.
 *
 * Per-property `unset` (not `all: unset`) so unrelated properties from
 * other rules survive. `!important` so the override beats any author
 * `!important` on the original.
 *
 * @param {CSSStyleSheet[]} sheets
 * @returns {string} CSS text to splice into the composite scoped sheet
 */
export function emitNeutralizationCss(sheets) {
	const parts = [];
	walkSheets(sheets, (rule, wrappers) => {
		if (!rule.selectorText) return;
		const replaySelectors = splitSelectorList(rule.selectorText).filter(selectorNeedsReplay);
		if (replaySelectors.length === 0) return;
		const declarations = unsetDeclarations(rule.style);
		if (!declarations) return;
		const ruleText = `${replaySelectors.join(", ")} { ${declarations} }`;
		parts.push(wrap(ruleText, wrappers));
	});
	return parts.join("\n");
}
