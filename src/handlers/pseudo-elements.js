/**
 * Materialize ::before and ::after pseudo elements as real DOM elements.
 *
 * Implemented as a LayoutHandler so pseudo handling participates in the
 * standard handler pipeline:
 *   - matchRule/appendRules rewrites ::before/::after rules to target
 *     synthetic <frag-pseudo> elements (companion + relocation rules),
 *     plus two global suppression rules that hide the original pseudos.
 *   - beforeMeasurement walks the injected DOM and materializes
 *     <frag-pseudo> children under elements whose pseudos resolve.
 *
 * Follows Chromium LayoutNG's approach where pseudo elements become layout
 * objects in the layout tree, rather than being invisible to the engine.
 *
 * Handlers can opt out via claimPseudo() (skip materialization) or
 * claimPseudoRule() (skip rule rewriting).
 */

import { LayoutHandler } from "./handler.js";
import { handlers } from "./registry.js";

const PSEUDO_TAG = "FRAG-PSEUDO";

/**
 * Parse a CSS `content` property value into its constituent parts.
 * Returns { isStringOnly, text } where isStringOnly is true when the
 * value is composed entirely of quoted strings (no counter/attr/url).
 *
 * @param {string} raw — value from getComputedStyle or CSSStyleRule
 * @returns {{ isStringOnly: boolean, text: string }}
 */
export function parseContentValue(raw) {
	if (!raw || raw === "none" || raw === "normal" || raw === '""') {
		return { isStringOnly: false, text: "" };
	}

	const parts = [];
	let remaining = raw.trim();
	let allStrings = true;

	while (remaining.length > 0) {
		const dq = remaining.match(/^"((?:[^"\\]|\\.)*)"/);
		if (dq) {
			parts.push(dq[1].replace(/\\(.)/g, "$1"));
			remaining = remaining.slice(dq[0].length).trim();
			continue;
		}
		const sq = remaining.match(/^'((?:[^'\\]|\\.)*)'/);
		if (sq) {
			parts.push(sq[1].replace(/\\(.)/g, "$1"));
			remaining = remaining.slice(sq[0].length).trim();
			continue;
		}

		allStrings = false;
		break;
	}

	return {
		isStringOnly: allStrings && parts.length > 0,
		text: parts.join(""),
	};
}

/**
 * Check whether an element is a materialized pseudo element.
 * @param {Element} element
 * @returns {boolean}
 */
export function isPseudoElement(element) {
	return element.tagName === PSEUDO_TAG;
}

function extractPseudo(selector) {
	const match = selector.match(/::(before|after)\s*$/);
	return match ? match[1] : null;
}

function wrapRule(ruleText, wrappers) {
	let css = ruleText;
	for (let i = wrappers.length - 1; i >= 0; i--) {
		css = `${wrappers[i]} { ${css} }`;
	}
	return css;
}

export class PseudoElements extends LayoutHandler {
	#rules = [];
	#hasPseudoRules = false;

	resetRules() {
		this.#rules = [];
		this.#hasPseudoRules = false;
	}

	matchRule(rule, context) {
		if (!/::(before|after)/.test(rule.selectorText)) return;

		const selectors = rule.selectorText.split(",").map((s) => s.trim());
		const styleSelectors = [];
		const relocateSelectors = [];

		const content = rule.style.getPropertyValue("content").trim();
		const hasContent = content.length > 0;
		const contentIsStringOnly = hasContent && parseContentValue(content).isStringOnly;

		for (const sel of selectors) {
			const pseudo = extractPseudo(sel);
			if (!pseudo) continue;

			if (handlers.claimPseudoRule(rule, pseudo)) continue;

			const base = sel.replace(/::(before|after)\s*$/, "").trim();
			const fragSel = `${base} > frag-pseudo[data-pseudo="${pseudo}"]`;

			styleSelectors.push(fragSel);

			if (hasContent && !contentIsStringOnly) {
				relocateSelectors.push(`${fragSel}::${pseudo}`);
			}
		}

		if (styleSelectors.length === 0) return;

		this.#hasPseudoRules = true;

		const styleDecls = [];
		for (let i = 0; i < rule.style.length; i++) {
			const prop = rule.style[i];
			if (prop === "content") continue;
			const val = rule.style.getPropertyValue(prop);
			const priority = rule.style.getPropertyPriority(prop);
			styleDecls.push(`${prop}: ${val}${priority ? " !" + priority : ""}`);
		}
		if (styleDecls.length > 0) {
			this.#rules.push(
				wrapRule(
					`${styleSelectors.join(", ")} { ${styleDecls.join("; ")}; }`,
					context.wrappers,
				),
			);
		}

		if (relocateSelectors.length > 0) {
			this.#rules.push(
				wrapRule(
					`${relocateSelectors.join(", ")} { content: ${content}; }`,
					context.wrappers,
				),
			);
		}
	}

	appendRules(rules) {
		if (!this.#hasPseudoRules) return;
		for (const rule of this.#rules) {
			rules.push(rule);
		}
		// Global suppression rules. These use data-frag-resolved-*
		// attribute selectors that only match after beforeMeasurement
		// sets the attributes, so they're safe to include from the start.
		rules.push("[data-frag-resolved-before]::before { content: none !important; }");
		rules.push("[data-frag-resolved-after]::after { content: none !important; }");
	}

	beforeMeasurement(contentRoot) {
		const elements = contentRoot.querySelectorAll("*");
		for (const el of elements) {
			if (el.tagName === PSEUDO_TAG) continue;
			this.#materializePseudo(el, "before");
			this.#materializePseudo(el, "after");
		}
	}

	#materializePseudo(el, which) {
		const pseudoStyle = getComputedStyle(el, "::" + which);
		const content = pseudoStyle.content;

		if (!content || content === "none" || content === "normal") return;

		const candidate = which === "before" ? el.firstElementChild : el.lastElementChild;
		if (candidate?.tagName === PSEUDO_TAG && candidate.dataset.pseudo === which) return;

		if (handlers.claimPseudo(el, which, content)) return;

		const synthetic = document.createElement("frag-pseudo");
		synthetic.setAttribute("role", "none");
		synthetic.dataset.pseudo = which;

		const parsed = parseContentValue(content);

		if (parsed.isStringOnly) {
			synthetic.textContent = parsed.text;
			const display = pseudoStyle.display;
			if (display && display !== "inline") {
				synthetic.style.display = display;
			}
		} else {
			// Counter/attr/mixed — relocation strategy. The appended rule
			// sets content on this element's own ::before/::after. Match
			// the original pseudo's display so padding/sizing behaves
			// identically (inline padding doesn't affect line height,
			// inline-block does).
			const display = pseudoStyle.display;
			if (display === "block" || display === "flex" || display === "grid") {
				synthetic.style.display = display;
			} else if (display === "inline-block") {
				synthetic.style.display = "inline-block";
			}
		}

		if (which === "before") {
			el.insertBefore(synthetic, el.firstChild);
		} else {
			el.appendChild(synthetic);
		}

		el.setAttribute(`data-frag-resolved-${which}`, "");
	}
}
