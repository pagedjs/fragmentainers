import { ConstraintSpace } from "../fragmentation/constraint-space.js";
import { Fragment } from "../fragmentation/fragment.js";
import { CounterState, walkFragmentTree } from "../fragmentation/counter-state.js";
import {
	resolveForcedBreakValue,
	resolveNextPageBreakBefore,
	requiredPageSide,
	isSideSpecificBreak,
} from "../resolvers/page-resolver.js";
import { BlockContainerAlgorithm } from "../algorithms/block-container.js";
import { FlexAlgorithm } from "../algorithms/flex-container.js";
import { GridAlgorithm } from "../algorithms/grid-container.js";
import { InlineContentAlgorithm } from "../algorithms/inline-content.js";
import { MulticolAlgorithm } from "../algorithms/multicol-container.js";
import { TableRowAlgorithm } from "../algorithms/table-row.js";

const MAX_ZERO_PROGRESS = 5;

/**
 * Runs a layout algorithm to completion, recursively fulfilling
 * any child LayoutRequests it yields.
 *
 * @param {Object} algorithm - Algorithm instance with a *layout() generator method
 */
export function runLayoutGenerator(algorithm) {
	const gen = algorithm.layout();
	let genResult = gen.next();

	while (!genResult.done) {
		const request = genResult.value;

		const ChildAlgoClass = getLayoutAlgorithm(request.node);
		const childAlgo = new ChildAlgoClass(
			request.node,
			request.constraintSpace,
			request.breakToken,
		);
		const childResult = runLayoutGenerator(childAlgo);

		// Propagate earlyBreak signal up to the driver immediately
		if (childResult.earlyBreak) return childResult;

		// Send the child's result back into the parent generator
		genResult = gen.next(childResult);
	}

	return genResult.value;
}

/**
 * Dispatch to the correct layout algorithm class based on node type.
 */
export function getLayoutAlgorithm(node) {
	if (node.isMulticolContainer) return MulticolAlgorithm;
	if (node.isFlexContainer) return FlexAlgorithm;
	if (node.isGridContainer) return GridAlgorithm;
	if (node.isInlineFormattingContext) return InlineContentAlgorithm;
	if (node.isTableRow) return TableRowAlgorithm;
	return BlockContainerAlgorithm;
}

/**
 * Top-level fragmentainer driver — produces one Fragment per iteration step.
 *
 * Implements two consumer APIs over the same iteration:
 *
 * - **Iterator protocol** (`for (const fragment of driver)`): each `next()`
 *   call lays out one fragmentainer and returns its Fragment. The driver
 *   handles blank-page insertion (for side-specific breaks), constraint
 *   resolution, two-pass earlyBreak retry, counter-state accumulation, and
 *   a zero-progress safety guard.
 *
 * - **Batch API** (`driver.run()`): drives iteration to completion and
 *   returns either a flat `Fragment[]` (when no continuation was provided)
 *   or `{ fragments, continuation }` (when continuation was provided).
 *   Preserves the return-shape contract of the legacy `createFragments`.
 */
export class LayoutDriver extends Iterator {
	#rootNode;
	#constraintSpaceOrResolver;
	#useResolver;
	#continuation;
	#startIndex;
	#startOffset;

	// Iteration state (mutated by next())
	#breakToken = null;
	#fragmentainerIndex;
	#continueAfterBlank = false;
	#zeroProgressCount = 0;
	#counterState = new CounterState();
	#done = false;
	#prevFragmentBreakToken = null;

	constructor(rootNode, constraintSpaceOrResolver, continuation = null) {
		super();
		this.#rootNode = rootNode;
		this.#constraintSpaceOrResolver = constraintSpaceOrResolver;
		this.#useResolver = typeof constraintSpaceOrResolver?.resolve === "function";
		this.#continuation = continuation;
		this.#startIndex = continuation?.fragmentainerIndex ?? 0;
		this.#startOffset = continuation?.blockOffset ?? 0;
		this.#fragmentainerIndex = this.#startIndex;
	}

