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
 * Evaluate a stack of grouping-rule preambles (from walkRules' `wrappers`)
 * against the live document so a rule nested in a non-matching group is not
 * treated as applying. @media uses window.matchMedia, but `print` queries are
 * honored regardless: the engine produces paginated (print-like) output while
 * rendering on screen, so print-targeted rules must apply even though
 * matchMedia evaluates the screen context. @supports uses CSS.supports;
 * @layer is always active (layers gate priority, not matching); @container is
 * excluded (it cannot be resolved off-document, and measure-time resolution
 * must not inject an authoritative break a never-satisfied query would not
 * produce). Returns false if any condition in the stack fails.
 *
 * @param {string[]} wrappers - grouping-rule preambles, outermost to innermost
 * @returns {boolean}
 */
export function wrappersActive(wrappers) {
	for (const w of wrappers) {
		const pre = w.trim();
		if (pre.startsWith("@media")) {
			const cond = pre.slice("@media".length).trim();
			// Honor print-targeted media: the output is paginated, so a
			// `@media print` rule applies even though we render on screen.
			if (!cond || /\bprint\b/.test(cond)) continue;
			try {
				if (!window.matchMedia(cond).matches) return false;
			} catch {
				/* unparseable media query — be permissive */
			}
		} else if (pre.startsWith("@supports")) {
			const cond = pre.slice("@supports".length).trim();
			try {
				if (cond && !window.CSS.supports(cond)) return false;
			} catch {
				return false;
			}
		} else if (pre.startsWith("@container")) {
			// Container queries cannot be evaluated off-document at measure time.
			return false;
		}
		// @layer and other grouping rules: active.
	}
	return true;
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
