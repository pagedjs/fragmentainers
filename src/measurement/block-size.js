import { measureLines, getLineHeight } from "./line-box.js";
import { computedStyleMap } from "../styles/computed-style-map.js";
import { typedLengthToPx } from "../styles/css-values.js";

/**
 * Measure the rendered block size (height) of a DOM element.
 */
export function measureElementBlockSize(element) {
	return element.getBoundingClientRect().height;
}

/**
 * Measure the rendered inline size (width) of a DOM element's border box.
 */
export function measureElementInlineSize(element) {
	return element.getBoundingClientRect().width;
}

const BLOCK_DISPLAYS_FOR_INTRINSIC = new Set([
	"block",
	"flex",
	"grid",
	"table",
	"list-item",
	"table-row-group",
	"table-header-group",
	"table-footer-group",
	"table-row",
	"table-caption",
]);

function parsePx(value) {
	const n = parseFloat(value);
	return Number.isFinite(n) ? n : 0;
}

/**
 * Measure a table cell's intrinsic content height, independent of any
 * row-stretching the browser applies. `getBoundingClientRect().height`
 * on a `<td>`/`<th>` returns the stretched row height — this helper
 * measures the cell's actual content instead.
 *
 * @param {Element} element
 * @returns {number}
 */
export function measureCellIntrinsicBlockSize(element) {
	const cs = getComputedStyle(element);
	const insetStart = parsePx(cs.paddingTop) + parsePx(cs.borderTopWidth);
	const insetEnd = parsePx(cs.paddingBottom) + parsePx(cs.borderBottomWidth);
	const insets = insetStart + insetEnd;

	let contentHeight = 0;
	let spanTop = Infinity;
	let spanBottom = -Infinity;
	let hasBlockChild = false;
	for (const child of element.childNodes) {
		if (child.nodeType === Node.ELEMENT_NODE) {
			const childCs = getComputedStyle(child);
			if (childCs.display === "none") continue;
			// Out-of-flow children don't contribute to the in-flow content span.
			if (childCs.position === "absolute" || childCs.position === "fixed") continue;
			const rect = child.getBoundingClientRect();
			// Margins render inside the cell's BFC, so extend the span to the
			// child's margin box. min-top→max-bottom reproduces the browser's
			// collapsed sibling-margin layout.
			spanTop = Math.min(spanTop, rect.top - parsePx(childCs.marginTop));
			spanBottom = Math.max(spanBottom, rect.bottom + parsePx(childCs.marginBottom));
			if (BLOCK_DISPLAYS_FOR_INTRINSIC.has(childCs.display)) hasBlockChild = true;
		} else if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
			// Text outside any block child still contributes to the content span.
			const range = document.createRange();
			range.selectNodeContents(child);
			const rect = range.getBoundingClientRect();
			if (rect.height > 0) {
				spanTop = Math.min(spanTop, rect.top);
				spanBottom = Math.max(spanBottom, rect.bottom);
			}
		}
	}

	if (hasBlockChild && spanTop !== Infinity) {
		contentHeight = spanBottom - spanTop;
	} else if (!hasBlockChild) {
		const measured = measureLines(element);
		if (measured.count > 0) {
			const lineHeight =
				(measured.lineHeight > 0 ? measured.lineHeight : 0) || getLineHeight(element);
			contentHeight = measured.count * lineHeight;
		}
	}

	// getComputedStyle returns the USED height for table cells (row-stretched).
	// computedStyleMap returns the computed value — distinguishes explicit
	// lengths from `auto`, so it's safe to use for detecting authored height.
	const styleMap = computedStyleMap(element);
	const explicit = typedLengthToPx(styleMap.get("height")) ?? 0;
	const minHeight = parsePx(cs.minHeight);
	return Math.max(contentHeight + insets, explicit, minHeight);
}
