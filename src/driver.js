import { resolveNamedPageForBreakToken } from './helpers.js';
import { layoutBlockContainer } from './layout/block-container.js';
import { layoutInlineContent } from './layout/inline-content.js';
import { layoutMulticolContainer } from './layout/multicol-container.js';
import { layoutTableRow } from './layout/table-row.js';

/**
 * Top-level fragmentainer driver loop.
 *
 * Creates fragmentainers, runs layout generators, and collects
 * fragments until no break token remains.
 *
 * Supports two-pass layout: if the first pass returns an earlyBreak,
 * re-runs layout with the earlyBreak target to break at a better point.
 *
 * @param {import('./helpers.js').LayoutNode} rootNode
 * @param {ConstraintSpace | { resolve: Function }} constraintSpaceOrResolver
 *   Either a single ConstraintSpace (reused for every fragmentainer) or a
 *   resolver with a `.resolve()` method for per-fragmentainer resolution.
 * @returns {import('./fragment.js').PhysicalFragment[]} Array of fragmentainer fragments
 */
export function createFragments(rootNode, constraintSpaceOrResolver) {
  const useResolver = typeof constraintSpaceOrResolver?.resolve === 'function';
  const fragments = [];
  let breakToken = null;
  let zeroProgressCount = 0;
  const MAX_ZERO_PROGRESS = 5;

  for (let fragmentainerIndex = 0; breakToken !== null || fragmentainerIndex === 0; fragmentainerIndex++) {
    let constraintSpace;
    let constraints = null;

    if (useResolver) {
      const namedPage = resolveNamedPageForBreakToken(rootNode, breakToken);
      constraints = constraintSpaceOrResolver.resolve(fragmentainerIndex, namedPage, null);
      constraintSpace = constraints.toConstraintSpace();
    } else {
      constraintSpace = constraintSpaceOrResolver;
    }

    const rootAlgorithm = getLayoutAlgorithm(rootNode);

    let result = runLayoutGenerator(
      rootAlgorithm, rootNode, constraintSpace, breakToken
    );

    // Two-pass: if layout returned an earlyBreak, re-run with it as target
    if (result.earlyBreak) {
      result = runLayoutGenerator(
        rootAlgorithm, rootNode, constraintSpace, breakToken,
        result.earlyBreak
      );
    }

    if (constraints) {
      result.fragment.constraints = constraints;
    }

    fragments.push(result.fragment);
    breakToken = result.breakToken;

    // Safety: guarantee progress. Real DOM content can have 0-height elements
    // (images not yet loaded, empty containers, absolutely positioned children).
    // Allow a few consecutive zero-progress fragmentainers, then bail.
    if (breakToken && result.fragment.blockSize === 0) {
      zeroProgressCount++;
      if (zeroProgressCount >= MAX_ZERO_PROGRESS) {
        console.warn(`Fragmentainer: stopped after ${MAX_ZERO_PROGRESS} consecutive zero-progress fragmentainers at index ${fragmentainerIndex + 1}`);
        break;
      }
    } else {
      zeroProgressCount = 0;
    }
  }

  return fragments;
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
  if (node.isMulticolContainer) return layoutMulticolContainer;
  if (node.isInlineFormattingContext) return layoutInlineContent;
  if (node.isTableRow) return layoutTableRow;
  // Phase future: flex, grid, table container
  return layoutBlockContainer;
}
