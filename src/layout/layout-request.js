import { ConstraintSpace } from "../fragmentation/constraint-space.js";
import { Fragment } from "../fragmentation/fragment.js";
import { CounterState, walkFragmentTree } from "../fragmentation/counter-state.js";
import {
	resolveForcedBreakValue,
	resolveNextPageBreakBefore,
	requiredPageSide,
	isSideSpecificBreak,
} from "../resolvers/page-resolver.js";
import { layoutBlockContainer } from "./block-container.js";
import { layoutFlexContainer } from "./flex-container.js";
import { layoutGridContainer } from "./grid-container.js";
import { layoutInlineContent } from "../fragmentation/inline-content.js";
import { layoutMulticolContainer } from "./multicol-container.js";
import { layoutTableRow } from "./table-row.js";

/**
 * Yielded from layout generators to the driver.
 * Represents a request to lay out a child node.
 */
export class LayoutRequest {
	constructor(node, constraintSpace, breakToken = null) {
		this.node = node;
		this.constraintSpace = constraintSpace;
		this.breakToken = breakToken;
	}
}

/**
 * Helper to create a LayoutRequest — used inside layout generators.
 */
export function layoutChild(node, constraintSpace, breakToken = null) {
	return new LayoutRequest(node, constraintSpace, breakToken);
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
export function runLayoutGenerator(
	generatorFn,
	node,
	constraintSpace,
	breakToken,
	earlyBreakTarget = null,
) {
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
			request.breakToken,
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
 * @returns {import('./fragment.js').Fragment[]|{ fragments: import('./fragment.js').Fragment[], continuation: { fragmentainerIndex: number, blockOffset: number } }}
 *   When continuation is null: returns a flat array (backwards compatible).
 *   When continuation is provided: returns { fragments, continuation } with final state.
 */
export function createFragments(rootNode, constraintSpaceOrResolver, continuation = null) {
	const useResolver = typeof constraintSpaceOrResolver?.resolve === "function";
	const fragments = [];
	let breakToken = null;
	let zeroProgressCount = 0;
	const MAX_ZERO_PROGRESS = 5;
	const counterState = new CounterState();

	const startIndex = continuation?.fragmentainerIndex ?? 0;
	const startOffset = continuation?.blockOffset ?? 0;
	let continueAfterBlank = false;

	for (
		let fragmentainerIndex = startIndex;
		breakToken !== null || fragmentainerIndex === startIndex || continueAfterBlank;
		fragmentainerIndex++
	) {
		continueAfterBlank = false;

		// Check if a side-specific break requires a blank page
		if (useResolver && constraintSpaceOrResolver.isLeftPage) {
			let sideValue = resolveForcedBreakValue(breakToken);
			if (!isSideSpecificBreak(sideValue)) {
				const nextBreakBefore = resolveNextPageBreakBefore(rootNode, breakToken);
				if (isSideSpecificBreak(nextBreakBefore)) {
					sideValue = nextBreakBefore;
				} else {
					sideValue = null;
				}
			}
			const side = requiredPageSide(sideValue);
			if (side !== null) {
				const isLeft = constraintSpaceOrResolver.isLeftPage(fragmentainerIndex);
				const currentSide = isLeft ? "left" : "right";
				if (currentSide !== side) {
					const blankConstraints = constraintSpaceOrResolver.resolve(
						fragmentainerIndex,
						rootNode,
						breakToken,
						true,
					);
					const blankFragment = new Fragment(rootNode, 0);
					blankFragment.isBlank = true;
					blankFragment.constraints = blankConstraints;
					blankFragment.breakToken = breakToken;
					fragments.push(blankFragment);
					continueAfterBlank = true;
					continue;
				}
			}
		}

		let constraintSpace;
		let constraints = null;

		if (useResolver) {
			constraints = constraintSpaceOrResolver.resolve(fragmentainerIndex, rootNode, breakToken);
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

		let result = runLayoutGenerator(rootAlgorithm, rootNode, constraintSpace, breakToken);

		// Two-pass: if layout returned an earlyBreak, re-run with it as target
		if (result.earlyBreak) {
			result = runLayoutGenerator(
				rootAlgorithm,
				rootNode,
				constraintSpace,
				breakToken,
				result.earlyBreak,
			);
		}

		if (constraints) {
			result.fragment.constraints = constraints;
		}

		fragments.push(result.fragment);
		breakToken = result.breakToken;

		// Accumulate counter state by walking this fragmentainer's fragment tree
		const prevBT =
			fragmentainerIndex > startIndex
				? (fragments[fragments.length - 2]?.breakToken ?? null)
				: null;
		walkFragmentTree(result.fragment, prevBT, counterState);
		if (!counterState.isEmpty()) {
			result.fragment.counterState = counterState.snapshot();
		}

		// Safety: guarantee progress. Real DOM content can have 0-height elements
		// (images not yet loaded, empty containers, absolutely positioned children).
		// Allow a few consecutive zero-progress fragmentainers, then bail.
		if (breakToken && result.fragment.blockSize === 0) {
			zeroProgressCount++;
			if (zeroProgressCount >= MAX_ZERO_PROGRESS) {
				console.warn(
					`Fragmentainer: stopped after ${MAX_ZERO_PROGRESS} consecutive zero-progress fragmentainers at index ${fragmentainerIndex + 1}`,
				);
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
		const lastOffset = lastFragment
			? lastFragment.blockSize + (fragments.length === 1 ? startOffset : 0)
			: 0;
		const pageBlockSize =
			lastFragment?.constraints?.contentArea?.blockSize ??
			constraintSpaceOrResolver?.fragmentainerBlockSize ??
			0;

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
