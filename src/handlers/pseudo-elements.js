/**
 * Materialize ::before and ::after pseudo elements as real DOM elements.
 *
 * Implemented as a LayoutHandler so pseudo handling participates in the
 * standard handler pipeline:
 *   - matchRule/appendRules rewrites each ::before/::after rule into a
 *     companion style rule targeting a synthetic <frag-pseudo> child and a
 *     relocation rule setting content on that synthetic's own pseudo —
 *     `none` for string/attr content, the specified value otherwise — plus
 *     two global suppression rules that hide the original pseudos.
 *   - beforeMeasurement walks the injected DOM and materializes
 *     <frag-pseudo> children under elements whose pseudos resolve. The
 *     relocation rule's computed result on the synthetic decides which:
 *     `none` for text materialized into the DOM, anything else for content
 *     the browser keeps re-resolving on the synthetic's own pseudo.
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
import { contentRendersAsText, parseContentValue } from "../styles/css-values.js";
// Materialized pseudos are upgraded elements, so the class has to be
// registered before this handler creates the first one.
import "../components/frag-pseudo.js";

const PSEUDO_TAG = "FRAG-PSEUDO";

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
		// Reads, then writes, then the one read those writes make necessary.
		// Interleaving them per element costs a style recalc per element; in
		// passes the whole root costs two.
		const pending = [];
		for (const el of contentRoot.querySelectorAll("*")) {
			if (el.tagName === PSEUDO_TAG) continue;
			const before = pendingPseudo(el, "before");
			if (before) pending.push(before);
			const after = pendingPseudo(el, "after");
			if (after) pending.push(after);
		}
		if (pending.length === 0) return;

		for (const entry of pending) {
			const synthetic = document.createElement("frag-pseudo");
			synthetic.setAttribute("role", "none");
			synthetic.dataset.pseudo = entry.which;
			if (entry.which === "before") {
				entry.el.insertBefore(synthetic, entry.el.firstChild);
			} else {
				entry.el.appendChild(synthetic);
			}
			entry.synthetic = synthetic;
		}

		// The relocation rule cascades against the same declarations as the
		// source rule, so its computed result is the winning mode: `none`
		// means a string/attr rule won and the text belongs in the DOM.
		// An empty string still relocates — `var(--x, "")` fills in on a
		// later layout pass once the custom property resolves.
		for (const entry of pending) {
			const relocated = getComputedStyle(entry.synthetic, "::" + entry.which).content;
			entry.relocates = relocated !== "" && relocated !== "none" && relocated !== "normal";
		}

		for (const entry of pending) materializePseudo(entry);
	}
}

/**
 * What materializing `which` on `el` needs, read from computed style, or null
 * when the pseudo resolves to nothing, is already materialized, or is left
 * native. Reads only.
 *
 * @param {Element} el
 * @param {"before"|"after"} which
 * @returns {{ el: Element, which: string, text: string, display: string }|null}
 */
function pendingPseudo(el, which) {
	const pseudoStyle = getComputedStyle(el, "::" + which);
	const content = pseudoStyle.content;
	if (!content || content === "none" || content === "normal") return null;

	const candidate = which === "before" ? el.firstElementChild : el.lastElementChild;
	if (candidate?.tagName === PSEUDO_TAG && candidate.dataset.pseudo === which) return null;

	if (hasNativePseudo(el, which)) return null;

	return { el, which, text: parseContentValue(content).text, display: pseudoStyle.display };
}

/** Writes only: fill the inserted synthetic and mark its element resolved. */
function materializePseudo({ el, which, synthetic, text, display, relocates }) {
	if (!relocates) {
		synthetic.textContent = text;
		if (display && display !== "inline") {
			synthetic.style.display = display;
		}
	} else {
		// Match the original pseudo's display so padding/sizing behaves
		// identically (inline padding doesn't affect line height,
		// inline-block does).
		if (display === "block" || display === "flex" || display === "grid") {
			synthetic.style.display = display;
		} else if (display === "inline-block") {
			synthetic.style.display = "inline-block";
		}
	}

	el.setAttribute(`data-frag-resolved-${which}`, "");
}
