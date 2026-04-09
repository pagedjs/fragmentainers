/**
 * Margin collapsing — CSS2 §8.3.1 and CSS Fragmentation L3 §5.2.
 *
 * Adopts the LayoutNG MarginStrut concept: positive and negative margins
 * are tracked separately and resolved via max(positive) + min(negative).
 *
 * MarginState is the main entry point — instantiate one per block container
 * layout and call its methods at the documented points in the child loop.
 */

// ---------------------------------------------------------------------------
// MarginStrut — accumulator for a set of adjoining margins
// ---------------------------------------------------------------------------

/**
 * Tracks the largest positive and most-negative margins in a collapsing set.
 * Adopted from LayoutNG's margin strut pattern.
 *
 * CSS2 §8.3.1 collapse resolution:
 *   all positive  → max(positive margins)
 *   all negative  → min(negative margins)  (most negative)
 *   mixed         → max(positives) + min(negatives)
 */
export class MarginStrut {
	positiveMargin = 0;
	negativeMargin = 0;

	append(margin) {
		if (margin > 0) {
			this.positiveMargin = Math.max(this.positiveMargin, margin);
		} else if (margin < 0) {
			this.negativeMargin = Math.min(this.negativeMargin, margin);
		}
	}

	resolve() {
		return this.positiveMargin + this.negativeMargin;
	}
}

// ---------------------------------------------------------------------------
// collapseMargins — pairwise convenience
// ---------------------------------------------------------------------------

/**
 * Collapse two margins per CSS2 §8.3.1.
 * Convenience wrapper for the common two-margin case (e.g. speculative layout).
 *
 * @param {number} a
 * @param {number} b
 * @returns {number} The collapsed margin value
 */
export function collapseMargins(a, b) {
	if (a >= 0 && b >= 0) return Math.max(a, b);
	if (a <= 0 && b <= 0) return Math.min(a, b);
	return a + b;
}

// ---------------------------------------------------------------------------
// collectThroughMargins — multi-level through-collapse chain walking
// ---------------------------------------------------------------------------

/**
 * Walk the through-collapse chain starting from `node`, collecting margins
 * from first children that escape through nodes with no border/padding.
 *
 * CSS2 §8.3.1 / §3.2: a parent's margin-block-start collapses with its
 * first child's margin-block-start when the parent has no border-block-start
 * and no padding-block-start. This repeats recursively.
 *
 * Replaces the single-level `collapsedMarginBlockStart` getter that only
 * checked one level deep.
 *
 * @param {Object} node - LayoutNode to walk
 * @returns {number[]} Margins from the through-collapse chain (may be empty)
 */
export function collectThroughMargins(node) {
	const margins = [];
	let current = node;
	while (current.paddingBlockStart === 0 && current.borderBlockStart === 0) {
		const children = current.children;
		const first = children && children.length > 0 ? children[0] : null;
		if (!first) break;
		const m = first.marginBlockStart || 0;
		if (m !== 0) margins.push(m);
		current = first;
	}
	return margins;
}

// ---------------------------------------------------------------------------
// MarginState — stateful tracker for block container layout
// ---------------------------------------------------------------------------

/**
 * Tracks margin collapsing state during a single block container layout pass.
 *
 * Encapsulates CSS2 §8.3.1 (sibling collapse, through-collapse) and
 * CSS Fragmentation L3 §5.2 (margin truncation at fragmentation breaks).
 *
 * Usage: create one instance per layoutBlockContainer call, then call
 * methods at the documented points in the child loop.
 */
export class MarginState {
	/** Margin-end of previous sibling, pending collapse with next sibling */
	#prevMarginEnd = 0;
	/** Margin-end of the last placed child (for truncation marking) */
	#lastPlacedMarginEnd = 0;
	/** Body/slot margin-block-start for first-page collapsing */
	#bodyMarginBlockStart = 0;

	/**
	 * @param {number} [bodyMarginBlockStart=0] - Body margin for first-page
	 *   collapsing. Collapses with the first child's margin per CSS2 §8.3.1.
	 */
	constructor(bodyMarginBlockStart = 0) {
		this.#bodyMarginBlockStart = bodyMarginBlockStart;
	}

