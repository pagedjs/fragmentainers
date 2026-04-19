import { OVERRIDES_TEXT } from "./overrides.js";
import { UA_DEFAULTS_HOST_TEXT } from "./ua-defaults.js";
import { prepareAuthorSheetsForFragment } from "./strip-structural-pseudos.js";

function sheetText(sheet) {
	try {
		return [...sheet.cssRules].map((r) => r.cssText).join("\n");
	} catch {
		return "";
	}
}

/**
 * Build the document-level scoped stylesheet for a FragmentedFlow.
 *
 * Concatenates UA defaults, the prepared author rules, per-flow handler
 * sheets, and OVERRIDES, wrapped in `@scope (fragment-container) { ... }`
 * so rules apply to fragment-container hosts and their slotted
 * descendants without leaking onto the rest of the page.
 *
 * UA defaults sit in their own anonymous `@layer` so author and handler
 * rules — declared in later layers — win the layer-priority tiebreak.
 * OVERRIDES stays unlayered (with `!important`) and wins regardless.
 *
 * @param {{ sheets: CSSStyleSheet[] }} contentStyles
 * @param {CSSStyleSheet[]} handlerSheets — per-flow sheets from
 *   handlers.getAdoptedSheets() not already in contentStyles.sheets
 * @returns {CSSStyleSheet}
 */
export function buildCompositeSheet(contentStyles, handlerSheets) {
	const parts = [`@layer {\n${UA_DEFAULTS_HOST_TEXT}\n}`];

	const prepared = prepareAuthorSheetsForFragment(contentStyles?.sheets ?? []);
	for (const sheet of prepared) {
		parts.push(sheetText(sheet));
	}

	for (const sheet of handlerSheets ?? []) {
		parts.push(sheetText(sheet));
	}

	parts.push(OVERRIDES_TEXT);

	const sheet = new CSSStyleSheet();
	sheet.replaceSync(`@scope (fragment-container) {\n${parts.join("\n")}\n}`);
	return sheet;
}
