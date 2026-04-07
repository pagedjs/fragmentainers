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
	const css = constraints.cssText;

	// Use original CSS units when available, fall back to computed px
	const pageWidth = css?.pageBoxSize?.inline?.toString() || `${constraints.pageBoxSize.inlineSize}px`;
	const pageHeight = css?.pageBoxSize?.block?.toString() || `${constraints.pageBoxSize.blockSize}px`;

	let pageMargin;
	if (css?.margin) {
		const m = css.margin;
		pageMargin = `${m.top} ${m.right} ${m.bottom} ${m.left}`;
	} else {
		const m = constraints.margins;
		pageMargin = `${m.top}px ${m.right}px ${m.bottom}px ${m.left}px`;
	}

	// Reconstruct the @page rule with the original size but margin: 0
	// (margins are handled by page-container padding via --page-margin).
	const sizeStr = css?.pageBoxSize
		? `${css.pageBoxSize.inline} ${css.pageBoxSize.block}`
		: `${constraints.pageBoxSize.inlineSize}px ${constraints.pageBoxSize.blockSize}px`;
	const atPageRule = `@page { size: ${sizeStr}; margin: 0; }`;

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
