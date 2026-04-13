import { BlockBreakToken } from "../fragmentation/tokens.js";
import { ConstraintSpace } from "../fragmentation/constraint-space.js";
import { Fragment } from "../fragmentation/fragment.js";
import { FlowThreadNode } from "../layout/flow-thread-node.js";
import { layoutChild } from "../layout/layout-request.js";
import { FRAGMENTATION_COLUMN, FRAGMENTATION_NONE } from "../fragmentation/constraint-space.js";

export const ALGORITHM_MULTICOL = "MulticolData";

/**
 * CSS Multicol §3 pseudo-algorithm.
 * Resolves used column count and width from CSS properties and container width.
 *
 * @param {number} U - Container's content box inline-size
 * @param {number|null} specifiedWidth - column-width value (null = auto)
 * @param {number|null} specifiedCount - column-count value (null = auto)
 * @param {number} gap - column-gap value in px
 * @returns {{ count: number, width: number }}
 */
export function resolveColumnDimensions(U, specifiedWidth, specifiedCount, gap) {
	// Both auto → single column
	if (specifiedWidth == null && specifiedCount == null) {
		return { count: 1, width: U };
	}

	let N, W;

	if (specifiedWidth != null && specifiedCount == null) {
		// Only column-width specified — width is a minimum
		N = Math.max(1, Math.floor((U + gap) / (specifiedWidth + gap)));
		W = (U - (N - 1) * gap) / N;
	} else if (specifiedWidth == null && specifiedCount != null) {
		// Only column-count specified
		N = specifiedCount;
		W = Math.max(0, (U - (N - 1) * gap) / N);
	} else {
		// Both specified — column-count acts as maximum
		N = Math.min(specifiedCount, Math.max(1, Math.floor((U + gap) / (specifiedWidth + gap))));
		W = (U - (N - 1) * gap) / N;
	}

	return { count: N, width: W };
}

/**
 * Multicol container layout algorithm (generator).
 *
 * Resolves column dimensions, creates an anonymous flow thread,
 * and runs a column loop where each iteration is a column fragmentainer.
 * Mirrors Chromium's NGColumnLayoutAlgorithm.
 *
 * @param {import('../helpers.js').LayoutNode} node - The multicol container
 * @param {ConstraintSpace} constraintSpace
 * @param {import('../tokens.js').BlockBreakToken|null} breakToken
 */
export function* layoutMulticolContainer(node, constraintSpace, breakToken) {
	const containerInlineSize = constraintSpace.availableInlineSize;
	const gap = node.columnGap ?? 0;

	// Resolve column count and width (CSS Multicol §3)
	const { count, width } = resolveColumnDimensions(
		containerInlineSize,
		node.columnWidth,
		node.columnCount,
		gap,
	);

	// Determine column height from available block space
	const columnHeight = constraintSpace.availableBlockSize;

	// Build column constraint space
	const columnCS = new ConstraintSpace({
		availableInlineSize: width,
		availableBlockSize: columnHeight,
		fragmentainerBlockSize: columnHeight,
		blockOffsetInFragmentainer: 0,
		fragmentationType: FRAGMENTATION_COLUMN,
		isNewFormattingContext: true,
	});

	// Create anonymous flow thread (Chromium pattern — avoids recursion)
	const flowThread = new FlowThreadNode(node);

	// Resume content token from previous outer fragmentainer
	let contentToken = breakToken?.childBreakTokens?.[0] ?? null;

	// === COLUMN LOOP ===
	const columnFragments = [];

	do {
		const result = yield layoutChild(flowThread, columnCS, contentToken);

		columnFragments.push(result.fragment);
		contentToken = result.breakToken;

		// column-fill: auto — stop at column count limit
		if (node.columnFill === "auto" && columnFragments.length >= count) {
			break;
		}
	} while (contentToken !== null);

	// Build multicol fragment
	const multicolBlockSize =
		columnHeight === Infinity
			? Math.max(...columnFragments.map((f) => f.blockSize), 0)
			: columnHeight;

	const fragment = new Fragment(node, multicolBlockSize, columnFragments);
	fragment.inlineSize = containerInlineSize;
	fragment.multicolData = { columnWidth: width, columnGap: gap, columnCount: count };

	// Break token if content remains and we're in an outer fragmentation context
	// (stub: emitted but nested column-in-page re-resolution not yet handled)
	if (contentToken !== null && constraintSpace.fragmentationType !== FRAGMENTATION_NONE) {
		const multicolToken = new BlockBreakToken(node);
		multicolToken.consumedBlockSize = (breakToken?.consumedBlockSize || 0) + multicolBlockSize;
		multicolToken.sequenceNumber = (breakToken?.sequenceNumber ?? -1) + 1;
		multicolToken.childBreakTokens = [contentToken];
		multicolToken.hasSeenAllChildren = false;
		multicolToken.algorithmData = {
			type: ALGORITHM_MULTICOL,
			columnCount: count,
			columnWidth: width,
			columnGap: gap,
		};
		fragment.breakToken = multicolToken;
	}

	return { fragment, breakToken: fragment.breakToken || null };
}
