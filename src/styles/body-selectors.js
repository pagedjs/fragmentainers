/**
 * Body/html selector rewriting for shadow DOM fragmentation.
 *
 * When content is rendered inside shadow DOM containers, `body` and `html`
 * selectors don't match. The shadow DOM uses a `<slot>` element as the
 * body stand-in and `:host` as the html stand-in.
 *
 * This module builds an override CSSStyleSheet by testing each rule's
 * selector against the document's body and html elements via
 * Element.matches(). Rules that target body become `slot` rules;
 * rules that target html become `:host` rules. The override sheet is
 * appended after the original sheets so rewritten rules win by source order.
 *
 * Body background properties are special-cased: per CSS spec, background
 * on body propagates to the canvas, so they target :host (the
 * fragment-container) rather than slot.
 *
 * Follows the same non-mutating override pattern as
 * buildNthOverrideSheet in nth-selectors.js.
 */

import { buildRule } from "./utils.js";

const BACKGROUND_PROPS = new Set([
	"background", "background-color", "background-image", "background-position",
	"background-size", "background-repeat", "background-attachment",
	"background-origin", "background-clip",
]);

/**
 * Recursively collect override rules for body/html-targeting selectors
 * into a target CSSStyleSheet without mutating the source rules.
 *
 * Uses Element.matches() to test whether each rule's selector targets
 * the body or html element, avoiding fragile regex-based rewriting.
 *
 * @param {CSSRuleList} ruleList — source rules to scan
 * @param {CSSStyleSheet} target — where to insert overrides
 * @param {Element} bodyEl — the document body element to test against
 * @param {Element} htmlEl — the document html element to test against
 */
function collectBodyOverrides(ruleList, target, bodyEl, htmlEl) {
	for (const rule of ruleList) {
		if (rule.selectorText !== undefined) {
			const matchesBody = safeMatches(bodyEl, rule.selectorText);
			const matchesHtml = safeMatches(htmlEl, rule.selectorText);
			if (matchesBody) {
				const slotRule = buildRule("slot", rule.style, (p) => !BACKGROUND_PROPS.has(p));
				const hostBgRule = buildRule(":host", rule.style, (p) => BACKGROUND_PROPS.has(p));
				if (slotRule) target.insertRule(slotRule, target.cssRules.length);
				if (hostBgRule) target.insertRule(hostBgRule, target.cssRules.length);
			}
			if (matchesHtml && !matchesBody) {
				target.insertRule(`:host { ${rule.style.cssText} }`, target.cssRules.length);
			}
		} else if (rule.cssRules) {
			// Grouping rule — reconstruct wrapper, recurse, keep only if non-empty
			const wrapper = new CSSStyleSheet();
			collectBodyOverrides(rule.cssRules, wrapper, bodyEl, htmlEl);
			if (wrapper.cssRules.length > 0) {
				let innerCSS = "";
				for (const r of wrapper.cssRules) {
					innerCSS += r.cssText + "\n";
				}
				target.insertRule(
					`${rule.cssText.substring(0, rule.cssText.indexOf("{"))}{ ${innerCSS} }`,
					target.cssRules.length,
				);
			}
		}
	}
}

/**
 * Test Element.matches() without throwing on invalid or
 * unsupported selectors (e.g. pseudo-elements).
 *
 * @param {Element} el
 * @param {string} selector
 * @returns {boolean}
 */
function safeMatches(el, selector) {
	try {
		return el.matches(selector);
	} catch {
		return false;
	}
}

/**
 * Build an override CSSStyleSheet containing `slot` / `:host`
 * equivalents of rules that target the document's body / html elements.
 * The input sheets are NOT mutated.
 *
 * @param {CSSStyleSheet[]} sheets — source sheets to scan
 * @param {Element} bodyEl — the document body element
 * @param {Element} htmlEl — the document html element
 * @returns {{ sheet: CSSStyleSheet }}
 */
export function buildBodyOverrideSheet(sheets, bodyEl, htmlEl) {
	const overrideSheet = new CSSStyleSheet();
	for (const sheet of sheets) {
		collectBodyOverrides(sheet.cssRules, overrideSheet, bodyEl, htmlEl);
	}
	return { sheet: overrideSheet };
}
