import { LayoutModule } from "./module.js";
import { buildRule } from "../styles/utils.js";

const BACKGROUND_PROPS = new Set([
	"background", "background-color", "background-image", "background-position",
	"background-size", "background-repeat", "background-attachment",
	"background-origin", "background-clip",
]);

function safeMatches(el, selector) {
	try {
		return el.matches(selector);
	} catch {
		return false;
	}
}

function wrap(ruleText, wrappers) {
	let css = ruleText;
	for (let i = wrappers.length - 1; i >= 0; i--) {
		css = `${wrappers[i]} { ${css} }`;
	}
	return css;
}

/**
 * BodyRewriter — rewrites `body` and `html` selectors as `slot` and
 * `:host` equivalents for shadow DOM rendering.
 *
 * In the shadow DOM used for measurement and fragment containers,
 * `body` and `html` selectors don't match. The `<slot>` stands in
 * for body and `:host` stands in for html. Background properties on
 * body propagate to the canvas, so they target `:host`.
 *
 * Only runs for page-based flows. On-screen column/region
 * fragmentation doesn't use shadow DOM slot/host substitution.
 */
export class BodyRewriter extends LayoutModule {
	#enabled = false;
	#matches = [];

	init({ isPageBased = false } = {}) {
		this.#enabled = isPageBased;
	}

	resetRules() {
		this.#matches = [];
	}

	matchRule(rule, context) {
		if (!this.#enabled) return;
		const matchesBody = safeMatches(document.body, rule.selectorText);
		const matchesHtml = safeMatches(document.documentElement, rule.selectorText);
		if (matchesBody || matchesHtml) {
			this.#matches.push({
				rule,
				matchesBody,
				matchesHtml,
				wrappers: [...context.wrappers],
			});
		}
	}

	appendRules(rules) {
		if (!this.#enabled) return;
		for (const { rule, matchesBody, matchesHtml, wrappers } of this.#matches) {
			if (matchesBody) {
				const slotRule = buildRule("slot", rule.style, (p) => !BACKGROUND_PROPS.has(p));
				const hostBgRule = buildRule(":host", rule.style, (p) => BACKGROUND_PROPS.has(p));
				if (slotRule) rules.push(wrap(slotRule, wrappers));
				if (hostBgRule) rules.push(wrap(hostBgRule, wrappers));
			}
			if (matchesHtml && !matchesBody) {
				rules.push(wrap(`:host { ${rule.style.cssText} }`, wrappers));
			}
		}
	}
}
