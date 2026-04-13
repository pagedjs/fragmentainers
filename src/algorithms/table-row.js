import { BlockBreakToken } from "../fragmentation/tokens.js";
import { ConstraintSpace } from "../fragmentation/constraint-space.js";
import { Fragment } from "../fragmentation/fragment.js";
import { LayoutRequest } from "../layout/layout-request.js";
import { findChildBreakToken } from "../fragmentation/tokens.js";

export const ALGORITHM_TABLE_ROW = "TableRowData";

/**
 * Table row layout algorithm — parallel flow.
 *
 * Each cell is yielded independently. All cells get break tokens
 * when any cell overflows (completed cells get isAtBlockEnd = true).
 * The tallest cell drives the break point.
 *
 * Table cells dispatched to InlineContentAlgorithm return content-only
 * height (lines × lineHeight), missing cell padding/border. Use the
 * DOM-measured height when it's larger for accurate row sizing.
 */
export class TableRowAlgorithm {
	#node;
	#constraintSpace;
	#breakToken;

	#cellFragments = [];
	#cellBreakTokens = [];
	#maxCellBlockSize = 0;
	#anyChildBroke = false;

	// Class A break scoring (earlyBreakTarget) is only implemented by
	// BlockContainerAlgorithm — table rows have no Class A breakpoints.
	constructor(node, constraintSpace, breakToken) {
		this.#node = node;
		this.#constraintSpace = constraintSpace;
		this.#breakToken = breakToken;
	}

	*layout() {
		const cells = this.#node.cells || this.#node.children;
		yield* this.layoutCells(cells);
		if (this.#anyChildBroke) this.#fillCompletedCellTokens(cells);
		return this.#buildOutput();
	}

	*layoutCells(cells) {
		const cellCount = cells.length;
		for (let i = 0; i < cellCount; i++) {
			const cell = cells[i];
			const cellBreakToken = findChildBreakToken(this.#breakToken, cell);
			const effectiveCellBreakToken = cellBreakToken?.isBreakBefore ? null : cellBreakToken;

			// Each cell gets the full inline size allocated by the table
			// (simplified — real implementation uses column widths)
			const cellInlineSize =
				cell.cellInlineSize || this.#constraintSpace.availableInlineSize / cellCount;

			const cellConstraint = new ConstraintSpace({
				availableInlineSize: cellInlineSize,
				availableBlockSize: this.#constraintSpace.availableBlockSize,
				fragmentainerBlockSize: this.#constraintSpace.fragmentainerBlockSize,
				blockOffsetInFragmentainer: this.#constraintSpace.blockOffsetInFragmentainer,
				fragmentationType: this.#constraintSpace.fragmentationType,
			});

			const result = yield new LayoutRequest(cell, cellConstraint, effectiveCellBreakToken);

			this.#cellFragments.push(result.fragment);

			// Use DOM-measured height as a floor for fresh, non-fragmenting cells
			// (continuation or fragmented cells must use the layout-computed size).
			let cellBlockSize = result.fragment.blockSize;
			if (!effectiveCellBreakToken && !result.breakToken && cell.blockSize > cellBlockSize) {
				cellBlockSize = cell.blockSize;
				result.fragment.blockSize = cellBlockSize;
			}
			this.#maxCellBlockSize = Math.max(this.#maxCellBlockSize, cellBlockSize);

			if (result.breakToken) {
				this.#cellBreakTokens.push(result.breakToken);
				this.#anyChildBroke = true;
			} else {
				// Placeholder — resolved below if any sibling broke
				this.#cellBreakTokens.push(null);
			}
		}
	}

	#fillCompletedCellTokens(cells) {
		for (let i = 0; i < this.#cellBreakTokens.length; i++) {
			if (this.#cellBreakTokens[i] === null) {
				const doneToken = new BlockBreakToken(cells[i]);
				doneToken.isAtBlockEnd = true;
				doneToken.hasSeenAllChildren = true;
				this.#cellBreakTokens[i] = doneToken;
			}
		}
	}

	#buildOutput() {
		const fragment = new Fragment(this.#node, this.#maxCellBlockSize, this.#cellFragments);
		fragment.inlineSize = this.#constraintSpace.availableInlineSize;

		if (this.#anyChildBroke) {
			const rowToken = new BlockBreakToken(this.#node);
			rowToken.consumedBlockSize =
				(this.#breakToken?.consumedBlockSize || 0) + this.#maxCellBlockSize;
			rowToken.sequenceNumber = (this.#breakToken?.sequenceNumber ?? -1) + 1;
			rowToken.childBreakTokens = this.#cellBreakTokens;
			rowToken.hasSeenAllChildren = true;
			rowToken.algorithmData = { type: ALGORITHM_TABLE_ROW };
			fragment.breakToken = rowToken;
		}

		return { fragment, breakToken: fragment.breakToken || null };
	}
}
