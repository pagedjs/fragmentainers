import { BlockBreakToken } from "../core/tokens.js";
import { ConstraintSpace } from "../core/constraint-space.js";
import { PhysicalFragment } from "../core/fragment.js";
import { layoutChild } from "../core/layout-request.js";
import { findChildBreakToken, isMonolithic, getMonolithicBlockSize } from "../core/helpers.js";
import {
	EarlyBreak,
	BreakScore,
	scoreClassABreak,
	isBetterBreak,
	applyBreakInsideAvoid,
} from "../core/break-scoring.js";
import {
	FRAGMENTATION_NONE,
	FRAGMENTATION_PAGE,
	BOX_DECORATION_CLONE,
	EARLY_BREAK_BEFORE,
	EARLY_BREAK_INSIDE,
} from "../core/constants.js";
import { modules } from "../modules/index.js";

// Skip break scoring when cumulative child content fills less than
// this fraction of the fragmentainer — children this far from the
// boundary can't be the optimal break point.
const SCORING_SKIP_THRESHOLD = 0.75;

/**
 * Core block container layout algorithm (generator).
 *
 * Lays out block-level children sequentially. Yields a LayoutRequest
 * for each child; the driver fulfills it by running the child's layout
 * generator and returning the result via generator.next(result).
 *
 * When block fragmentation is active, stops at fragmentainer boundaries
 * and produces a BlockBreakToken for continuation.
 *
 * Two-pass break scoring:
 * - Pass 1: Track best EarlyBreak at each Class A breakpoint. If the
 *   actual break is worse, return { earlyBreak } to signal re-layout.
 * - Pass 2: When earlyBreakTarget is provided, break at the designated
 *   node instead of waiting for space exhaustion.
 */
