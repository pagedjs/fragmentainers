import { BlockBreakToken } from "../fragmentation/tokens.js";
import { ConstraintSpace } from "../fragmentation/constraint-space.js";
import { Fragment } from "../fragmentation/fragment.js";
import { LayoutRequest } from "../layout/layout-request.js";
import { findChildBreakToken } from "../fragmentation/tokens.js";
import { FRAGMENTATION_NONE } from "../fragmentation/constraint-space.js";

export const ALGORITHM_GRID = "GridData";

/**
 * Grid container layout algorithm.
 *
 * Grid items sharing the same row are parallel flows (same pattern
 * as table-row). Rows are stacked in the block direction with
 * breaks between rows.
 *
 * Grid row membership is determined from each item's gridRowStart
 * property. Items are assumed to span exactly one row (spanning
 * grid items are stubbed).
 */
export class GridAlgorithm {
	#node;
	#constraintSpace;
	#breakToken;

	#rowFragments = [];
	#blockOffset = 0;
	#startRow = 0;
	#containerBreakToken = null;

	// Class A break scoring (earlyBreakTarget) is only implemented by
	// BlockContainerAlgorithm — grid breaks at row boundaries only.
	constructor(node, constraintSpace, breakToken) {
		this.#node = node;
		this.#constraintSpace = constraintSpace;
		this.#breakToken = breakToken;
		if (breakToken?.algorithmData?.type === ALGORITHM_GRID) {
			this.#startRow = breakToken.algorithmData.rowIndex;
		}
	}

	*layout() {
		const children = this.#node.children;
		if (children.length === 0) return this.#emptyOutput();
		const gridRows = groupGridRows(children);
		yield* this.layoutRows(gridRows);
		return this.#buildOutput();
	}

	#emptyOutput() {
		const fragment = new Fragment(this.#node, 0);
		fragment.inlineSize = this.#constraintSpace.availableInlineSize;
		return { fragment, breakToken: null };
	}

	*layoutRows(gridRows) {
		for (let rowIdx = this.#startRow; rowIdx < gridRows.length; rowIdx++) {
			const rowItems = gridRows[rowIdx];

			// Lay out this grid row as parallel flows (table-row pattern)
			const rowResult = yield* this.layoutGridRow(rowItems, this.#blockOffset);

			this.#rowFragments.push(rowResult.fragment);
			this.#blockOffset += rowResult.fragment.blockSize;

			if (rowResult.anyBroke) {
				this.#buildContainerBreakToken(rowIdx);
				break;
			}

			// Class A break between grid rows: if next row doesn't fit, bail
			if (
				this.#constraintSpace.fragmentationType !== FRAGMENTATION_NONE &&
				rowIdx + 1 < gridRows.length &&
				this.#blockOffset >=
					this.#constraintSpace.fragmentainerBlockSize -
						this.#constraintSpace.blockOffsetInFragmentainer
			) {
				this.#buildContainerBreakToken(rowIdx + 1);
				break;
			}
		}
	}

	*layoutGridRow(rowItems, blockOffset) {
		const itemFragments = [];
		const itemBreakTokens = [];
		let maxItemBlockSize = 0;
		let anyBroke = false;

		const itemCount = rowItems.length;
		const itemInlineSize = this.#constraintSpace.availableInlineSize / itemCount;

		for (let i = 0; i < itemCount; i++) {
			const item = rowItems[i];
			const itemBreakToken = findChildBreakToken(this.#breakToken, item);
			const effectiveItemBreakToken = itemBreakToken?.isBreakBefore ? null : itemBreakToken;

			const itemConstraint = new ConstraintSpace({
				availableInlineSize: item.itemInlineSize || itemInlineSize,
				availableBlockSize: this.#constraintSpace.availableBlockSize - blockOffset,
				fragmentainerBlockSize: this.#constraintSpace.fragmentainerBlockSize,
				blockOffsetInFragmentainer:
					this.#constraintSpace.blockOffsetInFragmentainer + blockOffset,
				fragmentationType: this.#constraintSpace.fragmentationType,
			});

			const result = yield new LayoutRequest(item, itemConstraint, effectiveItemBreakToken);

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

		const rowFragment = new Fragment(this.#node, maxItemBlockSize, itemFragments);
		rowFragment.inlineSize = this.#constraintSpace.availableInlineSize;

		let rowToken = null;
		if (anyBroke) {
			rowToken = new BlockBreakToken(this.#node);
			rowToken.childBreakTokens = itemBreakTokens;
			rowToken.hasSeenAllChildren = true;
		}

		return { fragment: rowFragment, breakToken: rowToken, anyBroke };
	}

	#buildContainerBreakToken(rowIndex) {
		const token = new BlockBreakToken(this.#node);
		token.consumedBlockSize = (this.#breakToken?.consumedBlockSize || 0) + this.#blockOffset;
		token.sequenceNumber = (this.#breakToken?.sequenceNumber ?? -1) + 1;
		token.hasSeenAllChildren = false;
		token.algorithmData = {
			type: ALGORITHM_GRID,
			rowIndex,
		};
		this.#containerBreakToken = token;
	}

	#buildOutput() {
		const fragment = new Fragment(this.#node, this.#blockOffset, this.#rowFragments);
		fragment.inlineSize = this.#constraintSpace.availableInlineSize;
		if (this.#containerBreakToken) fragment.breakToken = this.#containerBreakToken;
		return { fragment, breakToken: fragment.breakToken || null };
	}
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
