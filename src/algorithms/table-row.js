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
 * The row's block-size is the maximum of its cells' specified heights and
 * the minimum height their content requires (CSS 2.1 §17.5.3). A cell's
 * fragment carries only the latter: the block container sizes a cell by
 * its content, never by its `height`, because the row owns that size.
 */
export class TableRowAlgorithm {
	#node;
	#constraintSpace;
	#breakToken;

	#cellFragments = [];
	#cellBreakTokens = [];
	#maxCellBlockSize = 0;
	#anyChildBroke = false;
	#anyChildBrokeInFlow = false;
	#earlyBreakTarget = null;

	// Class A break scoring (earlyBreakTarget) is only implemented by
	// BlockContainerAlgorithm — table rows have no Class A breakpoints.
	// The target is forwarded to descendants so a nested block can honor it.
	constructor(node, constraintSpace, breakToken, earlyBreakTarget = null) {
		this.#node = node;
		this.#constraintSpace = constraintSpace;
		this.#breakToken = breakToken;
		this.#earlyBreakTarget = earlyBreakTarget;
	}

	get node() {
		return this.#node;
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

			const result = yield new LayoutRequest(
				cell,
				cellConstraint,
				effectiveCellBreakToken,
				this.#earlyBreakTarget,
			);

			this.#cellFragments.push(result.fragment);

			// Raise a cell laid out whole to its specified `height` / `min-height`
			// (CSS 2.1 §17.5.3); `intrinsicBlockSize` folds those in with the
			// cell's content minimum. A fragmented or continued cell keeps its
			// laid-out extent. The browser-reported `blockSize` is never used: it
			// is already stretched to the row's tallest cell.
			let cellBlockSize = result.fragment.blockSize;
			if (
				!effectiveCellBreakToken &&
				!result.breakToken &&
				cell.intrinsicBlockSize > cellBlockSize
			) {
				cellBlockSize = cell.intrinsicBlockSize;
				result.fragment.blockSize = cellBlockSize;
			}
			this.#maxCellBlockSize = Math.max(this.#maxCellBlockSize, cellBlockSize);

			if (result.breakToken) {
				this.#cellBreakTokens.push(result.breakToken);
				this.#anyChildBroke = true;
				if (result.breakToken.continuesInFlow) this.#anyChildBrokeInFlow = true;
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
			// Every cell at its block-end leaves the row's own extent complete:
			// it continues only to carry their parallel flows (§2.1).
			rowToken.isAtBlockEnd = !this.#anyChildBrokeInFlow;
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