export function* layoutBlockContainer(node, constraintSpace, breakToken, earlyBreakTarget = null) {
	const children = node.children;

	// Leaf node — use intrinsic block size, no children to iterate.
	if (children.length === 0) {
		const intrinsicBlockSize = node.blockSize || 0;
		const consumed = breakToken?.consumedBlockSize || 0;
		const remaining = intrinsicBlockSize - consumed;

		// Monolithic elements are normally placed whole or pushed by parent.
		// Last resort (CSS Fragmentation §4.4): in page mode, slice at the
		// fragmentainer boundary when the element exceeds the full page.
		if (isMonolithic(node)) {
			const availableSpace =
				constraintSpace.availableBlockSize > 0
					? constraintSpace.availableBlockSize
					: constraintSpace.fragmentainerBlockSize - constraintSpace.blockOffsetInFragmentainer;

			if (
				constraintSpace.fragmentationType === FRAGMENTATION_PAGE &&
				remaining > availableSpace &&
				availableSpace > 0
			) {
				const fragment = new PhysicalFragment(node, availableSpace);
				fragment.inlineSize = constraintSpace.availableInlineSize;
				const token = new BlockBreakToken(node);
				token.consumedBlockSize = consumed + availableSpace;
				token.sequenceNumber = (breakToken?.sequenceNumber ?? -1) + 1;
				token.hasSeenAllChildren = true;
				fragment.breakToken = token;
				return { fragment, breakToken: token };
			}

			const fragment = new PhysicalFragment(node, remaining);
			fragment.inlineSize = constraintSpace.availableInlineSize;
			return { fragment, breakToken: null };
		}

		// Non-monolithic leaves can fragment across fragmentainers.
		// Use availableBlockSize (accounts for ancestor padding/border reservations).
		const availableSpace =
			constraintSpace.availableBlockSize > 0
				? constraintSpace.availableBlockSize
				: constraintSpace.fragmentainerBlockSize - constraintSpace.blockOffsetInFragmentainer;

		if (
			constraintSpace.fragmentationType !== FRAGMENTATION_NONE &&
			remaining > availableSpace &&
			availableSpace > 0
		) {
			const fragment = new PhysicalFragment(node, availableSpace);
			fragment.inlineSize = constraintSpace.availableInlineSize;
			const token = new BlockBreakToken(node);
			token.consumedBlockSize = consumed + availableSpace;
			token.sequenceNumber = (breakToken?.sequenceNumber ?? -1) + 1;
			token.hasSeenAllChildren = true;
			fragment.breakToken = token;
			return { fragment, breakToken: token };
		}

		const fragment = new PhysicalFragment(node, remaining);
		fragment.inlineSize = constraintSpace.availableInlineSize;
		return { fragment, breakToken: null };
	}

	const childFragments = [];
	const childBreakTokens = [];
	let hasSeenAllChildren = false;
	let startIndex = 0;
	let bestEarlyBreak = null;

	if (breakToken) {
		// Resumption: skip children before the first child break token.
		const firstChildToken = breakToken.childBreakTokens[0];
		if (firstChildToken) {
			startIndex = children.indexOf(firstChildToken.node);
			if (startIndex === -1) startIndex = 0;
		}
	}

	// Container's own box insets (padding + border)
	const containerBoxStart = (node.paddingBlockStart || 0) + (node.borderBlockStart || 0);
	const containerBoxEnd = (node.paddingBlockEnd || 0) + (node.borderBlockEnd || 0);

	// Start blockOffset at the container's top padding+border.
	// For slice (default): only on first fragment.
	// For clone: on every fragment (repeated decorations).
	const isClone = node.boxDecorationBreak === BOX_DECORATION_CLONE;
	let blockOffset = breakToken && !isClone ? 0 : containerBoxStart;

	// Track previous child's margin-end for collapsing with next child's margin-start
	let prevChildMarginEnd = 0;

	// Effective start of this container within the fragmentainer
	const containerOffsetInFragmentainer = constraintSpace.blockOffsetInFragmentainer;

	// Check if earlyBreakTarget points into this node
	let earlyBreakForChild = null;
	if (
		earlyBreakTarget &&
		earlyBreakTarget.node === node &&
		earlyBreakTarget.type === EARLY_BREAK_INSIDE
	) {
		earlyBreakForChild = earlyBreakTarget.childEarlyBreak;
	}

	let prependedFragments = 0;
	const beforeResult = modules.beforeChildren(node, constraintSpace, breakToken);
	if (beforeResult) {
		const result = yield layoutChild(beforeResult.node, beforeResult.constraintSpace, null);
		if (beforeResult.isRepeated) result.fragment.isRepeated = true;
		if (beforeResult.node.blockSize > result.fragment.blockSize) {
			result.fragment.blockSize = beforeResult.node.blockSize;
		}
		childFragments.push(result.fragment);
		prependedFragments = 1;
		blockOffset += result.fragment.blockSize;
	}

	for (let i = startIndex; i < children.length; i++) {
		const child = children[i];
		const childBreakToken = findChildBreakToken(breakToken, child);

		// Skip completed children when all have been visited
		if (!childBreakToken && breakToken?.hasSeenAllChildren) {
			continue;
		}

		// Skip children claimed by a layout module (e.g. page floats)
		if (modules.claim(child)) continue;

		// isBreakBefore means "pushed to this fragmentainer, lay out fresh"
		const effectiveChildBreakToken = childBreakToken?.isBreakBefore ? null : childBreakToken;

		// Add child's margin-before (collapsed with previous child's margin-end)
		const childMarginBefore = child.marginBlockStart || 0;
		const blockOffsetBeforeMargin = blockOffset;
		if (i === startIndex && !breakToken) {
			// First child on first fragment: add full margin
			blockOffset += childMarginBefore;
		} else if (i > startIndex) {
			// Adjacent siblings: collapse margins (use the larger of the two)
			blockOffset += Math.max(childMarginBefore, prevChildMarginEnd);
			prevChildMarginEnd = 0; // consumed by collapsing
		}

		// If the margin pushed us past the fragmentainer boundary, undo it and push
		// this child to the next fragmentainer. Margins adjoining a break are truncated.
		if (
			constraintSpace.fragmentationType !== FRAGMENTATION_NONE &&
			containerOffsetInFragmentainer + blockOffset >= constraintSpace.fragmentainerBlockSize &&
			childFragments.length > 0
		) {
			blockOffset = blockOffsetBeforeMargin;
			childBreakTokens.push(BlockBreakToken.createBreakBefore(child, false));
			break;
		}

		// Reserve space for container's bottom box inset when computing remaining space
		const remainingSpace =
			constraintSpace.fragmentainerBlockSize -
			containerOffsetInFragmentainer -
			blockOffset -
			containerBoxEnd;

		// Pass 2: if earlyBreakTarget says "break before this child", do it now
		if (
			earlyBreakForChild &&
			earlyBreakForChild.node === child &&
			earlyBreakForChild.type === EARLY_BREAK_BEFORE &&
			blockOffset > 0
		) {
			childBreakTokens.push(BlockBreakToken.createBreakBefore(child, false));
			break;
		}

		// Track Class A breakpoint score (between siblings).
		// Fast-path: when cumulative heights show this child is well within
		// the fragmentainer (< 75% full), skip break scoring — no chance of
		// this being the best break point.
		if (
			constraintSpace.fragmentationType !== FRAGMENTATION_NONE &&
			i > startIndex &&
			blockOffset > 0
		) {
			const cum = node.cumulativeHeights;
			const skipScoring =
				cum &&
				!earlyBreakTarget &&
				cum[i + 1] - cum[startIndex] + containerBoxStart <
					(constraintSpace.fragmentainerBlockSize - containerOffsetInFragmentainer) *
						SCORING_SKIP_THRESHOLD;

			if (!skipScoring) {
				const prevChild = children[i - 1];
				let score = scoreClassABreak(prevChild, child);
				score = applyBreakInsideAvoid(node, score);

				const candidate = new EarlyBreak(child, score, EARLY_BREAK_BEFORE);
				if (isBetterBreak(candidate, bestEarlyBreak)) {
					bestEarlyBreak = candidate;
				}
			}
		}

		// Forced break-before: break-before: page|column|always
		const breakBefore = child.breakBefore;
		if (
			breakBefore &&
			breakBefore !== "auto" &&
			breakBefore !== "avoid" &&
			!effectiveChildBreakToken &&
			blockOffset > 0
		) {
			const forcedToken = BlockBreakToken.createBreakBefore(child, true, breakBefore);
			childBreakTokens.push(forcedToken);
			break;
		}

		// Named page change forces a page break (CSS Paged Media §3)
		if (
			constraintSpace.fragmentationType === FRAGMENTATION_PAGE &&
			i > startIndex &&
			!effectiveChildBreakToken &&
			blockOffset > 0
		) {
			const prevPage = children[i - 1].page || null;
			const thisPage = child.page || null;
			if (prevPage !== thisPage && (thisPage !== null || prevPage !== null)) {
				childBreakTokens.push(BlockBreakToken.createBreakBefore(child, true));
				break;
			}
		}

		// Monolithic content: push or overflow
		if (isMonolithic(child) && !effectiveChildBreakToken) {
			const childSize = getMonolithicBlockSize(child, constraintSpace);
			if (childSize > remainingSpace && blockOffset > 0) {
				const pushToken = BlockBreakToken.createBreakBefore(child, false);
				childBreakTokens.push(pushToken);
				break;
			}
		}

		// break-inside: avoid elements (e.g. tables): push to next
		// fragmentainer when they don't fit, rather than stranding a
		// header row alone at the bottom of the page.
		if (
			!isMonolithic(child) &&
			child.breakInside === "avoid" &&
			!effectiveChildBreakToken &&
			blockOffset > 0
		) {
			const childSize = child.blockSize || 0;
			if (childSize > remainingSpace) {
				childBreakTokens.push(BlockBreakToken.createBreakBefore(child, false));
				break;
			}
		}

		// Build constraint space for the child
		const childConstraint = new ConstraintSpace({
			availableInlineSize: constraintSpace.availableInlineSize,
			availableBlockSize: remainingSpace,
			fragmentainerBlockSize: constraintSpace.fragmentainerBlockSize,
			blockOffsetInFragmentainer: containerOffsetInFragmentainer + blockOffset,
			fragmentationType: constraintSpace.fragmentationType,
		});

		// Yield layout request — driver runs child generator and returns result
		const result = yield layoutChild(child, childConstraint, effectiveChildBreakToken);

		childFragments.push(result.fragment);
		blockOffset += result.fragment.blockSize;

		// Track this child's margin-end for collapsing with the next sibling
		prevChildMarginEnd = child.marginBlockEnd || 0;

		if (result.breakToken) {
			// Track break quality from child (e.g. orphans/widows violation,
			// or break-inside: avoid being violated)
			if (result.breakScore != null && result.breakScore > BreakScore.PERFECT) {
				let childScore = applyBreakInsideAvoid(node, result.breakScore);
				const candidate = new EarlyBreak(child, childScore, EARLY_BREAK_INSIDE);
				if (isBetterBreak(candidate, bestEarlyBreak)) {
					bestEarlyBreak = candidate;
				}
			}

			// Child broke — record its break token and stop
			childBreakTokens.push(result.breakToken);
			break;
		}

		// Forced break-after: break-after: page|column|always
		const breakAfter = child.breakAfter;
		if (breakAfter && breakAfter !== "auto" && breakAfter !== "avoid" && i < children.length - 1) {
			childBreakTokens.push(BlockBreakToken.createBreakBefore(children[i + 1], true, breakAfter));
			break;
		}

		// Check if we've exceeded fragmentainer space
		if (
			constraintSpace.fragmentationType !== FRAGMENTATION_NONE &&
			containerOffsetInFragmentainer + blockOffset >= constraintSpace.fragmentainerBlockSize
		) {
			if (i < children.length - 1) {
				// Space exhausted — check if we should use a better earlier break
				const exhaustionScore = scoreClassABreak(child, children[i + 1]);
				const adjustedScore = applyBreakInsideAvoid(node, exhaustionScore);

				if (bestEarlyBreak && bestEarlyBreak.score < adjustedScore) {
					// A better break exists earlier — signal re-layout
					const earlyBreak = new EarlyBreak(node, bestEarlyBreak.score, EARLY_BREAK_INSIDE);
					earlyBreak.childEarlyBreak = bestEarlyBreak;
					return { fragment: null, breakToken: null, earlyBreak };
				}

				childBreakTokens.push(BlockBreakToken.createBreakBefore(children[i + 1], false));
				break;
			}
		}
	}

	hasSeenAllChildren =
		childBreakTokens.length === 0 ||
		startIndex + childFragments.length - prependedFragments >= children.length;

	// Add the last child's trailing margin (was deferred for collapsing with next sibling).
	// Per CSS Fragmentation: margins adjoining a break are truncated to zero.
	if (prevChildMarginEnd > 0 && childFragments.length > 0 && childBreakTokens.length === 0) {
		blockOffset += prevChildMarginEnd;
	}

	// Add container's bottom padding+border.
	// For slice: only on final fragment (all children placed, no break).
	// For clone: on every fragment (repeated decorations).
	if (
		(hasSeenAllChildren && childBreakTokens.length === 0) ||
		(isClone && childBreakTokens.length > 0)
	) {
		blockOffset += containerBoxEnd;
	}

	// If no children contributed height but the browser measures a non-zero
	// height (e.g. from CSS pseudo-elements, list markers, min-height), use
	// the measured height as a floor. Only applies when children were laid out
	// but all produced zero blockSize.
	const boxStartIncluded = !breakToken || isClone ? containerBoxStart : 0;
	const boxEndIncluded =
		(hasSeenAllChildren && childBreakTokens.length === 0) ||
		(isClone && childBreakTokens.length > 0)
			? containerBoxEnd
			: 0;
	const contentHeight = blockOffset - boxStartIncluded - boxEndIncluded;
	if (contentHeight === 0 && childFragments.length > 0 && node.element) {
		const measuredHeight = node.blockSize;
		if (measuredHeight > blockOffset) {
			blockOffset = measuredHeight;
		}
	}

	// Empty container: no child produced visible content, all remaining
	// children were pushed. Zero out blockOffset so this fragment doesn't
	// consume space (avoids rendering an empty padding/border shell).
	// Covers both the case where no children were placed at all and the
	// case where children were placed but all have zero blockSize (e.g.
	// an <li> inline FC that had no room for even one line of text).
	if (childBreakTokens.length > 0 && !childFragments.some((f) => f.blockSize > 0)) {
		blockOffset = 0;
	}

	// Build the output fragment
	const fragment = new PhysicalFragment(node, blockOffset, childFragments);
	fragment.inlineSize = constraintSpace.availableInlineSize;

	// Build break token if the container needs to continue
	const needsBreakToken = childBreakTokens.length > 0 || !hasSeenAllChildren;
	if (needsBreakToken) {
		const containerToken = new BlockBreakToken(node);
		containerToken.consumedBlockSize = (breakToken?.consumedBlockSize || 0) + blockOffset;
		containerToken.sequenceNumber = (breakToken?.sequenceNumber ?? -1) + 1;
		containerToken.childBreakTokens = childBreakTokens;
		containerToken.hasSeenAllChildren = hasSeenAllChildren;
		fragment.breakToken = containerToken;
	}

	return { fragment, breakToken: fragment.breakToken || null };
}
