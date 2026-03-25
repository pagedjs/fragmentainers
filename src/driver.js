import { ConstraintSpace } from './constraint-space.js';
import { layoutBlockContainer } from './layout/block-container.js';
import { layoutInlineContent } from './layout/inline-content.js';
import { layoutTableRow } from './layout/table-row.js';

/**
 * Top-level fragmentainer driver loop.
 *
 * Creates fragmentainers (pages/columns), runs layout generators,
 * and collects fragments until no break token remains.
 *
 * Supports two-pass layout: if the first pass returns an earlyBreak,
 * re-runs layout with the earlyBreak target to break at a better point.
 *
 * @param {import('./helpers.js').LayoutNode} rootNode
 * @param {{ inlineSize: number, blockSize: number }[]} fragmentainerSizes
 * @returns {import('./fragment.js').PhysicalFragment[]} Array of page fragments
 */
export function paginateContent(rootNode, fragmentainerSizes) {
  const pages = [];
  let breakToken = null;
  let zeroProgressCount = 0;
  const MAX_ZERO_PROGRESS = 5;

  for (let pageIndex = 0; breakToken !== null || pageIndex === 0; pageIndex++) {
    const size = fragmentainerSizes[pageIndex] || fragmentainerSizes.at(-1);

    const constraintSpace = new ConstraintSpace({
      availableInlineSize: size.inlineSize,
      availableBlockSize: size.blockSize,
      fragmentainerBlockSize: size.blockSize,
      blockOffsetInFragmentainer: 0,
      fragmentationType: 'page',
    });

    let result = runLayoutGenerator(
      layoutBlockContainer, rootNode, constraintSpace, breakToken
    );

    // Two-pass: if layout returned an earlyBreak, re-run with it as target
    if (result.earlyBreak) {
      result = runLayoutGenerator(
        layoutBlockContainer, rootNode, constraintSpace, breakToken,
        result.earlyBreak
      );
    }

    pages.push(result.fragment);
    breakToken = result.breakToken;

    // Safety: guarantee progress. Real DOM content can have 0-height elements
    // (images not yet loaded, empty containers, absolutely positioned children).
    // Allow a few consecutive 0-progress pages, then bail.
    if (breakToken && result.fragment.blockSize === 0) {
      zeroProgressCount++;
      if (zeroProgressCount >= MAX_ZERO_PROGRESS) {
        console.warn(`Fragmentainer: stopped after ${MAX_ZERO_PROGRESS} consecutive zero-progress pages at page ${pageIndex + 1}`);
        break;
      }
    } else {
      zeroProgressCount = 0;
    }
  }

  return pages;
}

/**
 * Runs a layout generator to completion, recursively fulfilling
 * any child LayoutRequests it yields.
 *
 * @param {Function} generatorFn - Layout algorithm generator function
 * @param {Object} node - Layout node
 * @param {ConstraintSpace} constraintSpace
 * @param {Object|null} breakToken
 * @param {Object|null} [earlyBreakTarget] - For Pass 2: break at this target
 */
export function runLayoutGenerator(generatorFn, node, constraintSpace, breakToken, earlyBreakTarget = null) {
  const gen = generatorFn(node, constraintSpace, breakToken, earlyBreakTarget);
  let genResult = gen.next();

  while (!genResult.done) {
    const request = genResult.value;

    // Determine which layout algorithm to use for the child
    const childGenFn = getLayoutAlgorithm(request.node);

    // Recursively run the child's layout generator
    const childResult = runLayoutGenerator(
      childGenFn,
      request.node,
      request.constraintSpace,
      request.breakToken
    );

    // If child returned an earlyBreak, propagate it up
    if (childResult.earlyBreak) {
      // Return to parent immediately so the earlyBreak reaches the driver
      return childResult;
    }

    // Send the child's result back into the parent generator
    genResult = gen.next(childResult);
  }

  return genResult.value;
}

/**
 * Dispatch to the correct layout algorithm based on node type.
 */
export function getLayoutAlgorithm(node) {
  if (node.isInlineFormattingContext) return layoutInlineContent;
  if (node.isTableRow) return layoutTableRow;
  // Phase future: flex, grid, table container
  return layoutBlockContainer;
}
