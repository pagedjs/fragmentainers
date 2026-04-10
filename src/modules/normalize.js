import { LayoutModule } from "./module.js";
import { getSharedFontMetrics } from "../dom/font-metrics.js";

/**
 * NormalizeLayoutModule — generates a line-height normalization
 * stylesheet for fragment-container rendering.
 *
 * Browsers round `line-height: normal` to device pixels (integers at
 * DPR 1, half-pixels at DPR 2). This module builds a `@media screen`
 * stylesheet that sets explicit line-height values matching the target
 * DPR, ensuring rendered fragment-containers match layout predictions.
 *
 * The sheet is NOT adopted on the measurer (avoids reflow). It is
 * adopted on each fragment-container via getAdoptedSheets().
 *
 * Lifecycle:
 *   matchRule()              — collect selectors with font properties
 *   afterMeasurementSetup()  — probe live DOM, build stylesheet
 *   getAdoptedSheets()       — provide sheet for fragment-containers
 */

const FONT_PROPS = new Set(["font-family", "font-weight", "font-style", "font-size"]);
const BODY_HTML_RE = /^(body|html)\b/i;

/**
 * Default UA font-size multipliers for heading elements.
 * Relative to the inherited (body) font-size.
 */
const UA_HEADING_SIZES = {
	h1: 2,
	h2: 1.5,
	h3: 1.17,
	h4: 1,
	h5: 0.83,
	h6: 0.67,
};

/**
 * Wrap each comma-separated selector part in :where() for zero specificity.
 */
function wrapInWhere(selectorText) {
	return selectorText
		.split(",")
		.map((s) => `:where(${s.trim()})`)
		.join(", ");
}

/**
 * Resolve a CSS font-size value to pixels.
 * Handles px, em, rem, %, and named sizes.
 */
function resolveFontSize(value, defaultSize) {
	if (!value) return null;
	if (value.endsWith("px")) return parseFloat(value);
	if (value.endsWith("em")) return parseFloat(value) * defaultSize;
	if (value.endsWith("rem")) return parseFloat(value) * defaultSize;
	if (value.endsWith("%")) return (parseFloat(value) / 100) * defaultSize;
	// Named sizes — approximate px equivalents at 16px base
	const named = {
		"xx-small": 9,
		"x-small": 10,
		small: 13,
		medium: 16,
		large: 18,
		"x-large": 24,
		"xx-large": 32,
		smaller: defaultSize * 0.83,
		larger: defaultSize * 1.2,
	};
	if (named[value] !== undefined) return named[value];
	return null;
}

export class NormalizeLayoutModule extends LayoutModule {
	#collectedRules = [];
	#defaultFont = { family: "serif", weight: "400", style: "normal", size: 16 };
	#normSheet = null;

	resetRules() {
		this.#collectedRules = [];
		this.#defaultFont = { family: "serif", weight: "400", style: "normal", size: 16 };
		this.#normSheet = null;
	}

	matchRule(rule, context) {
		if (!this.options.normalizeLineHeight) return;

		const s = rule.style;
		const hasFont =
			s.getPropertyValue("font-family") ||
			s.getPropertyValue("font-weight") ||
			s.getPropertyValue("font-style") ||
			s.getPropertyValue("font-size") ||
			s.getPropertyValue("font");

		if (!hasFont) return;

		// Skip rules that set an explicit line-height (non-normal)
		const lh = s.getPropertyValue("line-height").trim();
		if (lh && lh !== "normal") return;

		const selector = rule.selectorText;

		// Body/html rules update the default font (they don't exist in shadow DOM)
		if (BODY_HTML_RE.test(selector)) {
			if (s.fontFamily) this.#defaultFont.family = s.fontFamily;
			if (s.fontWeight) this.#defaultFont.weight = s.fontWeight;
			if (s.fontStyle) this.#defaultFont.style = s.fontStyle;
			if (s.fontSize) {
				const px = resolveFontSize(s.fontSize, this.#defaultFont.size);
				if (px) this.#defaultFont.size = px;
			}
			return;
		}

		this.#collectedRules.push({
			selector,
			wrappers: [...context.wrappers],
		});
	}

	afterMeasurementSetup(contentRoot) {
		if (!this.options.normalizeLineHeight) return;

		const fm = getSharedFontMetrics();
		const screenDpr = fm.dpr;
		// Build the normalization sheet at DPR 1 (floored integers)
		// for consistent PDF output.
		fm.dpr = 1;

		const rules = [];
		const seen = new Set();

		// Catch-all: default font
		const defaultLh = fm.computeNormalLineHeight(
			this.#defaultFont.family,
			this.#defaultFont.weight,
			this.#defaultFont.style,
			this.#defaultFont.size,
		);
		rules.push(`:where(*) { line-height: ${defaultLh}px; }`);

		// UA defaults for inline elements with different font properties
		const boldLh = fm.computeNormalLineHeight(
			this.#defaultFont.family,
			"700",
			this.#defaultFont.style,
			this.#defaultFont.size,
		);
		const italicLh = fm.computeNormalLineHeight(
			this.#defaultFont.family,
			this.#defaultFont.weight,
			"italic",
			this.#defaultFont.size,
		);
		rules.push(`:where(strong), :where(b) { line-height: ${boldLh}px; }`);
		rules.push(`:where(em), :where(i), :where(cite), :where(dfn) { line-height: ${italicLh}px; }`);

		// UA heading defaults
		for (const [tag, multiplier] of Object.entries(UA_HEADING_SIZES)) {
			const size = this.#defaultFont.size * multiplier;
			const lh = fm.computeNormalLineHeight(this.#defaultFont.family, "700", "normal", size);
			rules.push(`:where(${tag}) { line-height: ${lh}px; }`);
		}

		// Rules from collected CSS selectors — probe live DOM for computed fonts
		for (const { selector, wrappers } of this.#collectedRules) {
			if (seen.has(selector)) continue;
			seen.add(selector);

			let el;
			try {
				el = contentRoot.querySelector(selector);
			} catch {
				continue;
			}
			if (!el) continue;

			const cs = getComputedStyle(el);
			if (cs.lineHeight !== "normal") continue;

			const lh = fm.getNormalLineHeight(el);
			let rule = `${wrapInWhere(selector)} { line-height: ${lh}px; }`;

			// Wrap in @media/@supports if the original rule was nested
			for (let i = wrappers.length - 1; i >= 0; i--) {
				rule = `${wrappers[i]} { ${rule} }`;
			}
			rules.push(rule);
		}

		const cssText = `@media screen {\n${rules.join("\n")}\n}`;
		this.#normSheet = new CSSStyleSheet();
		this.#normSheet.replaceSync(cssText);
		fm.dpr = screenDpr;
	}

	getAdoptedSheets() {
		if (!this.#normSheet) return [];
		return [this.#normSheet];
	}
}

export const Normalize = new NormalizeLayoutModule();
