import { BREAK_TOKEN_BLOCK, BREAK_TOKEN_INLINE } from "./constants.js";

/**
 * Base break token — continuation token for layout.
 * When a node's content doesn't fit in the current fragmentainer,
 * the layout algorithm produces a fragment and attaches a break token
 * to resume layout in the next fragmentainer.
 */
export class BreakToken {
  constructor(type, node) {
    this.type = type;           // "block" | "inline"
    this.node = node;           // reference to the layout node
    this.isBreakBefore = false;
    this.isForcedBreak = false;
    this.forcedBreakValue = null;
    this.isRepeated = false;
    this.isAtBlockEnd = false;
    this.hasSeenAllChildren = false;
    this.isCausedByColumnSpanner = false;
    this.hasUnpositionedListMarker = false;
  }
}

/**
 * Block break token — for block-level nodes (the primary break token type).
 *
 * Key invariants:
 * - consumedBlockSize is cumulative across ALL previous fragments
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
    this.itemIndex = 0;     // index into InlineItemsData.items
    this.textOffset = 0;    // offset into InlineItemsData.textContent
    this.flags = 0;         // inline-specific state bits
    this.isHyphenated = false; // true when break follows a soft hyphen (U+00AD)
  }
}
