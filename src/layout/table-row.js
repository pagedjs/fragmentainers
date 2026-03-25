import { BlockBreakToken } from '../tokens.js';
import { ConstraintSpace } from '../constraint-space.js';
import { PhysicalFragment } from '../fragment.js';
import { layoutChild } from '../layout-request.js';
import { findChildBreakToken } from '../helpers.js';

/**
 * Table row layout generator — parallel flow.
 *
 * Each cell is yielded independently. All cells get break tokens
 * when any cell overflows (completed cells get isAtBlockEnd = true).
 * The tallest cell drives the break point.
 */
export function* layoutTableRow(node, constraintSpace, breakToken) {
  const cellFragments = [];
  const cellBreakTokens = [];
  let maxCellBlockSize = 0;
  let anyChildBroke = false;

  const cells = node.cells || node.children;
  const cellCount = cells.length;

  for (let i = 0; i < cellCount; i++) {
    const cell = cells[i];
    const cellBreakToken = findChildBreakToken(breakToken, cell);
    const effectiveCellBreakToken = cellBreakToken?.isBreakBefore ? null : cellBreakToken;

    // Each cell gets the full inline size allocated by the table
    // (simplified — real implementation uses column widths)
    const cellInlineSize = cell.cellInlineSize ||
      (constraintSpace.availableInlineSize / cellCount);

    const cellConstraint = new ConstraintSpace({
      availableInlineSize: cellInlineSize,
      availableBlockSize: constraintSpace.availableBlockSize,
      fragmentainerBlockSize: constraintSpace.fragmentainerBlockSize,
      blockOffsetInFragmentainer: constraintSpace.blockOffsetInFragmentainer,
      fragmentationType: constraintSpace.fragmentationType,
    });

    const result = yield layoutChild(cell, cellConstraint, effectiveCellBreakToken);

    cellFragments.push(result.fragment);
    maxCellBlockSize = Math.max(maxCellBlockSize, result.fragment.blockSize);

    if (result.breakToken) {
      cellBreakTokens.push(result.breakToken);
      anyChildBroke = true;
    } else {
      // Placeholder — resolved below if any sibling broke
      cellBreakTokens.push(null);
    }
  }

  // If any cell broke, completed cells need isAtBlockEnd tokens
  if (anyChildBroke) {
    for (let i = 0; i < cellBreakTokens.length; i++) {
      if (cellBreakTokens[i] === null) {
        const doneToken = new BlockBreakToken(cells[i]);
        doneToken.isAtBlockEnd = true;
        doneToken.hasSeenAllChildren = true;
        cellBreakTokens[i] = doneToken;
      }
    }
  }

  const fragment = new PhysicalFragment(node, maxCellBlockSize, cellFragments);
  fragment.inlineSize = constraintSpace.availableInlineSize;

  if (anyChildBroke) {
    const rowToken = new BlockBreakToken(node);
    rowToken.consumedBlockSize =
      (breakToken?.consumedBlockSize || 0) + maxCellBlockSize;
    rowToken.sequenceNumber =
      (breakToken?.sequenceNumber ?? -1) + 1;
    rowToken.childBreakTokens = cellBreakTokens;
    rowToken.hasSeenAllChildren = true;
    rowToken.algorithmData = { type: 'kTableRowData' };
    fragment.breakToken = rowToken;
  }

  return { fragment, breakToken: fragment.breakToken || null };
}
