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
 */
export class EarlyBreak {
	constructor(node, score, type) {
		this.node = node; // which node to break at
		this.score = score; // BreakScore value
		this.type = type; // EARLY_BREAK_BEFORE | EARLY_BREAK_INSIDE
		this.childEarlyBreak = null; // EarlyBreak chain to deep breakpoint
	}
}

/**
 * Returns true if `a` is a better (lower) break score than `b`.
 */
export function isBetterBreak(a, b) {
	if (!a) return false;
	if (!b) return true;
	return a.score < b.score;
}

/**
 * Evaluate the break score for a Class A break between siblings.
 * Checks break-after on the previous sibling and break-before on the next.
 *
 * @param {import("./helpers.js").LayoutNode|null} prevChild - child before the break
 * @param {import("./helpers.js").LayoutNode} nextChild - child after the break
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
