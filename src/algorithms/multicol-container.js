import { BlockBreakToken } from "../fragmentation/tokens.js";
import { ConstraintSpace } from "../fragmentation/constraint-space.js";
import { Fragment } from "../fragmentation/fragment.js";
import { FlowThreadNode } from "../layout/flow-thread-node.js";
import { LayoutRequest } from "../layout/layout-request.js";
import { FRAGMENTATION_COLUMN, FRAGMENTATION_NONE } from "../fragmentation/constraint-space.js";

export const ALGORITHM_MULTICOL = "MulticolData";

/**
 * CSS Multicol §3 pseudo-algorithm.
 * Resolves used column count and width from CSS properties and container width.
 *
 * @param {number} U - Container's content box inline-size
 * @param {number|null} specifiedWidth - column-width value (null = auto)
 * @param {number|null} specifiedCount - column-count value (null = auto)
 * @param {number} gap - column-gap value in px
 * @returns {{ count: number, width: number }}
 */
export function resolveColumnDimensions(U, specifiedWidth, specifiedCount, gap) {
	// Both auto → single column
	if (specifiedWidth == null && specifiedCount == null) {
		return { count: 1, width: U };
	}

	let N, W;

	if (specifiedWidth != null && specifiedCount == null) {
		// Only column-width specified — width is a minimum
		N = Math.max(1, Math.floor((U + gap) / (specifiedWidth + gap)));
		W = (U - (N - 1) * gap) / N;
	} else if (specifiedWidth == null && specifiedCount != null) {
		// Only column-count specified
		N = specifiedCount;
		W = Math.max(0, (U - (N - 1) * gap) / N);
	} else {
		// Both specified — column-count acts as maximum
		N = Math.min(specifiedCount, Math.max(1, Math.floor((U + gap) / (specifiedWidth + gap))));
		W = (U - (N - 1) * gap) / N;
	}

	return { count: N, width: W };
}

/**
 * Multicol container layout algorithm.
 *
 * Resolves column dimensions, creates an anonymous flow thread,
 * and runs a column loop where each iteration is a column fragmentainer.
 * Mirrors Chromium's NGColumnLayoutAlgorithm.
 */
export class MulticolAlgorithm {
	#node;
	#constraintSpace;
	#breakToken;
	// earlyBreakTarget is part of the algorithm constructor protocol but
	// multicol doesn't run Class A break scoring — accepted for parity.
	// eslint-disable-next-line no-unused-private-class-members
	#earlyBreakTarget;

	// Resolved during #setup, consumed in layoutColumnLoop and #buildOutput
	#count;
	#width;
	#gap;
	#columnHeight;
	#columnCS;
	#flowThread;

	// Cross-iteration state (collected during the column loop, consumed in output)
	#columnFragments = [];
	#contentToken;

	constructor(node, constraintSpace, breakToken, earlyBreakTarget = null) {
		this.#node = node;
		this.#constraintSpace = constraintSpace;
		this.#breakToken = breakToken;
		this.#earlyBreakTarget = earlyBreakTarget;
	}

	*layout() {
		this.#setup();
		yield* this.layoutColumnLoop();
		return this.#buildOutput();
	}

	#setup() {
		const containerInlineSize = this.#constraintSpace.availableInlineSize;
		this.#gap = this.#node.columnGap ?? 0;

		// Resolve column count and width (CSS Multicol §3)
		const { count, width } = resolveColumnDimensions(
			containerInlineSize,
			this.#node.columnWidth,
			this.#node.columnCount,
			this.#gap,
		);
		this.#count = count;
		this.#width = width;

		// Determine column height from available block space
		this.#columnHeight = this.#constraintSpace.availableBlockSize;

		// Build column constraint space
		this.#columnCS = new ConstraintSpace({
			availableInlineSize: this.#width,
			availableBlockSize: this.#columnHeight,
			fragmentainerBlockSize: this.#columnHeight,
			blockOffsetInFragmentainer: 0,
			fragmentationType: FRAGMENTATION_COLUMN,
			isNewFormattingContext: true,
		});

		// Create anonymous flow thread (Chromium pattern — avoids recursion)
		this.#flowThread = new FlowThreadNode(this.#node);

		// Resume content token from previous outer fragmentainer
		this.#contentToken = this.#breakToken?.childBreakTokens?.[0] ?? null;
	}

	*layoutColumnLoop() {
		do {
			const result = yield new LayoutRequest(
				this.#flowThread,
				this.#columnCS,
				this.#contentToken,
			);

			this.#columnFragments.push(result.fragment);
			this.#contentToken = result.breakToken;

			// column-fill: auto — stop at column count limit
			if (this.#node.columnFill === "auto" && this.#columnFragments.length >= this.#count) {
				break;
			}
		} while (this.#contentToken !== null);
	}

	#buildMulticolBreakToken(multicolBlockSize) {
		const token = new BlockBreakToken(this.#node);
		token.consumedBlockSize = (this.#breakToken?.consumedBlockSize || 0) + multicolBlockSize;
		token.sequenceNumber = (this.#breakToken?.sequenceNumber ?? -1) + 1;
		token.childBreakTokens = [this.#contentToken];
		token.hasSeenAllChildren = false;
		token.algorithmData = {
			type: ALGORITHM_MULTICOL,
			columnCount: this.#count,
			columnWidth: this.#width,
			columnGap: this.#gap,
		};
		return token;
	}

	#buildOutput() {
		const multicolBlockSize =
			this.#columnHeight === Infinity
				? Math.max(...this.#columnFragments.map((f) => f.blockSize), 0)
				: this.#columnHeight;

		const fragment = new Fragment(this.#node, multicolBlockSize, this.#columnFragments);
		fragment.inlineSize = this.#constraintSpace.availableInlineSize;
		fragment.multicolData = {
			columnWidth: this.#width,
			columnGap: this.#gap,
			columnCount: this.#count,
		};

		// Break token if content remains and we're in an outer fragmentation context
		// (stub: emitted but nested column-in-page re-resolution not yet handled)
		if (
			this.#contentToken !== null &&
			this.#constraintSpace.fragmentationType !== FRAGMENTATION_NONE
		) {
			fragment.breakToken = this.#buildMulticolBreakToken(multicolBlockSize);
		}

		return { fragment, breakToken: fragment.breakToken || null };
	}
}
