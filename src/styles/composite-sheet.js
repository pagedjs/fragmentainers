import { OVERRIDES_TEXT } from "./overrides.js";
import { UA_DEFAULTS, UA_DEFAULTS_HOST_TEXT } from "./ua-defaults.js";
import { emitNeutralizationCss } from "./neutralize-structural-pseudos.js";

function sheetText(sheet) {
	if (!sheet) return "";
	try {
		return [...sheet.cssRules].map((r) => r.cssText).join("\n");
	} catch {
		return "";
	}
}

/**
 * Build the document-level scoped stylesheet for a FragmentedFlow.
 *
 * The original author sheets in `document.styleSheets` already cascade
 * to fragment-container content. The composite layers on top, scoped via
 * `@scope (fragment-container) { ... }`:
 *
 *   `@layer { UA defaults }`             — lowest priority
 *   body-rewriter rules                  — unlayered, normal
 *   neutralize structural-pseudo rules   — unlayered, !important
 *   StyleResolver per-element overrides  — unlayered, !important
 *   OVERRIDES                            — unlayered, !important, last
 *
 * Source order within `!important` rules decides cascade tiebreaks; OVERRIDES
 * sits last so split-edge neutralization wins over StyleResolver replays.
 *
 * @param {{ sheets: CSSStyleSheet[] }} contentStyles
 * @param {CSSStyleSheet[]} handlerSheets — per-flow sheets from
 *   handlers.getAdoptedSheets() (StyleResolver, EmulatePrintPixelRatio)
 * @param {CSSStyleSheet|null} injectedSheet — handler-rule sheet appended
 *   by registry.processRules(); included verbatim, not neutralized
 * @returns {CSSStyleSheet}
 */
export function buildCompositeSheet(contentStyles, handlerSheets, injectedSheet) {
	const authorSheets = (contentStyles?.sheets ?? []).filter(
		(s) => s !== UA_DEFAULTS && s !== injectedSheet,
	);

	const parts = [`@layer {\n${UA_DEFAULTS_HOST_TEXT}\n}`];

	const injectedText = sheetText(injectedSheet);
	if (injectedText) parts.push(injectedText);

	const neutralizeText = emitNeutralizationCss(authorSheets);
	if (neutralizeText) parts.push(neutralizeText);

	for (const sheet of handlerSheets ?? []) {
		const text = sheetText(sheet);
		if (text) parts.push(text);
	}

	parts.push(OVERRIDES_TEXT);

	const sheet = new CSSStyleSheet();
	sheet.replaceSync(`@scope (fragment-container) {\n${parts.join("\n")}\n}`);
	return sheet;
}
