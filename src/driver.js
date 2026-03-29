import { ConstraintSpace } from "./constraint-space.js";
import { resolveNamedPageForBreakToken } from "./helpers.js";
import { layoutBlockContainer } from "./layout/block-container.js";
import { layoutFlexContainer } from "./layout/flex-container.js";
import { layoutGridContainer } from "./layout/grid-container.js";
import { layoutInlineContent } from "./layout/inline-content.js";
import { layoutMulticolContainer } from "./layout/multicol-container.js";
import { layoutTableRow } from "./layout/table-row.js";

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
 * @param {{ fragmentainerIndex: number, blockOffset: number }|null} [continuation]
 *   When provided, starts layout at the given fragmentainer index and block offset.
 *   Used to continue fragmentation across multiple independent elements.
 * @returns {import('./fragment.js').PhysicalFragment[]|{ fragments: import('./fragment.js').PhysicalFragment[], continuation: { fragmentainerIndex: number, blockOffset: number } }}
 *   When continuation is null: returns a flat array (backwards compatible).
 *   When continuation is provided: returns { fragments, continuation } with final state.
 */
export function createFragments(rootNode, constraintSpaceOrResolver, continuation = null) {
  const useResolver = typeof constraintSpaceOrResolver?.resolve === "function";
  const fragments = [];
  let breakToken = null;
  let zeroProgressCount = 0;
  const MAX_ZERO_PROGRESS = 5;

  const startIndex = continuation?.fragmentainerIndex ?? 0;
  const startOffset = continuation?.blockOffset ?? 0;

  for (let fragmentainerIndex = startIndex; breakToken !== null || fragmentainerIndex === startIndex; fragmentainerIndex++) {
    let constraintSpace;
    let constraints = null;

    if (useResolver) {
      const namedPage = resolveNamedPageForBreakToken(rootNode, breakToken);
      constraints = constraintSpaceOrResolver.resolve(fragmentainerIndex, namedPage, null);
      constraintSpace = constraints.toConstraintSpace();
    } else {
      constraintSpace = constraintSpaceOrResolver;
    }

    // Adjust first fragmentainer's offset when continuing from a previous element
    if (fragmentainerIndex === startIndex && startOffset > 0) {
      constraintSpace = new ConstraintSpace({
        availableInlineSize: constraintSpace.availableInlineSize,
        availableBlockSize: constraintSpace.fragmentainerBlockSize - startOffset,
        fragmentainerBlockSize: constraintSpace.fragmentainerBlockSize,
        blockOffsetInFragmentainer: startOffset,
        fragmentationType: constraintSpace.fragmentationType,
        isNewFormattingContext: constraintSpace.isNewFormattingContext,
      });
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

  // When using continuation, return structured result with final state
  if (continuation !== null) {
    const lastFragment = fragments[fragments.length - 1];
    const lastIndex = startIndex + fragments.length - 1;
    const lastOffset = lastFragment ? lastFragment.blockSize + (fragments.length === 1 ? startOffset : 0) : 0;
    const pageBlockSize = lastFragment?.constraints?.contentArea?.blockSize
      ?? constraintSpaceOrResolver?.fragmentainerBlockSize ?? 0;

    return {
      fragments,
      continuation: {
        fragmentainerIndex: lastOffset >= pageBlockSize ? lastIndex + 1 : lastIndex,
        blockOffset: lastOffset >= pageBlockSize ? 0 : lastOffset,
      },
    };
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
  if (node.isFlexContainer) return layoutFlexContainer;
  if (node.isGridContainer) return layoutGridContainer;
  if (node.isInlineFormattingContext) return layoutInlineContent;
  if (node.isTableRow) return layoutTableRow;
  return layoutBlockContainer;
}
