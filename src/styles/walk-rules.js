/**
 * Recursively walk CSS rules, descending into grouping rules
 * (@media, @supports, @layer, etc.) and calling visitor(rule, wrappers)
 * for every leaf rule. `wrappers` carries the grouping rule preambles
 * from outermost to innermost.
 */
export function walkRules(ruleList, visitor, wrappers = []) {
	for (const rule of ruleList) {
		// Grouping rules (@media, @supports, @layer, @container) have
		// nested cssRules but no selectorText. Recurse into them.
		// Rules with selectorText (CSSStyleRule, CSSPageRule) are leaves,
		// as are rules without cssRules (CSSFontFaceRule, etc.).
		if (rule.selectorText === undefined && rule.cssRules) {
			const preamble = rule.cssText.substring(0, rule.cssText.indexOf("{")).trim();
			walkRules(rule.cssRules, visitor, [...wrappers, preamble]);
		} else {
			visitor(rule, wrappers);
		}
	}
}

/**
 * Walk CSS rules across multiple stylesheets, silently skipping
 * cross-origin sheets whose cssRules access throws.
 */
export function walkSheets(sheets, visitor) {
	for (const sheet of sheets) {
		let rules;
		try {
			rules = sheet.cssRules;
		} catch {
			continue;
		}
		walkRules(rules, visitor);
	}
}

/**
 * Insert a CSS rule into a target sheet, wrapped in grouping rule
 * contexts. Builds the nested CSS string inside-out.
 */
export function insertWrappedRule(target, ruleText, wrappers) {
	let css = ruleText;
	for (let i = wrappers.length - 1; i >= 0; i--) {
		css = `${wrappers[i]} { ${css} }`;
	}
	try {
		target.insertRule(css, target.cssRules.length);
	} catch {
		/* invalid rule */
	}
}
