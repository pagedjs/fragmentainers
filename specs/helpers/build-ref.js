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
 * Build a static reference HTML document from rendered pages.
 *
 * @param {{ pageBoxSize: { inlineSize: number, blockSize: number }, margins: object, html: string }[]} pages
 * @returns {string}
 */
export function buildRefHtml(pages) {
	const contentStyles = collectStylesWithoutPageRules();

	const { pageBoxSize, margins } = pages[0];
	const pageRule = `page-container {
    width: ${pageBoxSize.inlineSize}px;
    height: ${pageBoxSize.blockSize}px;
    padding: ${margins.top}px ${margins.right}px ${margins.bottom}px ${margins.left}px;
  }`;

	const pageHtml = pages
		.map(({ html }) => `<page-container>\n${html}\n</page-container>`)
		.join("\n");

	return `<!doctype html>
<html lang="en">
<script type="module" src="/debug/page-container.js"></script>
<style>
  body {
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
  }
  ${pageRule}

  /* Test styles */
  ${contentStyles}
</style>
${pageHtml}
`;
}
