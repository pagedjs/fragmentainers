import { BlockBreakToken } from "../fragmentation/tokens.js";
import { ConstraintSpace } from "../fragmentation/constraint-space.js";
import { Fragment } from "../fragmentation/fragment.js";
import { layoutChild } from "../layout/layout-request.js";
import { findChildBreakToken } from "../fragmentation/tokens.js";
import { FRAGMENTATION_NONE } from "../fragmentation/constraint-space.js";

export const ALGORITHM_GRID = "GridData";

/**
 * Grid container layout algorithm (generator).
 *
 * Grid items sharing the same row are parallel flows (same pattern
 * as table-row). Rows are stacked in the block direction with
 * breaks between rows.
 *
 * Grid row membership is determined from each item's gridRowStart
 * property. Items are assumed to span exactly one row (spanning
 * grid items are stubbed).
 */
export function* layoutGridContainer(node, constraintSpace, breakToken) {
	const children = node.children;
	if (children.length === 0) {
		const fragment = new Fragment(node, 0);
		fragment.inlineSize = constraintSpace.availableInlineSize;
		return { fragment, breakToken: null };
	}

	// Group children by grid row
	const gridRows = groupGridRows(children);

	const rowFragments = [];
	let blockOffset = 0;
	let startRow = 0;
	let containerBreakToken = null;

	// Resume from break token
	if (breakToken?.algorithmData?.type === ALGORITHM_GRID) {
		startRow = breakToken.algorithmData.rowIndex;
	}

	for (let rowIdx = startRow; rowIdx < gridRows.length; rowIdx++) {
		const rowItems = gridRows[rowIdx];

		// Lay out this grid row as parallel flows (table-row pattern)
		const rowResult = yield* layoutGridRow(
			node,
			rowItems,
			constraintSpace,
			blockOffset,
			breakToken,
		);

		rowFragments.push(rowResult.fragment);
		blockOffset += rowResult.fragment.blockSize;

		if (rowResult.anyBroke) {
			containerBreakToken = buildGridBreakToken(node, breakToken, blockOffset, rowIdx, gridRows);
			break;
		}

		// Check if next row fits (Class A break between grid rows)
		if (
			constraintSpace.fragmentationType !== FRAGMENTATION_NONE &&
			rowIdx + 1 < gridRows.length &&
			blockOffset >=
				constraintSpace.fragmentainerBlockSize - constraintSpace.blockOffsetInFragmentainer
		) {
			containerBreakToken = buildGridBreakToken(
				node,
				breakToken,
				blockOffset,
				rowIdx + 1,
				gridRows,
			);
			break;
		}
	}

	const fragment = new Fragment(node, blockOffset, rowFragments);
	fragment.inlineSize = constraintSpace.availableInlineSize;
	if (containerBreakToken) fragment.breakToken = containerBreakToken;

	return { fragment, breakToken: fragment.breakToken || null };
}

/**
 * Layout a single grid row's items as parallel flows.
 * Follows the exact same pattern as layoutTableRow.
 */
function* layoutGridRow(node, rowItems, constraintSpace, blockOffset, parentBreakToken) {
	const itemFragments = [];
	const itemBreakTokens = [];
	let maxItemBlockSize = 0;
	let anyBroke = false;

	const itemCount = rowItems.length;
	const itemInlineSize = constraintSpace.availableInlineSize / itemCount;

	for (let i = 0; i < itemCount; i++) {
		const item = rowItems[i];
		const itemBreakToken = findChildBreakToken(parentBreakToken, item);
		const effectiveItemBreakToken = itemBreakToken?.isBreakBefore ? null : itemBreakToken;

		const itemConstraint = new ConstraintSpace({
			availableInlineSize: item.itemInlineSize || itemInlineSize,
			availableBlockSize: constraintSpace.availableBlockSize - blockOffset,
			fragmentainerBlockSize: constraintSpace.fragmentainerBlockSize,
			blockOffsetInFragmentainer: constraintSpace.blockOffsetInFragmentainer + blockOffset,
			fragmentationType: constraintSpace.fragmentationType,
		});

		const result = yield layoutChild(item, itemConstraint, effectiveItemBreakToken);

		itemFragments.push(result.fragment);
		maxItemBlockSize = Math.max(maxItemBlockSize, result.fragment.blockSize);

		if (result.breakToken) {
			itemBreakTokens.push(result.breakToken);
			anyBroke = true;
		} else {
			itemBreakTokens.push(null);
		}
	}

	// Parallel flow rule: completed items need isAtBlockEnd tokens
	if (anyBroke) {
		for (let i = 0; i < itemBreakTokens.length; i++) {
			if (itemBreakTokens[i] === null) {
				const doneToken = new BlockBreakToken(rowItems[i]);
				doneToken.isAtBlockEnd = true;
				doneToken.hasSeenAllChildren = true;
				itemBreakTokens[i] = doneToken;
			}
		}
	}

	const rowFragment = new Fragment(node, maxItemBlockSize, itemFragments);
	rowFragment.inlineSize = constraintSpace.availableInlineSize;

	let rowToken = null;
	if (anyBroke) {
		rowToken = new BlockBreakToken(node);
		rowToken.childBreakTokens = itemBreakTokens;
		rowToken.hasSeenAllChildren = true;
	}

	return { fragment: rowFragment, breakToken: rowToken, anyBroke };
}

/**
 * Group grid children by row index.
 * Uses gridRowStart property; items without explicit placement
 * are assigned sequentially.
 */
function groupGridRows(children) {
	const rowMap = new Map();

	for (const child of children) {
		const rowStart = child.gridRowStart ?? null;

		if (rowStart != null) {
			const key = rowStart;
			if (!rowMap.has(key)) rowMap.set(key, []);
			rowMap.get(key).push(child);
		} else {
			// Auto-placed: each item gets its own row
			const nextRow = rowMap.size + 1;
			rowMap.set(nextRow, [child]);
		}
	}

	// Sort by row index and return as array of arrays
	return [...rowMap.entries()].sort((a, b) => a[0] - b[0]).map(([, items]) => items);
}

/** Build a grid container break token with algorithm data. */
function buildGridBreakToken(node, prevToken, blockOffset, rowIndex) {
	const token = new BlockBreakToken(node);
	token.consumedBlockSize = (prevToken?.consumedBlockSize || 0) + blockOffset;
	token.sequenceNumber = (prevToken?.sequenceNumber ?? -1) + 1;
	token.hasSeenAllChildren = false;
	token.algorithmData = {
		type: ALGORITHM_GRID,
		rowIndex,
	};
	return token;
}