	next() {
		if (this.#done) return { done: true, value: undefined };

		// End condition: iteration has run at least once, no break token pending,
		// and no blank-page continuation in flight.
		if (
			this.#breakToken === null &&
			this.#fragmentainerIndex > this.#startIndex &&
			!this.#continueAfterBlank
		) {
			this.#done = true;
			return { done: true, value: undefined };
		}

		// Clear blank-page continuation flag; the blank-page branch below
		// will re-arm it if it fires this iteration.
		this.#continueAfterBlank = false;

		const blankFragment = this.#maybeBuildBlankFragment();
		if (blankFragment) {
			this.#continueAfterBlank = true;
			this.#fragmentainerIndex++;
			return { done: false, value: blankFragment };
		}

		const { constraintSpace, constraints } = this.#resolveConstraintSpace();
		const result = this.#runLayoutPass(constraintSpace);

		if (constraints) result.fragment.constraints = constraints;

		this.#updateCounterState(result);
		this.#breakToken = result.breakToken;

		// Record this fragment's breakToken so the NEXT iteration's counter-state
		// walk can read it as `prevBT`. Matches the legacy lookup of
		// `fragments[fragments.length - 2]?.breakToken`.
		this.#prevFragmentBreakToken = result.fragment.breakToken ?? null;
		this.#fragmentainerIndex++;

		// Zero-progress guard. The current fragment is still emitted; if the
		// threshold is hit the NEXT next() call returns { done: true }.
		this.#checkProgress(result);

		return { done: false, value: result.fragment };
	}

	run() {
		const fragments = [...this];
		if (this.#continuation !== null) {
			return { fragments, continuation: this.#finalContinuation(fragments) };
		}
		return fragments;
	}

	#maybeBuildBlankFragment() {
		if (!this.#useResolver || !this.#constraintSpaceOrResolver.isVerso) return null;

		let sideValue = resolveForcedBreakValue(this.#breakToken);
		if (!isSideSpecificBreak(sideValue)) {
			const nextBreakBefore = resolveNextPageBreakBefore(this.#rootNode, this.#breakToken);
			if (isSideSpecificBreak(nextBreakBefore)) {
				sideValue = nextBreakBefore;
			} else {
				sideValue = null;
			}
		}
		const side = requiredPageSide(sideValue);
		if (side === null) return null;

		const isLeft = this.#constraintSpaceOrResolver.isVerso(this.#fragmentainerIndex);
		const currentSide = isLeft ? "left" : "right";
		if (currentSide === side) return null;

		const blankConstraints = this.#constraintSpaceOrResolver.resolve(
			this.#fragmentainerIndex,
			this.#rootNode,
			this.#breakToken,
			true,
		);
		const blankFragment = new Fragment(this.#rootNode, 0);
		blankFragment.isBlank = true;
		blankFragment.constraints = blankConstraints;
		blankFragment.breakToken = this.#breakToken;
		return blankFragment;
	}

	#resolveConstraintSpace() {
		let constraintSpace;
		let constraints = null;

		if (this.#useResolver) {
			constraints = this.#constraintSpaceOrResolver.resolve(
				this.#fragmentainerIndex,
				this.#rootNode,
				this.#breakToken,
			);
			constraintSpace = constraints.toConstraintSpace();
		} else {
			constraintSpace = this.#constraintSpaceOrResolver;
		}

		// Adjust first fragmentainer's offset when continuing from a previous element
		if (this.#fragmentainerIndex === this.#startIndex && this.#startOffset > 0) {
			constraintSpace = new ConstraintSpace({
				availableInlineSize: constraintSpace.availableInlineSize,
				availableBlockSize: constraintSpace.fragmentainerBlockSize - this.#startOffset,
				fragmentainerBlockSize: constraintSpace.fragmentainerBlockSize,
				blockOffsetInFragmentainer: this.#startOffset,
				fragmentationType: constraintSpace.fragmentationType,
				isNewFormattingContext: constraintSpace.isNewFormattingContext,
			});
		}

		return { constraintSpace, constraints };
	}

	#runLayoutPass(constraintSpace) {
		const RootAlgoClass = getLayoutAlgorithm(this.#rootNode);

		let result = runLayoutGenerator(
			new RootAlgoClass(this.#rootNode, constraintSpace, this.#breakToken),
		);

		// Two-pass: if layout returned an earlyBreak, re-run with it as target
		if (result.earlyBreak) {
			result = runLayoutGenerator(
				new RootAlgoClass(this.#rootNode, constraintSpace, this.#breakToken, result.earlyBreak),
			);
		}

		return result;
	}

	#updateCounterState(result) {
		walkFragmentTree(result.fragment, this.#prevFragmentBreakToken, this.#counterState);
		if (!this.#counterState.isEmpty()) {
			result.fragment.counterState = this.#counterState.snapshot();
		}
	}

	#checkProgress(result) {
		// Real DOM content can have 0-height elements (images not yet loaded,
		// empty containers, absolutely positioned children). Allow a few
		// consecutive zero-progress fragmentainers, then bail.
		if (this.#breakToken && result.fragment.blockSize === 0) {
			this.#zeroProgressCount++;
			if (this.#zeroProgressCount >= MAX_ZERO_PROGRESS) {
				console.warn(
					`Fragmentainer: stopped after ${MAX_ZERO_PROGRESS} consecutive zero-progress fragmentainers at index ${this.#fragmentainerIndex}`,
				);
				this.#done = true;
			}
		} else {
			this.#zeroProgressCount = 0;
		}
	}

	#finalContinuation(fragments) {
		const lastFragment = fragments[fragments.length - 1];
		const lastIndex = this.#startIndex + fragments.length - 1;
		const lastOffset = lastFragment
			? lastFragment.blockSize + (fragments.length === 1 ? this.#startOffset : 0)
			: 0;
		const pageBlockSize =
			lastFragment?.constraints?.contentArea?.blockSize ??
			this.#constraintSpaceOrResolver?.fragmentainerBlockSize ??
			0;

		return {
			fragmentainerIndex: lastOffset >= pageBlockSize ? lastIndex + 1 : lastIndex,
			blockOffset: lastOffset >= pageBlockSize ? 0 : lastOffset,
		};
	}
}
