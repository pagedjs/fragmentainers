import { BlockBreakToken } from "../fragmentation/tokens.js";
import { ConstraintSpace } from "../fragmentation/constraint-space.js";
import { Fragment } from "../fragmentation/fragment.js";
import { LayoutRequest } from "../layout/layout-request.js";
import {
	findChildBreakToken,
	isAvoidBreakValue,
	isForcedBreakValue,
} from "../fragmentation/tokens.js";
import { isMonolithic, getMonolithicBlockSize } from "../layout/layout-helpers.js";
import {
	EarlyBreak,
	BreakScore,
	scoreClassABreak,
	isBetterBreak,
	applyBreakInsideAvoid,
	EARLY_BREAK_BEFORE,
	EARLY_BREAK_INSIDE,
} from "../fragmentation/break-scoring.js";
import {
	FRAGMENTATION_NONE,
	FRAGMENTATION_PAGE,
} from "../fragmentation/constraint-space.js";
import { BOX_DECORATION_CLONE } from "../layout/layout-node.js";
import { MarginState } from "../layout/margin-collapsing.js";
import { handlers } from "../handlers/index.js";

// Skip break scoring when cumulative child content fills less than
// this fraction of the fragmentainer — children this far from the
// boundary can't be the optimal break point.
const SCORING_SKIP_THRESHOLD = 0.75;

