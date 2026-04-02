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
 * Check if a CSS break value requires a specific page side.
 * Only left/right/recto/verso are side-specific; page/column/always are not.
 * @param {string} value
 * @returns {boolean}
 */
export function isSideSpecificBreak(value) {
  return value === "left" || value === "right" ||
         value === "recto" || value === "verso";
}

/**
 * Return the required page side for a side-specific break value.
 * Normalizes recto → "right" and verso → "left" (LTR page progression).
 * @param {string} value
 * @returns {"left"|"right"|null}
 */
export function requiredPageSide(value) {
  if (value === "right" || value === "recto") return "right";
  if (value === "left" || value === "verso") return "left";
  return null;
}

/**
 * Walk the break token tree to find the forcedBreakValue that triggered the break.
 * Follows the last child at each level (the active break path).
 * @param {import("./tokens.js").BlockBreakToken|null} breakToken
 * @returns {string|null}
 */
export function resolveForcedBreakValue(breakToken) {
  if (!breakToken) return null;
  let current = breakToken;
  while (current.childBreakTokens && current.childBreakTokens.length > 0) {
    const lastChild = current.childBreakTokens[current.childBreakTokens.length - 1];
    if (lastChild.isForcedBreak && lastChild.forcedBreakValue) {
      return lastChild.forcedBreakValue;
    }
    if (lastChild.isBreakBefore) break;
    current = lastChild;
  }
  return current.forcedBreakValue || null;
}

/**
 * Resolve the break-before CSS value of the first child that will appear
 * on the next page. Used to detect side-specific breaks when blockOffset === 0
 * prevented the forced break from firing in layoutBlockContainer.
 *
 * @param {LayoutNode} rootNode
 * @param {import("./tokens.js").BlockBreakToken|null} breakToken
 * @returns {string|null}
 */
export function resolveNextPageBreakBefore(rootNode, breakToken) {
  if (!breakToken) {
    return rootNode.children[0]?.breakBefore || null;
  }
  let current = breakToken;
  while (current.childBreakTokens && current.childBreakTokens.length > 0) {
    const lastChild = current.childBreakTokens[current.childBreakTokens.length - 1];
    if (lastChild.isBreakBefore) {
      return lastChild.node?.breakBefore || null;
    }
    current = lastChild;
  }
  const nextChild = findNextUnvisitedChild(rootNode, breakToken);
  return nextChild?.breakBefore || null;
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
 * Read the CSS `page` property from a node.
 * @param {LayoutNode} node
 * @returns {string|null}
 */
export function getNamedPage(node) {
  if (!node) return null;
  return node.page || null;
}

/**
 * Walk the break token tree to find the named page for the next page.
 *
 * Determines which element will be first on the next page and reads its
 * CSS `page` property to drive @page rule resolution.
 *
 * @param {LayoutNode} rootNode
 * @param {import("./tokens.js").BlockBreakToken|null} breakToken
 * @returns {string|null}
 */
export function resolveNamedPageForBreakToken(rootNode, breakToken) {
  if (!breakToken) {
    // First page — use the first child's page property
    const firstChild = rootNode.children[0];
    return getNamedPage(firstChild);
  }

  // Walk break token children to find the resumption point
  let current = breakToken;
  while (current.childBreakTokens && current.childBreakTokens.length > 0) {
    const lastChild = current.childBreakTokens[current.childBreakTokens.length - 1];
    if (lastChild.isBreakBefore) {
      // This child will be the first thing on the next page
      return getNamedPage(lastChild.node);
    }
    current = lastChild;
  }

  // The break is inside `currentNode`. Find the next unvisited sibling
  // by walking back up the tree.
  return getNamedPage(findNextUnvisitedChild(rootNode, breakToken));
}

/**
 * Find the next child that hasn't been fully laid out, given a break token.
 * Walks from the deepest break token child up to find a next sibling.
 *
 * @param {LayoutNode} rootNode
 * @param {import("./tokens.js").BlockBreakToken} breakToken
 * @returns {LayoutNode|null}
 */
function findNextUnvisitedChild(rootNode, breakToken) {
  // Build a path from root break token to deepest child
  const path = [];
  let current = breakToken;
  while (current.childBreakTokens && current.childBreakTokens.length > 0) {
    const lastChild = current.childBreakTokens[current.childBreakTokens.length - 1];
    path.push({ token: current, childToken: lastChild });
    current = lastChild;
  }

  // Walk from deepest to shallowest looking for a next sibling
  const nodes = [rootNode];
  for (const { childToken } of path) {
    const parentNode = nodes[nodes.length - 1];
    const children = parentNode.children;
    const idx = children.indexOf(childToken.node);
    if (idx !== -1 && idx + 1 < children.length) {
      return children[idx + 1];
    }
    nodes.push(childToken.node);
  }

  return null;
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
