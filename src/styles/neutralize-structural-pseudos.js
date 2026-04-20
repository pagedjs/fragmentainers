import { walkSheets } from "./walk-rules.js";
import { splitSelectorList, STRUCTURAL_PSEUDO_RE } from "./selector-utils.js";

function selectorHasStructural(selector) {
	STRUCTURAL_PSEUDO_RE.lastIndex = 0;
	return STRUCTURAL_PSEUDO_RE.test(selector);
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
 * For each author rule whose selector list contains compound selectors
 * with structural pseudos (`:nth-child`, `:first-child`, etc.), emit a
 * neutralizing override that unsets the same properties on the same
 * structural-pseudo selectors. Compound selectors without structural
 * pseudos are left alone (they cascade normally from the original sheet).
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
		const structuralSelectors = splitSelectorList(rule.selectorText).filter(selectorHasStructural);
		if (structuralSelectors.length === 0) return;
		const declarations = unsetDeclarations(rule.style);
		if (!declarations) return;
		const ruleText = `${structuralSelectors.join(", ")} { ${declarations} }`;
		parts.push(wrap(ruleText, wrappers));
	});
	return parts.join("\n");
}
