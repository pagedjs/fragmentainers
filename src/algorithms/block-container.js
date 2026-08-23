import {
	BlockBreakToken,
	findChildBreakToken,
	isAvoidBreakValue,
	isForcedBreakValue,
} from "../fragmentation/tokens.js";
import {
	ConstraintSpace,
	FRAGMENTATION_NONE,
	FRAGMENTATION_PAGE,
} from "../fragmentation/constraint-space.js";
import { Fragment } from "../fragmentation/fragment.js";
import { LayoutRequest } from "../layout/layout-request.js";
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
import { BOX_DECORATION_CLONE } from "../layout/layout-node.js";
import { MarginState, isSelfCollapsing } from "../layout/margin-collapsing.js";

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
	#breakScore = BreakScore.PERFECT;
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

	get node() {
		return this.#node;
	}

	*layout() {
		const breakToken = this.#breakToken;
		// The box's own extent is complete (CSS Fragmentation §2.1, parallel
		// flows): it occupies nothing in this fragmentainer.
		if (breakToken?.isAtBlockEnd) return this.#buildEmptyFragment();
		// Monolithic boxes contain no break points (§4.1): placed whole, or
		// sliced as a last resort (§4.4). Their children are never laid out.
		if (isMonolithic(this.#node)) return this.#layoutMonolithic();
		if (this.#node.children.length === 0) return this.#layoutLeaf();
		// In-flow content complete, block-size not yet exhausted (§5.3): only
		// the rest of the box's extent continues here.
		if (breakToken?.hasSeenAllChildren && breakToken.childBreakTokens.length === 0) {
			return this.#layoutRemainingExtent();
		}
		this.#setup();
		yield* this.runBeforeChildren();
		// `yield*` evaluates to the inner generator's return value. `layoutChildren`
		// may return an earlyBreak signal ({ earlyBreak, fragment: null, breakToken: null })
		// that must propagate to the driver — otherwise the two-pass retry never fires.
		const earlyBreakSignal = yield* this.layoutChildren();
		if (earlyBreakSignal) return earlyBreakSignal;
		return this.#finalize();
	}

	#hasConsumedExtent() {
		return (this.#breakToken?.consumedBlockSize || 0) > 0;
	}

	#availableBlockSpace() {
		// Use availableBlockSize (set by parent), which accounts for ancestor
		// padding/border reservations. Fall back to fragmentainer math if not set.
		return this.#constraintSpace.availableBlockSize > 0
			? this.#constraintSpace.availableBlockSize
			: this.#constraintSpace.fragmentainerBlockSize -
					this.#constraintSpace.blockOffsetInFragmentainer;
	}

	#buildEmptyFragment() {
		const fragment = new Fragment(this.#node, 0);
		fragment.inlineSize = this.#constraintSpace.availableInlineSize;
		return { fragment, breakToken: null };
	}

	/**
	 * The box's own block-size as a limit on the extent of its fragments
	 * (CSS Fragmentation §5.3), border-box. Null when the block-size is
	 * auto, i.e. determined by content. Table cells are sized by their row.
	 */
	#usedBlockSize() {
		const node = this.#node;
		if (node.isTableCell || typeof node.borderBoxBlockSize !== "function") return null;
		return node.borderBoxBlockSize();
	}

	/**
	 * Token for a break inside this box after all of its in-flow content:
	 * the content is complete, the box's own block-size is not.
	 */
	#selfBreakToken(consumedBlockSize) {
		const token = new BlockBreakToken(this.#node);
		token.consumedBlockSize = consumedBlockSize;
		token.sequenceNumber = (this.#breakToken?.sequenceNumber ?? -1) + 1;
		token.hasSeenAllChildren = true;
		return token;
	}

	/**
	 * Place `remaining` of this box's own extent, with no further content to
	 * lay out. When it exceeds the remaining fragmentainer extent the box
	 * breaks at the fragmentainer edge and the rest continues (§5.3); each
	 * such fragment shows only its slice of the box.
	 */
	#layoutExtent(remaining, consumed, slice) {
		const constraintSpace = this.#constraintSpace;
		const available = this.#availableBlockSpace();
		const fits = !slice || remaining <= available || available <= 0;

		const fragment = new Fragment(this.#node, fits ? remaining : available);
		fragment.inlineSize = constraintSpace.availableInlineSize;
		fragment.needsBlockClip = !fits || consumed > 0;
		if (fits) return { fragment, breakToken: null };

		fragment.breakToken = this.#selfBreakToken(consumed + available);
		return { fragment, breakToken: fragment.breakToken };
	}

	#layoutMonolithic() {
		const node = this.#node;
		const consumed = this.#breakToken?.consumedBlockSize || 0;
		const intrinsic = (node.isTableCell ? node.intrinsicBlockSize : node.blockSize) || 0;
		// Monolithic content is normally placed whole or pushed by the parent;
		// slicing its rendering is the page-mode last resort of §4.4.
		return this.#layoutExtent(
			intrinsic - consumed,
			consumed,
			this.#constraintSpace.fragmentationType === FRAGMENTATION_PAGE,
		);
	}

	#layoutLeaf() {
		const node = this.#node;
		const consumed = this.#breakToken?.consumedBlockSize || 0;
		const extent = this.#usedBlockSize() ?? node.blockSize ?? 0;
		return this.#layoutExtent(
			extent - consumed,
			consumed,
			this.#constraintSpace.fragmentationType !== FRAGMENTATION_NONE,
		);
	}

	#layoutRemainingExtent() {
		const node = this.#node;
		const consumed = this.#breakToken.consumedBlockSize;
		const extent = this.#usedBlockSize() ?? node.blockSize ?? 0;
		const remaining = extent - consumed;
		if (remaining <= 0) return this.#buildEmptyFragment();
		return this.#layoutExtent(
			remaining,
			consumed,
			this.#constraintSpace.fragmentationType !== FRAGMENTATION_NONE,
		);
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

		const selfBreak = this.#applyBlockSize();

		// Empty container: no child produced visible content, all remaining
		// children were pushed. Zero out blockOffset so this fragment doesn't
		// consume space (avoids rendering an empty padding/border shell).
		// Covers both the case where no children were placed at all and the
		// case where children were placed but all have zero blockSize (e.g.
		// an <li> whose inline content had no room for even one line of text).
		if (
			this.#childBreakTokens.length > 0 &&
			!this.#childFragments.some((f) => f.blockSize > 0)
		) {
			this.#blockOffset = 0;
		}

		// Build the output fragment
		const fragment = new Fragment(node, this.#blockOffset, this.#childFragments);
		fragment.inlineSize = constraintSpace.availableInlineSize;

		if (selfBreak) {
			fragment.breakToken = selfBreak;
			fragment.needsBlockClip = true;
		}

		// Build break token if the container needs to continue
		const needsBreakToken =
			!selfBreak && (this.#childBreakTokens.length > 0 || !this.#hasSeenAllChildren);
		if (needsBreakToken) {
			const containerToken = new BlockBreakToken(node);
			containerToken.consumedBlockSize =
				(breakToken?.consumedBlockSize || 0) + this.#blockOffset;
			containerToken.sequenceNumber = (breakToken?.sequenceNumber ?? -1) + 1;
			containerToken.childBreakTokens = this.#childBreakTokens;
			containerToken.hasSeenAllChildren = this.#hasSeenAllChildren;
			fragment.breakToken = containerToken;
		}

		// Report the quality of the break this container produced so an ancestor
		// can push the whole container to the next fragmentainer when it scored
		// worse than an earlier breakpoint of its own (orphans/widows two-pass).
		return {
			fragment,
			breakToken: fragment.breakToken || null,
			breakScore: fragment.breakToken ? this.#breakScore : BreakScore.PERFECT,
		};
	}

	/**
	 * Resolve the fragment's block-size against the box's own block-size.
	 *
	 * Auto: the fragment is as tall as its content, floored to the browser
	 * measurement when nothing in the fragment tree contributed (generated
	 * content, list markers, min-height).
	 *
	 * Specified: the extent of every fragment counts against it (CSS
	 * Fragmentation §5.3). Once the in-flow content is complete, the box
	 * extends to the rest of its block-size; if that exceeds the remaining
	 * fragmentainer extent, the box breaks after its content — a Class C
	 * break point (§4.1) — fills the fragmentainer, and the remainder, with
	 * the block-end decorations (box-decoration-break: slice), continues.
	 * Content taller than the specified block-size keeps its own extent.
	 *
	 * @returns {BlockBreakToken|null} the token for a break inside this box
	 */
	#applyBlockSize() {
		const node = this.#node;
		const contentDone = this.#hasSeenAllChildren && this.#childBreakTokens.length === 0;
		const used = this.#usedBlockSize();

		if (used == null) {
			const boxStart = this.#isClone || !this.#hasConsumedExtent() ? this.#containerBoxStart : 0;
			const boxEnd =
				contentDone || (this.#isClone && this.#childBreakTokens.length > 0)
					? this.#containerBoxEnd
					: 0;
			const contentHeight = this.#blockOffset - boxStart - boxEnd;
			if (contentHeight === 0 && this.#childFragments.length > 0 && node.element) {
				const measured = node.isTableCell ? node.intrinsicBlockSize : node.blockSize;
				if (measured > this.#blockOffset) this.#blockOffset = measured;
			}
			return null;
		}

		if (!contentDone) return null;

		const consumed = this.#breakToken?.consumedBlockSize || 0;
		const remaining = used - consumed;
		if (this.#blockOffset >= remaining) return null;

		const available = this.#availableBlockSpace();
		const fits =
			this.#constraintSpace.fragmentationType === FRAGMENTATION_NONE ||
			remaining <= available ||
			available <= 0;
		if (fits) {
			this.#blockOffset = remaining;
			return null;
		}

		const contentExtent = this.#blockOffset - this.#containerBoxEnd;
		this.#blockOffset = Math.max(available, contentExtent);
		this.#breakScore = applyBreakInsideAvoid(
			node,
			BreakScore.PERFECT,
			this.#constraintSpace.fragmentationType,
		);
		return this.#selfBreakToken(consumed + this.#blockOffset);
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
		// For slice (default): only on the first fragment with any extent —
		// a zero-progress continuation still owes its block-start decorations.
		// For clone: on every fragment (repeated decorations).
		this.#isClone = node.boxDecorationBreak === BOX_DECORATION_CLONE;
		this.#blockOffset = this.#isClone || !this.#hasConsumedExtent() ? this.#containerBoxStart : 0;

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
		const beforeResult = this.#node.context.handlers.beforeChildren(
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
			this.#blockOffset >= this.#availableBlockSpace() &&
			this.#childFragments.length > 0
		);
	}

	/**
	 * Block space left for the next child: the space the parent made
	 * available to this box, less what is placed and the box's own
	 * block-end inset, which every fragment but the last must leave room for.
	 */
	#remainingSpace() {
		const tableEdgeEnd =
			this.#tableSpacing > 0 && this.#node.isTable ? this.#tableSpacing : 0;
		return (
			this.#availableBlockSpace() - this.#blockOffset - this.#containerBoxEnd - tableEdgeEnd
		);
	}

	#earlyBreakTargetForChild() {
		// Forward the incoming target only when it names a descendant of this
		// container. A target naming THIS container is already unwrapped into
		// #earlyBreakForChild by #setup, so there is nothing left to forward.
		const target = this.#earlyBreakTarget;
		if (!target || target.node === this.#node) return null;
		return target;
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
			this.#blockOffset >= this.#availableBlockSpace()
		);
	}

	#earlyBreakIfBetter(adjustedScore) {
		// Return an EarlyBreak retry target when a better (lower-score) break was
		// recorded earlier in this container; otherwise null to break at the
		// current point. When an earlyBreakTarget is already set this is the
		// second pass, whose retry is single-shot: re-emitting an early break
		// would leave a null fragment unresolved, so break here instead.
		if (this.#earlyBreakTarget) return null;
		if (!this.#bestEarlyBreak || this.#bestEarlyBreak.score >= adjustedScore) {
			return null;
		}
		const earlyBreak = new EarlyBreak(
			this.#node,
			this.#bestEarlyBreak.score,
			EARLY_BREAK_INSIDE,
		);
		earlyBreak.childEarlyBreak = this.#bestEarlyBreak;
		return earlyBreak;
	}

	#scoreBreakBetween(prevChild, nextChild) {
		const fragType = this.#constraintSpace.fragmentationType;
		return applyBreakInsideAvoid(
			this.#node,
			scoreClassABreak(prevChild, nextChild, fragType),
			fragType,
		);
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

	#childBreakScore(result) {
		// Quality of the break this child produced, as seen from this container:
		// orphans/widows violations are reported by inline content and nested
		// block containers; any break inside a break-inside:avoid container is
		// itself a violation regardless of the child's own score.
		return applyBreakInsideAvoid(
			this.#node,
			result.breakScore ?? BreakScore.PERFECT,
			this.#constraintSpace.fragmentationType,
		);
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
			if (this.#node.context.handlers.claim(child)) continue;

			// isBreakBefore means "pushed to this fragmentainer, lay out fresh"
			const effectiveChildBreakToken = childBreakToken?.isBreakBefore ? null : childBreakToken;

			// Margin collapsing: sibling collapse and through-collapse —
			// delegated to MarginState.
			const { marginDelta, collapsedThrough, consumedPrevMarginEnd } = this.#margins.computeMarginBefore(child, {
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
				this.#breakScore = this.#earlyBreakForChild.score;
				break;
			}

			// Track Class A breakpoint score (between siblings).
			this.#updateBestEarlyBreak(i);

			// Forced break-before: break-before: page|column|always. Checks the
			// raw token so a child already carrying a break-before token here is
			// laid out rather than pushed forward again.
			if (
				this.#shouldForceBreakBefore(child, childBreakToken, blockOffsetBeforeMargin)
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

			// Yield layout request — driver runs child generator and returns result.
			// A descendant-owned early-break target is forwarded so the owning
			// block can honor it; #setup only acts on a target whose node matches,
			// so forwarding to every child is safe.
			const result = yield new LayoutRequest(
				child,
				childConstraint,
				effectiveChildBreakToken,
				this.#earlyBreakTargetForChild(),
			);

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

			// CSS2 §8.3.1 §3.4: an in-flow, zero-height box with no border/padding
			// that does not establish a BFC self-collapses — its start+end margins
			// fold into the neighbours' set instead of advancing layout. Restricted
			// to collapsedThrough === 0 so the top through-collapse compensation
			// path stays the sole owner of that case.
			const selfCollapsing =
				!result.breakToken &&
				!effectiveChildBreakToken &&
				collapsedThrough === 0 &&
				!child.establishesBlockFormattingContext &&
				isSelfCollapsing(child, result.fragment.blockSize);
			this.#blockOffset -= this.#margins.applyAfterLayout(
				child,
				collapsedThrough,
				!!effectiveChildBreakToken,
				!!result.breakToken,
				{ selfCollapsing, appliedMarginStart: marginDelta, consumedPrevMarginEnd },
			);

			// Table border-spacing: gap between adjacent rows/sections.
			if (this.#tableSpacing > 0 && nextChild) {
				this.#blockOffset += this.#tableSpacing;
			}

			if (result.breakToken) {
				// A violating child break (orphans/widows, or any break inside a
				// break-inside:avoid container) can be improved by breaking at an
				// earlier Class A breakpoint — retry there when one scored better.
				const childBreakScore = this.#childBreakScore(result);
				const earlyBreak = this.#earlyBreakIfBetter(childBreakScore);
				if (earlyBreak) {
					return { fragment: null, breakToken: null, earlyBreak };
				}
				this.#childBreakTokens.push(result.breakToken);
				this.#breakScore = childBreakScore;
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
				const exhaustionScore = this.#scoreBreakBetween(child, nextChild);
				const earlyBreak = this.#earlyBreakIfBetter(exhaustionScore);
				if (earlyBreak) {
					// Return shape matches the free-function contract: driver checks
					// `result.earlyBreak` in `runLayoutGenerator`. `*layout()`
					// re-returns this object unchanged via the `yield*` completion value.
					return { fragment: null, breakToken: null, earlyBreak };
				}
				this.#childBreakTokens.push(BlockBreakToken.createBreakBefore(nextChild, false));
				this.#breakScore = exhaustionScore;
				break;
			}
		}
	}
}
