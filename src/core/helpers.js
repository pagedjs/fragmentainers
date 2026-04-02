import { BREAK_TOKEN_BLOCK, BREAK_TOKEN_INLINE } from "./constants.js";

/**
 * @typedef {Object} LayoutNode
 * @property {LayoutNode[]} children
 * @property {number} [blockSize] - Intrinsic block size for leaf nodes
 * @property {boolean} isInlineFormattingContext
 * @property {boolean} isReplacedElement
 * @property {boolean} isScrollable
 * @property {boolean} hasOverflowHidden
 * @property {boolean} hasExplicitBlockSize
 * @property {boolean} isTable
 * @property {boolean} isTableRow
 * @property {boolean} isFlexContainer
 * @property {boolean} isGridContainer
 * @property {Object|null} inlineItemsData
 * @property {Function} computedBlockSize - (availableInlineSize) => number
 * @property {string} flexDirection
 * @property {string} flexWrap
 * @property {number|null} gridRowStart
 * @property {number|null} gridRowEnd
 * @property {boolean} isMulticolContainer
 * @property {number|null} columnCount
 * @property {number|null} columnWidth
 * @property {number|null} columnGap
 * @property {string} columnFill
 * @property {string|null} page - CSS page property value, or null for auto
 * @property {string} breakBefore - CSS break-before value
 * @property {string} breakAfter - CSS break-after value
 * @property {string} breakInside - CSS break-inside value
 * @property {number} orphans
 * @property {number} widows
 */

/**
 * Find a child's break token within a parent's break token.
 * @param {import("./tokens.js").BlockBreakToken|null} parentBreakToken
 * @param {LayoutNode} childNode
 * @returns {import("./tokens.js").BreakToken|null}
 */
export function findChildBreakToken(parentBreakToken, childNode) {
  if (!parentBreakToken) return null;
  return parentBreakToken.childBreakTokens.find(t => t.node === childNode) || null;
}

/**
 * Check if a node is monolithic (cannot be fragmented).
 * Monolithic content contains no possible break points.
 * @param {LayoutNode} node
 * @returns {boolean}
 */
export function isMonolithic(node) {
  return node.isReplacedElement ||
         node.isScrollable ||
         (node.hasOverflowHidden && node.hasExplicitBlockSize);
}

/**
 * Check if a CSS break-before/break-after value is a forced break.
 * Values like "page", "column", "always", "left", "right" force a
 * break; "auto" and "avoid" do not.
 * @param {string} value
 * @returns {boolean}
 */
export function isForcedBreakValue(value) {
  return value && value !== "auto" && value !== "avoid";
}

/**
 * Get the block size of a monolithic element without full layout.
 * @param {LayoutNode} node
 * @param {import("./constraint-space.js").ConstraintSpace} constraintSpace
 * @returns {number}
 */
export function getMonolithicBlockSize(node, constraintSpace) {
  return node.computedBlockSize(constraintSpace.availableInlineSize);
}

/**
 * Debug utility — pretty-print a break token tree.
 */
export function debugPrintTokenTree(breakToken, indent = 0) {
  if (!breakToken) return "(null)";

  const pad = "  ".repeat(indent);
  const flags = [];
  if (breakToken.isBreakBefore) flags.push("break-before");
  if (breakToken.isForcedBreak) flags.push("forced");
  if (breakToken.forcedBreakValue) flags.push(`value=${breakToken.forcedBreakValue}`);
  if (breakToken.isRepeated) flags.push("repeated");
  if (breakToken.isAtBlockEnd) flags.push("at-block-end");
  if (breakToken.hasSeenAllChildren) flags.push("seen-all");

  let line = `${pad}${breakToken.type}`;
  if (breakToken.node?.debugName) line += ` [${breakToken.node.debugName}]`;
  if (breakToken.type === BREAK_TOKEN_BLOCK) {
    line += ` consumed=${breakToken.consumedBlockSize} seq=${breakToken.sequenceNumber}`;
  }
  if (breakToken.type === BREAK_TOKEN_INLINE) {
    line += ` item=${breakToken.itemIndex} offset=${breakToken.textOffset}`;
  }
  if (flags.length) line += ` (${flags.join(", ")})`;

  const lines = [line];
  if (breakToken.childBreakTokens) {
    for (const child of breakToken.childBreakTokens) {
      lines.push(debugPrintTokenTree(child, indent + 1));
    }
  }
  return lines.join("\n");
}
