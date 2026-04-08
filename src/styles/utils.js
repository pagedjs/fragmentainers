/**
 * Build a CSS rule string from a selector and a style declaration.
 *
 * @param {string} selector
 * @param {CSSStyleDeclaration} style
 * @param {function} [filter] — optional predicate on property name
 * @returns {string|null} rule text, or null if no properties pass the filter
 */
export function buildRule(selector, style, filter) {
	const parts = [];
	for (let i = 0; i < style.length; i++) {
		const prop = style[i];
		if (filter && !filter(prop)) continue;
		const pri = style.getPropertyPriority(prop);
		parts.push(`${prop}: ${style.getPropertyValue(prop)}${pri ? " !important" : ""}`);
	}
	if (!parts.length) return null;
	return `${selector} { ${parts.join("; ")}; }`;
}