	/**
	 * Compute the margin contribution before laying out a child.
	 *
	 * Builds a MarginStrut from the child's own margin, any through-collapsed
	 * margins, and the previous sibling's margin-end. Resolves the strut to
	 * produce the margin delta for blockOffset.
	 *
	 * Three cases:
	 * 1. isFirstInLoop && isFirstFragment → first child on first fragment → add margin
	 * 2. !isFirstInLoop → sibling → collapse with previous sibling's margin-end
	 * 3. isFirstInLoop && !isFirstFragment → continuation first child → no margin
	 *    (margin truncated at break boundary, handled by truncateMarginBlockStart flag)
	 *
	 * @param {Object} child - The child layout node
	 * @param {Object} params
	 * @param {boolean} params.isFirstInLoop - First child being laid out this pass (i === startIndex)
	 * @param {boolean} params.isFirstFragment - No break token on the container
	 * @param {boolean} params.atFragmentainerTop - blockOffset is at fragmentainer top edge
	 * @returns {{
	 *   marginDelta: number,     - amount to add to blockOffset
	 *   collapsedThrough: number - through-collapse compensation value (for collapseAdj)
	 * }}
	 */
	computeMarginBefore(child, { isFirstInLoop, isFirstFragment, atFragmentainerTop }) {
		const throughMargins = collectThroughMargins(child);

		// Build strut with child's own margin + all through-collapsed margins
		const strut = new MarginStrut();
		strut.append(child.marginBlockStart || 0);
		for (const m of throughMargins) strut.append(m);

		// Compute what the child's own layout will add for collapseAdj.
		// This is the strut resolution of the through-margins alone — the
		// amount that will be added again inside the child when it processes
		// its own first grandchild.
		let collapsedThrough = 0;
		if (throughMargins.length > 0) {
			const throughStrut = new MarginStrut();
			for (const m of throughMargins) throughStrut.append(m);
			collapsedThrough = throughStrut.resolve();
		}

		let marginDelta = 0;

		if (isFirstInLoop && isFirstFragment) {
			// First child on first fragment. The body margin (slot margin from
			// UA defaults) collapses with the child's margin per CSS2 §8.3.1.
			// Like through-collapse, a body margin prevents fragmentainer-top
			// truncation — it's a rendering-level margin, not subject to §5.2.
			const hasBodyMargin = this.#bodyMarginBlockStart > 0;
			if (hasBodyMargin) strut.append(this.#bodyMarginBlockStart);

			if (atFragmentainerTop && throughMargins.length === 0 && !hasBodyMargin) {
				// No body margin, no through-collapse — child margin truncated (§5.2)
			} else {
				marginDelta = strut.resolve();
			}
		} else if (!isFirstInLoop) {
			// Adjacent siblings: collapse margins via strut
			strut.append(this.#prevMarginEnd);
			marginDelta = strut.resolve();
			this.#prevMarginEnd = 0; // consumed by collapsing
		}
		// else: isFirstInLoop && !isFirstFragment → continuation first child
		// → marginDelta stays 0 (margin truncated at break, handled by compositor)

		return { marginDelta, collapsedThrough };
	}

	/**
	 * Compute the collapse adjustment for the child's constraint space.
	 *
	 * When through-collapse is active, the parent already counted the
	 * through-margins in blockOffset. The child's own layout will also
	 * add them. Compensate by giving the child more space and adjusting
	 * its perceived position in the fragmentainer.
	 *
	 * @param {number} collapsedThrough - from computeMarginBefore result
	 * @param {boolean} isResumingChild - true if the child has an effective break token
	 * @returns {number} collapseAdj - add to availableBlockSize, subtract from blockOffsetInFragmentainer
	 */
	collapseAdjustment(collapsedThrough, isResumingChild) {
		return collapsedThrough !== 0 && !isResumingChild ? collapsedThrough : 0;
	}

	/**
	 * Update state after a child's layout result is received.
	 *
	 * @param {Object} child - The child layout node
	 * @param {number} collapsedThrough - from computeMarginBefore result
	 * @param {boolean} isResumingChild - true if the child had an effective break token
	 * @returns {number} amount to subtract from blockOffset (through-collapse compensation)
	 */
	applyAfterLayout(child, collapsedThrough, isResumingChild) {
		this.#prevMarginEnd = child.marginBlockEnd || 0;
		this.#lastPlacedMarginEnd = this.#prevMarginEnd;

		// Subtract through-collapse to avoid double-counting
		if (collapsedThrough !== 0 && !isResumingChild) {
			return collapsedThrough;
		}
		return 0;
	}

	/**
	 * Compute the trailing margin to add after the loop.
	 * The last child's margin-end was deferred for collapsing with the
	 * next sibling. If no break follows, add it now.
	 *
	 * @param {boolean} hasBreak - true if a break token was produced
	 * @param {boolean} hasChildren - true if any child fragments were placed
	 * @returns {number} trailing margin to add to blockOffset
	 */
	trailingMargin(hasBreak, hasChildren) {
		if (this.#prevMarginEnd !== 0 && hasChildren && !hasBreak) {
			return this.#prevMarginEnd;
		}
		return 0;
	}

	/**
	 * Check if the last placed child's margin-end should be truncated
	 * at a break boundary (CSS Fragmentation L3 §5.2).
	 *
	 * @param {boolean} hasBreak - true if there are pending break tokens
	 * @returns {boolean}
	 */
	shouldTruncateLastChildMarginEnd(hasBreak) {
		return hasBreak && this.#lastPlacedMarginEnd > 0;
	}

	/**
	 * Check if a child's margin-start should be truncated at a break boundary.
	 * Applies to the first child in a continuation fragment (not after forced breaks).
	 *
	 * @param {Object} params
	 * @param {boolean} params.isFirstChild - true if this is the first child laid out
	 * @param {boolean} params.hasBreakToken - true if the container has a break token (continuation)
	 * @param {number} params.childMarginBefore - the child's raw margin-block-start
	 * @param {boolean} params.isForcedBreak - true if the child break token is from a forced break
	 * @returns {boolean}
	 */
	shouldTruncateChildMarginStart({ isFirstChild, hasBreakToken, childMarginBefore, isForcedBreak }) {
		return isFirstChild && hasBreakToken && childMarginBefore > 0 && !isForcedBreak;
	}
}
