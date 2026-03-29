import { BlockBreakToken } from '../tokens.js';
import { ConstraintSpace } from '../constraint-space.js';
import { PhysicalFragment } from '../fragment.js';
import { layoutChild } from '../layout-request.js';
import { findChildBreakToken } from '../helpers.js';

/**
 * Flex container layout algorithm (generator).
 *
 * Row direction: items within a flex line are parallel flows (same
 * pattern as table-row). Multi-line flex stacks lines in the block
 * direction with breaks between lines.
 *
 * Column direction: items are sequential in the block direction,
 * delegated to a flow thread (same Chromium pattern as multicol).
 */
export function* layoutFlexContainer(node, constraintSpace, breakToken) {
  const isRowDirection = node.flexDirection === 'row' ||
                         node.flexDirection === 'row-reverse';

  if (!isRowDirection) {
    // Column flex: sequential block layout via flow thread
    return yield* layoutFlexColumn(node, constraintSpace, breakToken);
  }

  // === ROW FLEX: items within a line are parallel flows ===

  const children = node.children;
  if (children.length === 0) {
    const fragment = new PhysicalFragment(node, 0);
    fragment.inlineSize = constraintSpace.availableInlineSize;
    return { fragment, breakToken: null };
  }

  // Group children into flex lines.
  // For nowrap (default), all items on one line.
  // For wrap, items are grouped by their inlineSize property.
  const flexLines = groupFlexLines(children, node.flexWrap, constraintSpace);

  const lineFragments = [];
  let blockOffset = 0;
  let startLine = 0;
  let containerBreakToken = null;

  // Resume from break token
  if (breakToken?.algorithmData?.type === 'kFlexData') {
    startLine = breakToken.algorithmData.flexLineIndex;
  }

  for (let lineIdx = startLine; lineIdx < flexLines.length; lineIdx++) {
    const lineItems = flexLines[lineIdx];
    const remainingSpace = constraintSpace.fragmentationType !== 'none'
      ? constraintSpace.fragmentainerBlockSize - constraintSpace.blockOffsetInFragmentainer - blockOffset
      : Infinity;

    // Lay out this flex line as parallel flows (table-row pattern)
    const lineResult = yield* layoutFlexLine(
      node, lineItems, constraintSpace, blockOffset, breakToken
    );

    lineFragments.push(lineResult.fragment);
    blockOffset += lineResult.fragment.blockSize;

    if (lineResult.anyBroke) {
      // Build break token for the flex container
      containerBreakToken = new BlockBreakToken(node);
      containerBreakToken.consumedBlockSize =
        (breakToken?.consumedBlockSize || 0) + blockOffset;
      containerBreakToken.sequenceNumber =
        (breakToken?.sequenceNumber ?? -1) + 1;
      containerBreakToken.childBreakTokens = lineResult.breakToken
        ? [lineResult.breakToken] : [];
      containerBreakToken.hasSeenAllChildren = false;
      containerBreakToken.algorithmData = {
        type: 'kFlexData',
        flexLineIndex: lineIdx,
      };
      break;
    }

    // Check if next line fits (Class A break between flex lines)
    if (constraintSpace.fragmentationType !== 'none' &&
        lineIdx + 1 < flexLines.length &&
        blockOffset >= constraintSpace.fragmentainerBlockSize -
          constraintSpace.blockOffsetInFragmentainer) {
      containerBreakToken = new BlockBreakToken(node);
      containerBreakToken.consumedBlockSize =
        (breakToken?.consumedBlockSize || 0) + blockOffset;
      containerBreakToken.sequenceNumber =
        (breakToken?.sequenceNumber ?? -1) + 1;
      containerBreakToken.hasSeenAllChildren = false;
      containerBreakToken.algorithmData = {
        type: 'kFlexData',
        flexLineIndex: lineIdx + 1,
      };
      break;
    }
  }

  const fragment = new PhysicalFragment(node, blockOffset, lineFragments);
  fragment.inlineSize = constraintSpace.availableInlineSize;
  if (containerBreakToken) fragment.breakToken = containerBreakToken;

  return { fragment, breakToken: fragment.breakToken || null };
}

/**
 * Layout a single flex line's items as parallel flows.
 * Follows the exact same pattern as layoutTableRow.
 */
