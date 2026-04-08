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
		const constraints = flow.fragments[i].constraints;
		const fragEl = document.querySelector(`[data-page-index="${i}"] fragment-container`);
		pages.push({ constraints, html: fragEl.contentRoot.innerHTML });
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
 * Build a static reference HTML document from rendered pages.
 *
 * @param {{ constraints: object, html: string }[]} pages
 * @returns {string}
 */
export function buildRefHtml(pages) {
	const contentStyles = collectStylesWithoutPageRules();
	const { constraints } = pages[0];

	// Always use computed pixel values
	const pageWidth = `${constraints.pageBoxSize.inlineSize}px`;
	const pageHeight = `${constraints.pageBoxSize.blockSize}px`;

	const m = constraints.margins;

	// Reconstruct the @page rule with pixel sizes and margin: 0
	// (margins are handled by page-container padding via --page-margin).
	const sizeStr = `${constraints.pageBoxSize.inlineSize}px ${constraints.pageBoxSize.blockSize}px`;
	const atPageRule = `@page { size: ${sizeStr}; margin: 0; }`;

	const containerRule = `page-container {
    --page-width: ${pageWidth};
    --page-height: ${pageHeight};
    --page-margin-top: ${m.top}px;
    --page-margin-right: ${m.right}px;
    --page-margin-bottom: ${m.bottom}px;
    --page-margin-left: ${m.left}px;
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
  }
  ${containerRule}
  ${contentStyles}
</style>
${pageHtml}
`;
}
