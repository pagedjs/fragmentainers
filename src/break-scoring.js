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
    this.node = node;               // which node to break at
    this.score = score;             // BreakScore value
    this.type = type;               // 'before' | 'inside'
    this.childEarlyBreak = null;    // EarlyBreak chain to deep breakpoint
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
 * @param {import('./helpers.js').LayoutNode|null} prevChild - child before the break
 * @param {import('./helpers.js').LayoutNode} nextChild - child after the break
 * @returns {number} BreakScore value
 */
export function scoreClassABreak(prevChild, nextChild) {
  // Check break-before: avoid on nextChild
  if (nextChild.breakBefore === 'avoid') {
    return BreakScore.VIOLATING_BREAK_AVOID;
  }
  // Check break-after: avoid on prevChild
  if (prevChild && prevChild.breakAfter === 'avoid') {
    return BreakScore.VIOLATING_BREAK_AVOID;
  }
  // Check break-inside: avoid on the parent (handled by caller)
  return BreakScore.PERFECT;
}

/**
 * Check if the parent has break-inside: avoid.
 * If so, any break inside degrades the score.
 */
export function applyBreakInsideAvoid(node, score) {
  if (node.breakInside === 'avoid' && score < BreakScore.VIOLATING_BREAK_AVOID) {
    return BreakScore.VIOLATING_BREAK_AVOID;
  }
  return score;
}
