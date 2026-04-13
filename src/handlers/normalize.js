import { LayoutHandler } from "./handler.js";
import { getLineHeight, setTargetDevicePixelRatio } from "../measurement/line-box.js";
import { parseNumeric } from "../styles/css-values.js";

/**
 * EmulatePrintPixelRatio — generates a line-height normalization
 * stylesheet for fragment-container rendering.
 *
 * Browsers round `line-height: normal` to device pixels (integers at
 * DPR 1, half-pixels at DPR 2). This handler builds a `@media screen`
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

const BODY_HTML_RE = /^(body|html)\b/i;

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
 * Handles px, em, rem, %, named sizes, calc expressions, and any
 * absolute unit convertible to px via CSS Typed OM.
 */
function resolveFontSize(value, defaultSize) {
	if (!value) return null;
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

	const v = parseNumeric(value);
	if (!v) return null;
	if (v.unit === "em" || v.unit === "rem") return v.value * defaultSize;
	if (v.unit === "percent") return (v.value / 100) * defaultSize;
	try {
		return v.to("px").value;
	} catch {
		return null;
	}
}

class EmulatePrintPixelRatio extends LayoutHandler {
	#collectedRules = [];
	#defaultFont = { family: "serif", weight: "400", style: "normal", size: 16 };
	#normSheet = null;
	#enabled = false;

	init({ emulatePrintPixelRatio = true, isPageBased = false } = {}) {
		// Only relevant for print-style (page-based) flows. On-screen
		// column/region fragmentation uses native browser rendering.
		// Only Blink-based browsers need line-height normalization.
		// All Blink browsers (Chrome, Edge, Opera, etc.) include "Chrome/" in the UA.
		this.#enabled =
			emulatePrintPixelRatio &&
			isPageBased &&
			typeof navigator !== "undefined" &&
			/\bChrome\//.test(navigator.userAgent);
	}

	resetRules() {
		this.#collectedRules = [];
		this.#defaultFont = { family: "serif", weight: "400", style: "normal", size: 16 };
		this.#normSheet = null;
	}

	matchRule(rule, context) {
		if (!this.#enabled) return;

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
		if (!this.#enabled) return;

		// At DPR 1 the browser's native rounding matches the layout target,
		// so the normalization sheet would be a no-op.
		if (devicePixelRatio === 1) return;

		// Set DPR 1 for the entire layout flow — getLineHeight() will
		// return floored values matching browser DPR 1 behavior.
		setTargetDevicePixelRatio(1);

		const rules = [];
		const seen = new Set();

		// Catch-all: the default font's ratio on the slot covers all
		// elements that inherit line-height: normal without explicit
		// font-related CSS rules.
		const defaultEl = contentRoot.querySelector("*");
		if (defaultEl) {
			const cs = getComputedStyle(defaultEl);
			if (cs.lineHeight === "normal") {
				const flooredLh = getLineHeight(defaultEl);
				const fontSize = parseFloat(cs.fontSize) || this.#defaultFont.size;
				const ratio = flooredLh / fontSize;
				rules.push(`slot { line-height: ${ratio}; }`);
			}
		}

		// Per-selector rules for elements with explicit font properties
		// that may differ from the default (e.g. headings with sans-serif).
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

			// DPR-1 floored value (what the engine uses for layout)
			const flooredLh = getLineHeight(el);
			const fontSize = parseFloat(cs.fontSize) || 16;
			// Unitless ratio: fontSize * ratio ≈ flooredLh
			const ratio = flooredLh / fontSize;

			let rule = `${wrapInWhere(selector)} { line-height: ${ratio}; }`;

			// Wrap in @media/@supports if the original rule was nested
			for (let i = wrappers.length - 1; i >= 0; i--) {
				rule = `${wrappers[i]} { ${rule} }`;
			}
			rules.push(rule);
		}



		if (rules.length === 0) return;

		const cssText = `@media screen {\n${rules.join("\n")}\n}`;
		this.#normSheet = new CSSStyleSheet();
		this.#normSheet.replaceSync(cssText);
	}

	getAdoptedSheets() {
		if (!this.#normSheet) return [];
		return [this.#normSheet];
	}
}

export { EmulatePrintPixelRatio };
