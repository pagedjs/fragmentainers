import { LayoutHandler } from "./handler.js";
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

const MEASURE_SLOT_SELECTOR = ":host(content-measure) > slot";
const MEASURE_HOST_SELECTOR = ":host(content-measure)";

/**
 * BodyRewriter — rewrites `body` and `html` selectors for the engine's
 * two rendering contexts:
 *
 * - `<content-measure>`'s shadow DOM (off-screen measurement). The
 *   `<slot>` stands in for body; `:host` stands in for html.
 * - `<fragment-container>` light-DOM children (visible output). The
 *   host is the body stand-in. Rules emit as `:scope { ... }` and the
 *   composite scoped sheet's `@scope (fragment-container)` wrap binds
 *   `:scope` to the host.
 *
 * Both forms are emitted on every match; each is harmless in the other
 * context. Visible-output backgrounds paint the host directly, so the
 * measurer-side background rule is dropped.
 *
 * Only runs for page-based flows.
 */
export class BodyRewriter extends LayoutHandler {
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
				const measureSlot = buildRule(
					MEASURE_SLOT_SELECTOR,
					rule.style,
					(p) => !BACKGROUND_PROPS.has(p),
				);
				if (measureSlot) rules.push(wrap(measureSlot, wrappers));

				const scopeAll = buildRule(":scope", rule.style);
				if (scopeAll) rules.push(wrap(scopeAll, wrappers));
			}
			if (matchesHtml && !matchesBody) {
				const measureHost = buildRule(MEASURE_HOST_SELECTOR, rule.style);
				if (measureHost) rules.push(wrap(measureHost, wrappers));

				const scopeAll = buildRule(":scope", rule.style);
				if (scopeAll) rules.push(wrap(scopeAll, wrappers));
			}
		}
	}
}
