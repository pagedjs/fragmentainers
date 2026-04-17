import { measureLines, getLineHeight } from "./line-box.js";
import { computedStyleMap } from "../styles/computed-style-map.js";

/**
 * Measure the rendered block size (height) of a DOM element.
 */
export function measureElementBlockSize(element) {
	return element.getBoundingClientRect().height;
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
	let firstVisible = null;
	let lastVisible = null;
	let hasBlockChild = false;
	for (const child of element.children) {
		const childCs = getComputedStyle(child);
		if (childCs.display === "none") continue;
		if (!firstVisible) firstVisible = child;
		lastVisible = child;
		if (BLOCK_DISPLAYS_FOR_INTRINSIC.has(childCs.display)) {
			hasBlockChild = true;
		}
	}

	if (hasBlockChild && firstVisible && lastVisible) {
		// Use rendered positions: the browser already performed sibling margin
		// collapsing when it laid out the children. firstChild.top→lastChild.bottom
		// captures the collapsed content span; add outer margins since they
		// render inside the cell (cell establishes a BFC, so they don't collapse
		// through the cell boundary).
		const firstRect = firstVisible.getBoundingClientRect();
		const lastRect = lastVisible.getBoundingClientRect();
		const firstCs = getComputedStyle(firstVisible);
		const lastCs = getComputedStyle(lastVisible);
		contentHeight =
			(lastRect.bottom - firstRect.top) +
			parsePx(firstCs.marginTop) +
			parsePx(lastCs.marginBottom);
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
	const h = styleMap.get("height");
	const explicit = h && h.unit && h.unit !== "percent" ? h.value : 0;
	const minHeight = parsePx(cs.minHeight);
	return Math.max(contentHeight + insets, explicit, minHeight);
}
