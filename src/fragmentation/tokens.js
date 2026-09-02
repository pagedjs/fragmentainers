export const BREAK_TOKEN_BLOCK = "block";
export const BREAK_TOKEN_INLINE = "inline";

// U+2010 HYPHEN — the spec default glyph rendered at a hyphenated break
// when `hyphenate-character: auto`. Used as a fallback anywhere a concrete
// glyph is required but the computed value is unavailable.
export const DEFAULT_HYPHEN = "\u2010";

/**
 * Base break token — continuation token for layout.
 * When a node's content doesn't fit in the current fragmentainer,
 * the layout algorithm produces a fragment and attaches a break token
 * to resume layout in the next fragmentainer.
 */
export class BreakToken {
	constructor(type, node) {
		this.type = type; // "block" | "inline"
		this.node = node; // reference to the layout node
		this.isBreakBefore = false;
		this.isForcedBreak = false;
		this.forcedBreakValue = null;
		this.isRepeated = false;
		// The box's own extent is complete; it continues only because a
		// descendant in a parallel flow does (CSS Fragmentation §2.1). With
		// child break tokens, those descendants are content overflowing the
		// box's block-end: they resume as overflow of a box that has no extent
		// and no decorations in the fragmentainers that follow.
		this.isAtBlockEnd = false;
		// Every in-flow child has been laid out. Without child break tokens
		// and without isAtBlockEnd, the box's block-size is what continues:
		// consumedBlockSize counts the extent placed so far against it (§5.3).
		this.hasSeenAllChildren = false;
		// The fragment this token came from was dropped as an empty shell, so
		// the box's block-start decorations have not been rendered yet.
		this.wasSuppressed = false;
		this.isCausedByColumnSpanner = false;
		this.hasUnpositionedListMarker = false;
	}

	/**
	 * The box's own block-size is what continues: it resumes with its extent,
	 * its block-end decorations and the rest of its in-flow content.
	 */
	get continuesInFlow() {
		return !this.isAtBlockEnd;
	}

	/**
	 * Whether `other` resumes layout at the same place with the same state.
	 * Compares the fields the token declares, so an ad-hoc property a caller
	 * hung on one token does not make two otherwise identical tokens differ.
	 *
	 * @param {BreakToken} other
	 * @returns {boolean}
	 */
	equals(other) {
		return (
			this.type === other.type &&
			this.node === other.node &&
			this.isBreakBefore === other.isBreakBefore &&
			this.isForcedBreak === other.isForcedBreak &&
			this.forcedBreakValue === other.forcedBreakValue &&
			this.isRepeated === other.isRepeated &&
			this.isAtBlockEnd === other.isAtBlockEnd &&
			this.hasSeenAllChildren === other.hasSeenAllChildren
		);
	}
}

// Both null, or the same own keys with identical values. Non-primitives
// compare by reference: a rebuilt object is a difference even if it holds
// the same data.
function algorithmDataEqual(left, right) {
	if (left === null || right === null) return left === right;
	const leftKeys = Object.keys(left);
	if (leftKeys.length !== Object.keys(right).length) return false;
	for (const key of leftKeys) {
		if (!Object.hasOwn(right, key)) return false;
		if (!Object.is(left[key], right[key])) return false;
	}
	return true;
}

/**
 * Block break token — for block-level nodes (the primary break token type).
 *
 * Key invariants:
 * - consumedBlockSize is cumulative across ALL previous fragments: the
 *   box's own extent placed so far, less the insets box-decoration-break:
 *   clone repeats on them (CSS Fragmentation §5.4), which lie outside the
 *   box's block-size. Once the box is at its block-end it equals the box's
 *   whole extent; overflow continuing in parallel (§2.1) adds nothing to it.
 * - childBreakTokens form a sparse tree mirroring the CSS box tree
 * - sequenceNumber increments per fragment (0, 1, 2, ...)
 */
export class BlockBreakToken extends BreakToken {
	constructor(node) {
		super(BREAK_TOKEN_BLOCK, node);
		this.consumedBlockSize = 0;
		this.sequenceNumber = 0;
		this.childBreakTokens = [];
		this.algorithmData = null;
	}

	/**
	 * The box's extent is complete but descendants overflowing its block-end
	 * continue in a parallel flow (§2.1). It resumes with no extent and no
	 * decorations, carrying only that flow.
	 */
	get continuesAsOverflow() {
		return this.isAtBlockEnd && this.childBreakTokens.length > 0;
	}

	/**
	 * The whole subtree finished on an earlier fragmentainer while a sibling
	 * in a parallel flow continued. Nothing is rendered for it, but its box
	 * stays so the track it holds does not collapse.
	 */
	get isComplete() {
		return this.isAtBlockEnd && this.childBreakTokens.length === 0;
	}