function* layoutFlexLine(node, lineItems, constraintSpace, blockOffset, parentBreakToken) {
  const itemFragments = [];
  const itemBreakTokens = [];
  let maxItemBlockSize = 0;
  let anyBroke = false;

  const itemCount = lineItems.length;
  const itemInlineSize = constraintSpace.availableInlineSize / itemCount;

  for (let i = 0; i < itemCount; i++) {
    const item = lineItems[i];
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
        const doneToken = new BlockBreakToken(lineItems[i]);
        doneToken.isAtBlockEnd = true;
        doneToken.hasSeenAllChildren = true;
        itemBreakTokens[i] = doneToken;
      }
    }
  }

  const lineFragment = new PhysicalFragment(node, maxItemBlockSize, itemFragments);
  lineFragment.inlineSize = constraintSpace.availableInlineSize;

  let lineToken = null;
  if (anyBroke) {
    lineToken = new BlockBreakToken(node);
    lineToken.childBreakTokens = itemBreakTokens;
    lineToken.hasSeenAllChildren = true;
    lineToken.algorithmData = { type: 'kFlexLineData' };
  }

  return { fragment: lineFragment, breakToken: lineToken, anyBroke };
}

/**
 * Column-direction flex: items are sequential in the block direction.
 * Uses a flow thread so dispatch routes to layoutBlockContainer.
 */
function* layoutFlexColumn(node, constraintSpace, breakToken) {
  const flowThread = {
    children: node.children,
    element: null,
    debugName: `[flex-column-flow:${node.debugName}]`,
    blockSize: 0,
    isInlineFormattingContext: false,
    isReplacedElement: false,
    isScrollable: false,
    hasOverflowHidden: false,
    hasExplicitBlockSize: false,
    isTable: false,
    isTableRow: false,
    isFlexContainer: false,
    isGridContainer: false,
    isMulticolContainer: false,
    columnCount: null,
    columnWidth: null,
    columnGap: null,
    columnFill: 'balance',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gridRowStart: null,
    gridRowEnd: null,
    inlineItemsData: null,
    page: null,
    breakBefore: 'auto',
    breakAfter: 'auto',
    breakInside: 'auto',
    orphans: 2,
    widows: 2,
    marginBlockStart: 0,
    marginBlockEnd: 0,
    paddingBlockStart: 0,
    paddingBlockEnd: 0,
    borderBlockStart: 0,
    borderBlockEnd: 0,
    computedBlockSize: () => 0,
  };

  const contentToken = breakToken?.childBreakTokens?.[0] ?? null;
  const result = yield layoutChild(flowThread, constraintSpace, contentToken);

  const fragment = new PhysicalFragment(node, result.fragment.blockSize, result.fragment.childFragments);
  fragment.inlineSize = constraintSpace.availableInlineSize;

  if (result.breakToken) {
    const containerToken = new BlockBreakToken(node);
    containerToken.consumedBlockSize =
      (breakToken?.consumedBlockSize || 0) + result.fragment.blockSize;
    containerToken.sequenceNumber = (breakToken?.sequenceNumber ?? -1) + 1;
    containerToken.childBreakTokens = [result.breakToken];
    containerToken.hasSeenAllChildren = false;
    containerToken.algorithmData = { type: 'kFlexData', flexLineIndex: 0 };
    fragment.breakToken = containerToken;
  }

  return { fragment, breakToken: fragment.breakToken || null };
}

/**
 * Group flex children into lines.
 * For nowrap: all items on one line.
 * For wrap: split when cumulative inline size exceeds available space.
 */
function groupFlexLines(children, flexWrap, constraintSpace) {
  if (flexWrap === 'nowrap') {
    return [children];
  }

  // Simple wrapping: items that don't fit start a new line
  const lines = [];
  let currentLine = [];
  let currentWidth = 0;
  const available = constraintSpace.availableInlineSize;

  for (const child of children) {
    const itemWidth = child.itemInlineSize || (available / children.length);
    if (currentLine.length > 0 && currentWidth + itemWidth > available) {
      lines.push(currentLine);
      currentLine = [];
      currentWidth = 0;
    }
    currentLine.push(child);
    currentWidth += itemWidth;
  }

  if (currentLine.length > 0) lines.push(currentLine);
  return lines;
}
