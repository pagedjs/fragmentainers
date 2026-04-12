/**
 * Layout helpers — small stateless utilities used across layout algorithms.
 *
 * - isMonolithic / getMonolithicBlockSize: classify nodes that can't be
 *   fragmented (replaced elements, scroll containers, fixed-height
 *   overflow:hidden) and get their size without a full layout pass.
 *
 * - buildCumulativeHeights / estimateBreakPoints: prefix-sum based
 *   speculative break estimation. After block sizes are cached, these
 *   compute cumulative heights and estimate fragmentainer break points
 *   in O(log N) per query. The estimates are approximate: they account
 *   for collapsed sibling margins but not forced breaks, named page
 *   changes, or break-inside/before/after rules. The block container
 *   algorithm uses them as a fast-path hint, never as a substitute for
 *   the full per-child loop.
 */

import { collapseMargins } from "./margin-collapsing.js";

/**
 * Check if a node is monolithic (cannot be fragmented).
 * Monolithic content contains no possible break points.
 * @param {import("./layout-node.js").LayoutNode} node
 * @returns {boolean}
 */
export function isMonolithic(node) {
	return (
		node.isReplacedElement ||
		node.isScrollable ||
		(node.hasOverflowHidden && node.hasExplicitBlockSize)
	);
}

/**
 * Get the block size of a monolithic element without full layout.
 * @param {import("./layout-node.js").LayoutNode} node
 * @param {import("../fragmentation/constraint-space.js").ConstraintSpace} constraintSpace
 * @returns {number}
 */
export function getMonolithicBlockSize(node, constraintSpace) {
	return node.computedBlockSize(constraintSpace.availableInlineSize);
}

/**
 * Build a prefix sum of block sizes for a node's children.
 *
 * cumulative[0] = 0
 * cumulative[i+1] = cumulative[i] + collapsedMargin(i) + children[i].blockSize
 *
 * Collapsed margins use the standard CSS rule:
 * max(prevChild.marginBlockEnd, child.marginBlockStart).
 * The first child's full marginBlockStart is included.
 *
 * @param {import('./layout-node.js').DOMLayoutNode} node
 * @returns {Float64Array} Length = children.length + 1
 */
export function buildCumulativeHeights(node) {
	const children = node.children;
	const n = children.length;
	const cumulative = new Float64Array(n + 1);
	const tableSpacing = node.borderSpacingBlock;

	for (let i = 0; i < n; i++) {
		const child = children[i];
		const margin =
			i > 0
				? collapseMargins(children[i - 1].marginBlockEnd || 0, child.marginBlockStart || 0)
				: child.marginBlockStart || 0;
		const spacing = tableSpacing > 0 && i > 0 ? tableSpacing : 0;
		cumulative[i + 1] = cumulative[i] + margin + spacing + (child.blockSize || 0);
	}

	return cumulative;
}

/**
 * Estimate fragmentainer break points from cumulative heights.
 *
 * Returns an array of child indices where each fragmentainer starts.
 * Uses binary search for O(log N) per break point.
 *
 * @param {Float64Array} cumulative — from buildCumulativeHeights
 * @param {number} fragmentainerBlockSize — page/column height
 * @param {number} [containerBoxStart=0] — padding-top + border-top
 * @param {number} [containerBoxEnd=0] — padding-bottom + border-bottom
 * @returns {number[]} Child indices where each fragmentainer starts
 */
export function estimateBreakPoints(
	cumulative,
	fragmentainerBlockSize,
	containerBoxStart = 0,
	containerBoxEnd = 0,
) {
	const effectiveHeight = fragmentainerBlockSize - containerBoxStart - containerBoxEnd;
	if (effectiveHeight <= 0) return [0];

	const n = cumulative.length - 1; // number of children
	const breaks = [0];
	let pageStart = 0;
	let startOffset = 0;

	while (pageStart < n) {
		const targetHeight = startOffset + effectiveHeight;

		// Binary search: last child index whose cumulative end <= targetHeight
		let lo = pageStart;
		let hi = n;
		while (lo < hi) {
			const mid = (lo + hi + 1) >>> 1;
			if (cumulative[mid] <= targetHeight) {
				lo = mid;
			} else {
				hi = mid - 1;
			}
		}

		if (lo <= pageStart) {
			// Single child exceeds page — advance past it
			lo = pageStart + 1;
		}

		if (lo >= n) break; // all children assigned
		breaks.push(lo);
		startOffset = cumulative[lo];
		pageStart = lo;
	}

	return breaks;
}