/**
 * Core block container layout algorithm.
 *
 * Lays out block-level children sequentially. The `*layout()` generator
 * yields a LayoutRequest for each child; the driver fulfills it by
 * running the child's layout generator and returning the result via
 * generator.next(result).
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
export class BlockContainerAlgorithm {
	// Inputs
	#node;
	#constraintSpace;
	#breakToken;
	#earlyBreakTarget;

	// Cross-phase state (persist across #setup → layoutChildren → #finalize)
	#childFragments = [];
	#childBreakTokens = [];
	#blockOffset = 0;
	#margins;
	#bestEarlyBreak = null;
	#earlyBreakForChild = null;
	#startIndex = 0;
	#prependedFragments = 0;
	#hasSeenAllChildren = false;

	// Derived from #node/#constraintSpace during #setup, used in layoutChildren + #finalize
	#containerBoxStart = 0;
	#containerBoxEnd = 0;
	#isClone = false;
	#tableSpacing = 0;
	#containerOffsetInFragmentainer = 0;

	constructor(node, constraintSpace, breakToken, earlyBreakTarget = null) {
		this.#node = node;
		this.#constraintSpace = constraintSpace;
		this.#breakToken = breakToken;
		this.#earlyBreakTarget = earlyBreakTarget;
	}

	*layout() {
		if (this.#node.children.length === 0) return this.#layoutLeaf();
		this.#setup();
		yield* this.runBeforeChildren();
		// `yield*` evaluates to the inner generator's return value. `layoutChildren`
		// may return an earlyBreak signal ({ earlyBreak, fragment: null, breakToken: null })
		// that must propagate to the driver — otherwise the two-pass retry never fires.
		const earlyBreakSignal = yield* this.layoutChildren();
		if (earlyBreakSignal) return earlyBreakSignal;
		return this.#finalize();
	}

	#availableBlockSpace() {
		// Use availableBlockSize (set by parent), which accounts for ancestor
		// padding/border reservations. Fall back to fragmentainer math if not set.
		return this.#constraintSpace.availableBlockSize > 0
			? this.#constraintSpace.availableBlockSize
			: this.#constraintSpace.fragmentainerBlockSize -
					this.#constraintSpace.blockOffsetInFragmentainer;
	}

	#layoutLeaf() {
		const node = this.#node;
		const constraintSpace = this.#constraintSpace;
		const breakToken = this.#breakToken;

		const intrinsicBlockSize = (node.isTableCell ? node.intrinsicBlockSize : node.blockSize) || 0;
		const consumed = breakToken?.consumedBlockSize || 0;
		const remaining = intrinsicBlockSize - consumed;

		// Monolithic elements are normally placed whole or pushed by parent.
		// Last resort (CSS Fragmentation §4.4): in page mode, slice at the
		// fragmentainer boundary when the element exceeds the full page.
		if (isMonolithic(node)) {
			const availableSpace = this.#availableBlockSpace();

			if (
				constraintSpace.fragmentationType === FRAGMENTATION_PAGE &&
				remaining > availableSpace &&
				availableSpace > 0
			) {
				const fragment = new Fragment(node, availableSpace);
				fragment.inlineSize = constraintSpace.availableInlineSize;
				fragment.needsBlockClip = true;
				const token = new BlockBreakToken(node);
				token.consumedBlockSize = consumed + availableSpace;
				token.sequenceNumber = (breakToken?.sequenceNumber ?? -1) + 1;
				token.hasSeenAllChildren = true;
				fragment.breakToken = token;
				return { fragment, breakToken: token };
			}

			const fragment = new Fragment(node, remaining);
			fragment.inlineSize = constraintSpace.availableInlineSize;
			if (consumed > 0) fragment.needsBlockClip = true;
			return { fragment, breakToken: null };
		}

		// Non-monolithic leaves can fragment across fragmentainers.
		const availableSpace = this.#availableBlockSpace();

		if (
			constraintSpace.fragmentationType !== FRAGMENTATION_NONE &&
			remaining > availableSpace &&
			availableSpace > 0
		) {
			const fragment = new Fragment(node, availableSpace);
			fragment.inlineSize = constraintSpace.availableInlineSize;
			const token = new BlockBreakToken(node);
			token.consumedBlockSize = consumed + availableSpace;
			token.sequenceNumber = (breakToken?.sequenceNumber ?? -1) + 1;
			token.hasSeenAllChildren = true;
			fragment.breakToken = token;
			return { fragment, breakToken: token };
		}

		const fragment = new Fragment(node, remaining);
		fragment.inlineSize = constraintSpace.availableInlineSize;
		return { fragment, breakToken: null };
	}

	#finalize() {
		const node = this.#node;
		const constraintSpace = this.#constraintSpace;
		const breakToken = this.#breakToken;

		this.#hasSeenAllChildren =
			this.#childBreakTokens.length === 0 ||
			this.#startIndex + this.#childFragments.length - this.#prependedFragments >=
				node.children.length;

		// Class A (forced) breaks preserve margins on both sides per CSS Frag L3 §5.2;
		// Class C (unforced) breaks truncate. Thread isForcedBreak into both margin calls.
		const pendingIsForcedBreak =
			!!this.#childBreakTokens[this.#childBreakTokens.length - 1]?.isForcedBreak;

		this.#blockOffset += this.#margins.trailingMargin(
			this.#childBreakTokens.length > 0,
			this.#childFragments.length > 0,
			pendingIsForcedBreak,
		);

		// Mark the last child fragment when its margin-block-end was truncated
		// at a break boundary (CSS Fragmentation L3 §5.2). Forced breaks preserve
		// margins on both sides, so truncation only applies to unforced breaks.
		if (
			this.#margins.shouldTruncateLastChildMarginEnd(
				this.#childBreakTokens.length > 0,
				pendingIsForcedBreak,
			) &&
			this.#childFragments.length > 0
		) {
			const lastChildFrag = this.#childFragments[this.#childFragments.length - 1];
			if (!lastChildFrag.breakToken) {
				lastChildFrag.truncateMarginBlockEnd = true;
			}
		}

		// Bottom-edge border-spacing: gap after the last row/section in the table.
		// Only on the final fragment (no break token pending).
		if (
			this.#tableSpacing > 0 &&
			node.isTable &&
			this.#hasSeenAllChildren &&
			this.#childBreakTokens.length === 0
		) {
			this.#blockOffset += this.#tableSpacing;
		}

		// Add container's bottom padding+border.
		// For slice: only on final fragment (all children placed, no break).
		// For clone: on every fragment (repeated decorations).
		if (
			(this.#hasSeenAllChildren && this.#childBreakTokens.length === 0) ||
			(this.#isClone && this.#childBreakTokens.length > 0)
		) {
			this.#blockOffset += this.#containerBoxEnd;
		}

		// Floor blockOffset to the browser-measured height in two cases:
		// (1) no children contributed height but the browser measures a non-zero
		//     height (CSS pseudo-elements, list markers, min-height);
		// (2) the node has an explicit CSS height that exceeds the children sum.
		// Case 2 only applies when the container isn't being fragmented — if it
		// is, the slice size is already determined by the fragmentainer.
		const boxStartIncluded = !breakToken || this.#isClone ? this.#containerBoxStart : 0;
		const boxEndIncluded =
			(this.#hasSeenAllChildren && this.#childBreakTokens.length === 0) ||
			(this.#isClone && this.#childBreakTokens.length > 0)
				? this.#containerBoxEnd
				: 0;
		const contentHeight = this.#blockOffset - boxStartIncluded - boxEndIncluded;
		const hasExplicitHeight =
			node.element &&
			!node.isTableCell &&
			this.#hasSeenAllChildren &&
			this.#childBreakTokens.length === 0 &&
			node.computedBlockSize &&
			node.computedBlockSize() != null;
		if (
			(contentHeight === 0 && this.#childFragments.length > 0 && node.element) ||
			hasExplicitHeight
		) {
			// hasExplicitHeight excludes table cells, so borderBoxBlockSize is safe
			// there — and reads from cached style, avoiding a layout reflow.
			const measuredHeight = node.isTableCell
				? node.intrinsicBlockSize
				: hasExplicitHeight
					? node.borderBoxBlockSize()
					: node.blockSize;
			if (measuredHeight > this.#blockOffset) {
				this.#blockOffset = measuredHeight;
			}
		}

		// Empty container: no child produced visible content, all remaining
		// children were pushed. Zero out blockOffset so this fragment doesn't
		// consume space (avoids rendering an empty padding/border shell).
		// Covers both the case where no children were placed at all and the
		// case where children were placed but all have zero blockSize (e.g.
		// an <li> inline FC that had no room for even one line of text).
		if (
			this.#childBreakTokens.length > 0 &&
			!this.#childFragments.some((f) => f.blockSize > 0)
		) {
			this.#blockOffset = 0;
		}

		// Build the output fragment
		const fragment = new Fragment(node, this.#blockOffset, this.#childFragments);
		fragment.inlineSize = constraintSpace.availableInlineSize;

		// Build break token if the container needs to continue
		const needsBreakToken =
			this.#childBreakTokens.length > 0 || !this.#hasSeenAllChildren;
		if (needsBreakToken) {
			const containerToken = new BlockBreakToken(node);
			containerToken.consumedBlockSize =
				(breakToken?.consumedBlockSize || 0) + this.#blockOffset;
			containerToken.sequenceNumber = (breakToken?.sequenceNumber ?? -1) + 1;
			containerToken.childBreakTokens = this.#childBreakTokens;
			containerToken.hasSeenAllChildren = this.#hasSeenAllChildren;
			fragment.breakToken = containerToken;
		}

		return { fragment, breakToken: fragment.breakToken || null };
	}

	#setup() {
		const node = this.#node;
		const constraintSpace = this.#constraintSpace;
		const breakToken = this.#breakToken;
		const earlyBreakTarget = this.#earlyBreakTarget;

		if (breakToken) {
			// Resumption: skip children before the first child break token.
			const firstChildToken = breakToken.childBreakTokens[0];
			if (firstChildToken) {
				this.#startIndex = node.children.indexOf(firstChildToken.node);
				if (this.#startIndex === -1) this.#startIndex = 0;
			}
		}

		// Container's own box insets (padding + border)
		this.#containerBoxStart = (node.paddingBlockStart || 0) + (node.borderBlockStart || 0);
		this.#containerBoxEnd = (node.paddingBlockEnd || 0) + (node.borderBlockEnd || 0);

		// Start blockOffset at the container's top padding+border.
		// For slice (default): only on first fragment.
		// For clone: on every fragment (repeated decorations).
		this.#isClone = node.boxDecorationBreak === BOX_DECORATION_CLONE;
		this.#blockOffset = breakToken && !this.#isClone ? 0 : this.#containerBoxStart;

		// Table border-spacing (separated borders model): adds gaps between
		// rows/sections and at table edges. Non-zero only for <table> and
		// <thead>/<tbody>/<tfoot> nodes whose table uses border-collapse: separate.
		this.#tableSpacing = node.borderSpacingBlock;

		// Top-edge border-spacing: gap before the first row/section in the table.
		// Only on the first fragment (continuation fragments start at the break).
		if (this.#tableSpacing > 0 && node.isTable && !breakToken) {
			this.#blockOffset += this.#tableSpacing;
		}

		this.#margins = new MarginState(constraintSpace.bodyMarginBlockStart || 0);

		// Effective start of this container within the fragmentainer
		this.#containerOffsetInFragmentainer = constraintSpace.blockOffsetInFragmentainer;

		// Check if earlyBreakTarget points into this node
		if (
			earlyBreakTarget &&
			earlyBreakTarget.node === node &&
			earlyBreakTarget.type === EARLY_BREAK_INSIDE
		) {
			this.#earlyBreakForChild = earlyBreakTarget.childEarlyBreak;
		}
	}

	*runBeforeChildren() {
		const beforeResult = handlers.beforeChildren(
			this.#node,
			this.#constraintSpace,
			this.#breakToken,
		);
		if (!beforeResult) return;

		const result = yield new LayoutRequest(beforeResult.node, beforeResult.constraintSpace, null);
		if (beforeResult.isRepeated) result.fragment.isRepeated = true;
		if (beforeResult.node.blockSize > result.fragment.blockSize) {
			result.fragment.blockSize = beforeResult.node.blockSize;
		}
		this.#childFragments.push(result.fragment);
		this.#prependedFragments = 1;
		this.#blockOffset += result.fragment.blockSize;
	}

	#marginOverflowedFragmentainer() {
		return (
			this.#constraintSpace.fragmentationType !== FRAGMENTATION_NONE &&
			this.#containerOffsetInFragmentainer + this.#blockOffset >=
				this.#constraintSpace.fragmentainerBlockSize &&
			this.#childFragments.length > 0
		);
	}

	#remainingSpace() {
		const tableEdgeEnd =
			this.#tableSpacing > 0 && this.#node.isTable ? this.#tableSpacing : 0;
		return (
			this.#constraintSpace.fragmentainerBlockSize -
			this.#containerOffsetInFragmentainer -
			this.#blockOffset -
			this.#containerBoxEnd -
			tableEdgeEnd
		);
	}

	#shouldHonorEarlyBreakBefore(child) {
		return (
			this.#earlyBreakForChild &&
			this.#earlyBreakForChild.node === child &&
			this.#earlyBreakForChild.type === EARLY_BREAK_BEFORE &&
			this.#blockOffset > 0
		);
	}

	#shouldForceBreakBefore(child, childBT, blockOffsetBeforeMargin) {
		return (
			isForcedBreakValue(child.breakBefore) &&
			!childBT &&
			blockOffsetBeforeMargin > 0
		);
	}

	#namedPageChanged(child, prevChild, childBT) {
		if (
			this.#constraintSpace.fragmentationType !== FRAGMENTATION_PAGE ||
			!prevChild ||
			childBT ||
			this.#blockOffset === 0
		) {
			return false;
		}
		const prevPage = prevChild.page || null;
		const thisPage = child.page || null;
		return prevPage !== thisPage && (thisPage !== null || prevPage !== null);
	}

	#shouldPushBreakInsideAvoid(child, childBT, remainingSpace) {
		if (isMonolithic(child) || childBT || this.#blockOffset === 0) return false;
		if (!isAvoidBreakValue(child.breakInside, this.#constraintSpace.fragmentationType)) {
			return false;
		}
		const childSize = child.blockSize || 0;
		return childSize > remainingSpace;
	}

	#buildChildConstraint(remainingSpace, collapseAdj) {
		return new ConstraintSpace({
			availableInlineSize: this.#constraintSpace.availableInlineSize,
			availableBlockSize: remainingSpace + collapseAdj,
			fragmentainerBlockSize: this.#constraintSpace.fragmentainerBlockSize,
			blockOffsetInFragmentainer:
				this.#containerOffsetInFragmentainer + this.#blockOffset - collapseAdj,
			fragmentationType: this.#constraintSpace.fragmentationType,
		});
	}

	#fragmentainerExhausted() {
		return (
			this.#constraintSpace.fragmentationType !== FRAGMENTATION_NONE &&
			this.#containerOffsetInFragmentainer + this.#blockOffset >=
				this.#constraintSpace.fragmentainerBlockSize
		);
	}

	#maybeReturnEarlyBreak(child, nextChild) {
		// Returns bare EarlyBreak target when a better earlier break exists,
		// or null when space exhaustion here is the right break point.
		const exhaustionScore = scoreClassABreak(
			child,
			nextChild,
			this.#constraintSpace.fragmentationType,
		);
		const adjustedScore = applyBreakInsideAvoid(
			this.#node,
			exhaustionScore,
			this.#constraintSpace.fragmentationType,
		);

		if (this.#bestEarlyBreak && this.#bestEarlyBreak.score < adjustedScore) {
			const earlyBreak = new EarlyBreak(
				this.#node,
				this.#bestEarlyBreak.score,
				EARLY_BREAK_INSIDE,
			);
			earlyBreak.childEarlyBreak = this.#bestEarlyBreak;
			return earlyBreak;
		}
		return null;
	}

	#updateBestEarlyBreak(i) {
		// Track Class A breakpoint score (between siblings).
		// Fast-path: when cumulative heights show this child is well within
		// the fragmentainer (< 75% full), skip break scoring — no chance of
		// this being the best break point.
		if (
			this.#constraintSpace.fragmentationType === FRAGMENTATION_NONE ||
			i <= this.#startIndex ||
			this.#blockOffset === 0
		) {
			return;
		}

		const children = this.#node.children;
		const cum = this.#node.cumulativeHeights;
		const skipScoring =
			cum &&
			!this.#earlyBreakTarget &&
			cum[i + 1] - cum[this.#startIndex] + this.#containerBoxStart <
				(this.#constraintSpace.fragmentainerBlockSize - this.#containerOffsetInFragmentainer) *
					SCORING_SKIP_THRESHOLD;
		if (skipScoring) return;

		const prevChild = children[i - 1];
		const child = children[i];
		const fragType = this.#constraintSpace.fragmentationType;
		let score = scoreClassABreak(prevChild, child, fragType);
		score = applyBreakInsideAvoid(this.#node, score, fragType);

		const candidate = new EarlyBreak(child, score, EARLY_BREAK_BEFORE);
		if (isBetterBreak(candidate, this.#bestEarlyBreak)) {
			this.#bestEarlyBreak = candidate;
		}
	}

	#recordChildBreak(child, result) {
		// Track break quality from child (e.g. orphans/widows violation,
		// or break-inside: avoid being violated)
		if (result.breakScore != null && result.breakScore > BreakScore.PERFECT) {
			const childScore = applyBreakInsideAvoid(
				this.#node,
				result.breakScore,
				this.#constraintSpace.fragmentationType,
			);
			const candidate = new EarlyBreak(child, childScore, EARLY_BREAK_INSIDE);
			if (isBetterBreak(candidate, this.#bestEarlyBreak)) {
				this.#bestEarlyBreak = candidate;
			}
		}

		// Child broke — record its break token
		this.#childBreakTokens.push(result.breakToken);
	}

	*layoutChildren() {
		const node = this.#node;
		const breakToken = this.#breakToken;
		const children = node.children;

		for (let i = this.#startIndex; i < children.length; i++) {
			const child = children[i];
			const childBreakToken = findChildBreakToken(breakToken, child);

			// Skip completed children when all have been visited
			if (!childBreakToken && breakToken?.hasSeenAllChildren) {
				continue;
			}

			// Skip children claimed by a layout handler (e.g. page floats)
			if (handlers.claim(child)) continue;

			// isBreakBefore means "pushed to this fragmentainer, lay out fresh"
			const effectiveChildBreakToken = childBreakToken?.isBreakBefore ? null : childBreakToken;

			// Margin collapsing: sibling collapse and through-collapse —
			// delegated to MarginState.
			const { marginDelta, collapsedThrough } = this.#margins.computeMarginBefore(child, {
				isFirstInLoop: i === this.#startIndex,
				isFirstFragment: !breakToken,
				isForcedBreak: !!childBreakToken?.isForcedBreak,
			});

			const blockOffsetBeforeMargin = this.#blockOffset;
			this.#blockOffset += marginDelta;

			// If the margin pushed us past the fragmentainer boundary, undo it and push
			// this child to the next fragmentainer. Margins adjoining a break are truncated.
			if (this.#marginOverflowedFragmentainer()) {
				this.#blockOffset = blockOffsetBeforeMargin;
				this.#childBreakTokens.push(BlockBreakToken.createBreakBefore(child, false));
				break;
			}

			const nextChild = i < children.length - 1 ? children[i + 1] : null;

			const remainingSpace = this.#remainingSpace();

			// Pass 2: if earlyBreakTarget says "break before this child", do it now
			if (this.#shouldHonorEarlyBreakBefore(child)) {
				this.#childBreakTokens.push(BlockBreakToken.createBreakBefore(child, false));
				break;
			}

			// Track Class A breakpoint score (between siblings).
			this.#updateBestEarlyBreak(i);

			// Forced break-before: break-before: page|column|always
			if (
				this.#shouldForceBreakBefore(child, effectiveChildBreakToken, blockOffsetBeforeMargin)
			) {
				this.#childBreakTokens.push(
					BlockBreakToken.createBreakBefore(child, true, child.breakBefore),
				);
				break;
			}

			// Named page change forces a page break (CSS Paged Media §3)
			const prevChild = i > this.#startIndex ? children[i - 1] : null;
			if (this.#namedPageChanged(child, prevChild, effectiveChildBreakToken)) {
				this.#childBreakTokens.push(BlockBreakToken.createBreakBefore(child, true));
				break;
			}

			// Monolithic content: push or overflow
			if (isMonolithic(child) && !effectiveChildBreakToken) {
				const childSize = getMonolithicBlockSize(child, this.#constraintSpace);
				if (childSize > remainingSpace && this.#blockOffset > 0) {
					this.#childBreakTokens.push(BlockBreakToken.createBreakBefore(child, false));
					break;
				}
			}

			// break-inside: avoid elements (e.g. tables): push to next
			// fragmentainer when they don't fit, rather than stranding a
			// header row alone at the bottom of the page.
			if (this.#shouldPushBreakInsideAvoid(child, effectiveChildBreakToken, remainingSpace)) {
				this.#childBreakTokens.push(BlockBreakToken.createBreakBefore(child, false));
				break;
			}

			const collapseAdj = this.#margins.collapseAdjustment(
				collapsedThrough,
				!!effectiveChildBreakToken,
			);
			const childConstraint = this.#buildChildConstraint(remainingSpace, collapseAdj);

			// Yield layout request — driver runs child generator and returns result
			const result = yield new LayoutRequest(child, childConstraint, effectiveChildBreakToken);

			if (
				this.#margins.shouldTruncateChildMarginStart({
					isFirstChild: i === this.#startIndex,
					hasBreakToken: !!breakToken,
					childMarginBefore: child.marginBlockStart || 0,
					isForcedBreak: !!childBreakToken?.isForcedBreak,
				})
			) {
				result.fragment.truncateMarginBlockStart = true;
			}

			result.fragment.blockOffset = this.#blockOffset;
			this.#childFragments.push(result.fragment);
			this.#blockOffset += result.fragment.blockSize;

			this.#blockOffset -= this.#margins.applyAfterLayout(
				child,
				collapsedThrough,
				!!effectiveChildBreakToken,
				!!result.breakToken,
			);

			// Table border-spacing: gap between adjacent rows/sections.
			if (this.#tableSpacing > 0 && nextChild) {
				this.#blockOffset += this.#tableSpacing;
			}

			if (result.breakToken) {
				this.#recordChildBreak(child, result);
				break;
			}

			// Forced break-after: break-after: page|column|always
			const breakAfter = child.breakAfter;
			if (isForcedBreakValue(breakAfter) && nextChild) {
				this.#childBreakTokens.push(
					BlockBreakToken.createBreakBefore(nextChild, true, breakAfter),
				);
				break;
			}

			// Check if we've exceeded fragmentainer space
			if (this.#fragmentainerExhausted() && nextChild) {
				const earlyBreak = this.#maybeReturnEarlyBreak(child, nextChild);
				if (earlyBreak) {
					// Return shape matches the free-function contract: driver checks
					// `result.earlyBreak` in `runLayoutGenerator`. `*layout()`
					// re-returns this object unchanged via the `yield*` completion value.
					return { fragment: null, breakToken: null, earlyBreak };
				}
				this.#childBreakTokens.push(BlockBreakToken.createBreakBefore(nextChild, false));
				break;
			}
		}
	}
}
