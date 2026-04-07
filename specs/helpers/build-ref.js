/**
 * Reference HTML generation for spec tests.
 *
 * Builds a static HTML document from rendered page fragments,
 * used for visual regression snapshots.
 *
 * Split-element overrides (data-split-from / data-split-to) are
 * applied automatically by <page-container> via adoptedStyleSheets.
 */

export function saveRef(flow) {
	const pages = [];
	for (let i = 0; i < flow.fragmentainerCount; i++) {
		const { pageBoxSize, margins } = flow.fragments[i].constraints;
		const fragEl = document.querySelector(`[data-page-index="${i}"] fragment-container`);
		pages.push({ pageBoxSize, margins, html: fragEl.contentRoot.innerHTML });
	}
	document.documentElement.dataset.refHtml = buildRefHtml(pages);
}

/**
 * Collect CSS text from all document stylesheets, excluding @page rules.
 */
function collectStylesWithoutPageRules() {
	const lines = [];
	for (const sheet of document.styleSheets) {
		try {
			for (const rule of sheet.cssRules) {
				if (rule.type === CSSRule.PAGE_RULE) continue;
				lines.push(rule.cssText);
			}
		} catch {
			// Cross-origin sheets can't be read — skip
		}
	}
	return lines.join("\n  ");
}

/**
 * Find the universal @page rule and extract size/margin in original CSS units.
 * Returns null if no @page rule exists.
 */
function extractPageRuleCSS() {
	for (const sheet of document.styleSheets) {
		try {
			for (const rule of sheet.cssRules) {
				if (!(rule instanceof CSSPageRule)) continue;
				if (rule.selectorText && rule.selectorText.trim()) continue;

				const style = rule.style;
				const sizeStr = style.getPropertyValue("size").trim();

				let width = null;
				let height = null;
				if (sizeStr) {
					const parts = sizeStr.split(/\s+/);
					if (parts.length >= 2 && /^[\d.]+\w+$/.test(parts[0])) {
						width = parts[0];
						height = parts[1];
					} else if (parts.length === 1 && /^[\d.]+\w+$/.test(parts[0])) {
						width = parts[0];
						height = parts[0];
					}
				}

				const marginTop = style.getPropertyValue("margin-top").trim();
				const marginRight = style.getPropertyValue("margin-right").trim();
				const marginBottom = style.getPropertyValue("margin-bottom").trim();
				const marginLeft = style.getPropertyValue("margin-left").trim();
				const hasMargin = marginTop || marginRight || marginBottom || marginLeft;

				return {
					sizeStr,
					width,
					height,
					margin: hasMargin
						? `${marginTop || "0px"} ${marginRight || "0px"} ${marginBottom || "0px"} ${marginLeft || "0px"}`
						: null,
				};
			}
		} catch {
			// Cross-origin sheets can't be read — skip
		}
	}
	return null;
}

/**
 * Build a static reference HTML document from rendered pages.
 *
 * @param {{ pageBoxSize: { inlineSize: number, blockSize: number }, margins: object, html: string }[]} pages
 * @returns {string}
 */
export function buildRefHtml(pages) {
	const contentStyles = collectStylesWithoutPageRules();
	const cssInfo = extractPageRuleCSS();

	const { pageBoxSize, margins } = pages[0];
	const pageWidth = cssInfo?.width || `${pageBoxSize.inlineSize}px`;
	const pageHeight = cssInfo?.height || `${pageBoxSize.blockSize}px`;
	const pageMargin = cssInfo?.margin
		|| `${margins.top}px ${margins.right}px ${margins.bottom}px ${margins.left}px`;

	// Reconstruct the @page rule with the original size but margin: 0
	// (margins are handled by page-container padding via --page-margin).
	const sizeDecl = cssInfo?.sizeStr || `${pageBoxSize.inlineSize}px ${pageBoxSize.blockSize}px`;
	const atPageRule = `@page { size: ${sizeDecl}; margin: 0; }`;

	const containerRule = `page-container {
    --page-width: ${pageWidth};
    --page-height: ${pageHeight};
    --page-margin: ${pageMargin};
  }`;

	const pageHtml = pages
		.map(({ html }) => `<page-container>\n${html}\n</page-container>`)
		.join("\n");

	return `<!doctype html>
<html lang="en">
<script type="module" src="/debug/page-container.js"></script>
<style>
  ${atPageRule}
  body {
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
  }
  ${containerRule}
  ${contentStyles}
</style>
${pageHtml}
`;
}
