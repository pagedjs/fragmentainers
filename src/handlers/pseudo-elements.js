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
 * Features that need native browser pseudo handling can mark elements via
 * markNativePseudo(), which makes beforeMeasurement skip materialization
 * for that element/pseudo pair.
 */

import { LayoutHandler } from "./handler.js";
import { hasNativePseudo } from "../markers.js";
import { splitSelectorList } from "../styles/selector-utils.js";

const PSEUDO_TAG = "FRAG-PSEUDO";
const CONTENT_MODE_PROPERTY = "--frag-pseudo-content-mode";
const CONTENT_MODE_LITERAL = "literal";
const CONTENT_MODE_RELOCATED = "relocated";

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

const STRING_TOKEN = /^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'/;
const ATTR_TOKEN = /^attr\(\s*[^()]*\)/i;

/**
 * Check whether a `content` value renders as fixed text.
 *
 * Strings qualify, and so does `attr()`: it resolves against the element
 * whose pseudo is being styled, so a relocated rule would read it off the
 * <frag-pseudo> rather than the source element and always come back empty.
 * Computed style substitutes it before materialization, so taking it as text
 * is both the only correct reading and the one already available.
 *
 * `var()` and `counter()` are excluded on purpose — they have to keep
 * re-resolving as custom properties and counters change.
 *
 * @param {string} raw — value from a CSSStyleRule
 * @returns {boolean}
 */
export function contentRendersAsText(raw) {
	if (!raw || raw === "none" || raw === "normal") return false;

	let remaining = raw.trim();
	let parts = 0;
	while (remaining.length > 0) {
		const token = STRING_TOKEN.exec(remaining) ?? ATTR_TOKEN.exec(remaining);
		if (!token) return false;
		remaining = remaining.slice(token[0].length).trim();
		parts += 1;
	}

	return parts > 0;
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

		const selectors = splitSelectorList(rule.selectorText);
		const styleSelectors = [];
		const relocateSelectors = [];

		const content = rule.style.getPropertyValue("content").trim();
		const hasContent = content.length > 0;
		const contentIsStringOnly = hasContent && contentRendersAsText(content);
		const contentPriority = rule.style.getPropertyPriority("content");
		const contentPrioritySuffix = contentPriority ? ` !${contentPriority}` : "";

		for (const sel of selectors) {
			const pseudo = extractPseudo(sel);
			if (!pseudo) continue;

			const base = sel.replace(/::(before|after)\s*$/, "").trim();
			const fragSel = `${base} > frag-pseudo[data-pseudo="${pseudo}"]`;

			styleSelectors.push(fragSel);

			if (hasContent) {
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
		if (hasContent) {
			const mode = contentIsStringOnly ? CONTENT_MODE_LITERAL : CONTENT_MODE_RELOCATED;
			styleDecls.push(`${CONTENT_MODE_PROPERTY}: ${mode}${contentPrioritySuffix}`);
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
			const relocatedContent = contentIsStringOnly ? "none" : content;
			this.#rules.push(
				wrapRule(
					`${relocateSelectors.join(", ")} { content: ${relocatedContent}${contentPrioritySuffix}; }`,
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

		if (hasNativePseudo(el, which)) return;

		const synthetic = document.createElement("frag-pseudo");
		synthetic.setAttribute("role", "none");
		synthetic.dataset.pseudo = which;

		const parsed = parseContentValue(content);
		if (which === "before") {
			el.insertBefore(synthetic, el.firstChild);
		} else {
			el.appendChild(synthetic);
		}
		const contentMode = getComputedStyle(synthetic)
			.getPropertyValue(CONTENT_MODE_PROPERTY)
			.trim();
		const materializeAsText =
			contentMode === CONTENT_MODE_LITERAL ||
			(contentMode !== CONTENT_MODE_RELOCATED && parsed.isStringOnly);

		if (materializeAsText) {
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

		el.setAttribute(`data-frag-resolved-${which}`, "");
	}
}
