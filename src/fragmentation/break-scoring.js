import { isAvoidBreakValue } from "./tokens.js";

export const EARLY_BREAK_BEFORE = "before";
export const EARLY_BREAK_INSIDE = "inside";

/**
 * Break scores ordered from best to worst.
 */
export const BreakScore = {
	PERFECT: 0,
	VIOLATING_ORPHANS_WIDOWS: 1,
	VIOLATING_BREAK_AVOID: 2,
	LAST_RESORT: 3,
};

/**
 * Early break — tracks the best breakpoint found during Pass 1.
 * Forms a chain (path) to the optimal breakpoint, which can be
 * arbitrarily deep in the tree.
 *
 * @param {import("../layout/layout-node-base.js").LayoutNode} node - Node associated with the breakpoint
 * @param {number} score - BreakScore value
 * @param {"before"|"inside"} type - Breakpoint position
 * @returns {EarlyBreak} Early-break candidate
 */
export class EarlyBreak {
	constructor(node, score, type) {
		this.node = node;
		this.score = score;
		this.type = type;
		this.childEarlyBreak = null;
	}
}

/**
 * Returns true if `a` should replace `b` as the recorded early break.
 *
 * A lower score is better. Candidates arrive in document order, so an equal
 * score also wins: the later breakpoint puts more content on the fragmentainer
 * for the same appeal. Keeping the earlier one would strand the space between
 * them. Matches Blink's `ContainerFragmentBuilder::UpdateEarlyBreak`, which
 * replaces unless the stored candidate has strictly better appeal.
 *
 * @param {EarlyBreak|null} a - New candidate
 * @param {EarlyBreak|null} b - Recorded candidate
 * @returns {boolean} Whether the new candidate should replace the recorded one
 */
export function isBetterBreak(a, b) {
	if (!a) return false;
	if (!b) return true;
	return a.score <= b.score;
}

/**
 * Evaluate the break score for a Class A break between siblings.
 * Checks break-after on the previous sibling and break-before on the next.
 *
 * @param {import("../layout/layout-node-base.js").LayoutNode|null} prevChild - Child before the break
 * @param {import("../layout/layout-node-base.js").LayoutNode} nextChild - Child after the break
 * @param {string} [fragmentationType] - Active fragmentation context
 * @returns {number} BreakScore value
 */
export function scoreClassABreak(prevChild, nextChild, fragmentationType = "page") {
	if (isAvoidBreakValue(nextChild.breakBefore, fragmentationType)) {
		return BreakScore.VIOLATING_BREAK_AVOID;
	}
	if (prevChild && isAvoidBreakValue(prevChild.breakAfter, fragmentationType)) {
		return BreakScore.VIOLATING_BREAK_AVOID;
	}
	return BreakScore.PERFECT;
}

/**
 * Check if the parent has break-inside: avoid (or context-appropriate
 * avoid-page/avoid-column/avoid-region). If so, any break inside
 * degrades the score.
 *
 * @param {import("../layout/layout-node-base.js").LayoutNode} node - Parent containing the break
 * @param {number} score - Current BreakScore value
 * @param {string} [fragmentationType] - Active fragmentation context
 * @returns {number} Adjusted BreakScore value
 */
export function applyBreakInsideAvoid(node, score, fragmentationType = "page") {
	if (
		isAvoidBreakValue(node.breakInside, fragmentationType) &&
		score < BreakScore.VIOLATING_BREAK_AVOID
	) {
		return BreakScore.VIOLATING_BREAK_AVOID;
	}
	return score;
}