	/**
	 * Whether `other` resumes block layout at the same place with the same
	 * state, comparing the child token tree pairwise.
	 *
	 * `algorithmData` is compared shallowly: same own keys, each value
	 * identical under `Object.is`. An algorithm that nests state inside an
	 * object, Map or Set there gets no comparison of the nested contents —
	 * two runs that rebuild it are unequal, and two runs that share it are
	 * equal whatever it now holds.
	 *
	 * @param {BlockBreakToken} other
	 * @returns {boolean}
	 */
	equals(other) {
		if (!super.equals(other)) return false;
		if (this.consumedBlockSize !== other.consumedBlockSize) return false;
		if (this.sequenceNumber !== other.sequenceNumber) return false;
		if (this.childBreakTokens.length !== other.childBreakTokens.length) return false;
		for (let i = 0; i < this.childBreakTokens.length; i++) {
			if (!this.childBreakTokens[i].equals(other.childBreakTokens[i])) return false;
		}
		return algorithmDataEqual(this.algorithmData, other.algorithmData);
	}

	/**
	 * Break before a node — no fragment produced for this node.
	 * Used when a node doesn't fit and is pushed to the next fragmentainer,
	 * or when a forced break (break-before: page) is requested.
	 */
	static createBreakBefore(node, isForcedBreak = false, forcedBreakValue = null) {
		const token = new BlockBreakToken(node);
		token.isBreakBefore = true;
		token.isForcedBreak = isForcedBreak;
		if (forcedBreakValue) token.forcedBreakValue = forcedBreakValue;
		return token;
	}

	/**
	 * For repeated content (table thead/tfoot in each fragmentainer).
	 * Paint-only — carries sequence number but no child tokens.
	 */
	static createRepeated(node, sequenceNumber) {
		const token = new BlockBreakToken(node);
		token.isRepeated = true;
		token.sequenceNumber = sequenceNumber;
		return token;
	}

	/**
	 * Break inside repeated content.
	 */
	static createForBreakInRepeatedFragment(node, sequenceNumber, consumedBlockSize) {
		const token = new BlockBreakToken(node);
		token.isRepeated = true;
		token.sequenceNumber = sequenceNumber;
		token.consumedBlockSize = consumedBlockSize;
		return token;
	}
}

/**
 * Inline break token — for inline content (text, inline-level boxes).
 *
 * Content-addressed via itemIndex + textOffset into InlineItemsData.
 * Does NOT store pixel positions, line numbers, or geometry.
 * This makes it survive inline-size changes between fragmentainers.
 */
export class InlineBreakToken extends BreakToken {
	constructor(node) {
		super(BREAK_TOKEN_INLINE, node);
		this.itemIndex = 0; // index into InlineItemsData.items
		this.textOffset = 0; // offset into InlineItemsData.textContent
		this.flags = 0; // inline-specific state bits
		this.isHyphenated = false; // true when break follows a soft hyphen (U+00AD)
		this.hyphenateCharacter = DEFAULT_HYPHEN; // glyph to append on page N when isHyphenated
		/**
		 * When true, the render layer trims one trailing space from the
		 * last text node of page N. Set by the layout layer when the
		 * break advanced past a collapsible line-end space.
		 */
		this.hasTrailingCollapsibleSpace = false;
	}

	/**
	 * Whether `other` resumes inline layout at the same content position with
	 * the same line-end state.
	 *
	 * @param {InlineBreakToken} other
	 * @returns {boolean}
	 */
	equals(other) {
		return (
			super.equals(other) &&
			this.itemIndex === other.itemIndex &&
			this.textOffset === other.textOffset &&
			this.flags === other.flags &&
			this.isHyphenated === other.isHyphenated &&
			this.hyphenateCharacter === other.hyphenateCharacter &&
			this.hasTrailingCollapsibleSpace === other.hasTrailingCollapsibleSpace
		);
	}
}

/**
 * Find a child's break token within a parent's break token.
 *
 * Anonymous boxes — grid rows, flex lines — have no layout node of their own
 * and borrow their container's, so two sibling fragments can carry the same
 * node. `taken` records the tokens already matched in one pass so the second
 * sibling does not resume from the first one's token.
 */
export function findChildBreakToken(parentBreakToken, childNode, taken = null) {
	if (!parentBreakToken) return null;
	for (const token of parentBreakToken.childBreakTokens) {
		if (token.node !== childNode || taken?.has(token)) continue;
		taken?.add(token);
		return token;
	}
	return null;
}

/**
 * Check if a CSS break-before/break-after value is a forced break.
 * Values like "page", "column", "always", "left", "right" force a
 * break; "auto" and the "avoid"/"avoid-*" family do not.
 */
export function isForcedBreakValue(value) {
	if (!value || value === "auto") return false;
	if (
		value === "avoid" ||
		value === "avoid-page" ||
		value === "avoid-column" ||
		value === "avoid-region"
	) {
		return false;
	}
	return true;
}

/**
 * Check if a CSS break-before/after/inside value is an avoid value
 * applicable to the current fragmentation context. `avoid` applies to
 * any context; `avoid-page`, `avoid-column`, `avoid-region` apply only
 * to their respective contexts.
 */
export function isAvoidBreakValue(value, fragmentationType = "page") {
	if (value === "avoid") return true;
	if (fragmentationType === "page" && value === "avoid-page") return true;
	if (fragmentationType === "column" && value === "avoid-column") return true;
	if (fragmentationType === "region" && value === "avoid-region") return true;
	return false;
}
