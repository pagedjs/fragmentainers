import { InlineBreakToken } from "../core/tokens.js";
import { PhysicalFragment } from "../core/fragment.js";
import { BreakScore } from "../core/break-scoring.js";
import { INLINE_TEXT, INLINE_CONTROL, INLINE_ATOMIC } from "../core/constants.js";

/**
 * Break a single line from inline items starting at the given position.
 *
 * Uses word-by-word measurement. Breaks at word boundaries (spaces).
 * Returns the line fragment info, or null if no space for even one line.
 *
 * @param {Object} inlineItemsData - { items: InlineItem[], textContent: string }
 * @param {number} startItemIndex
 * @param {number} startTextOffset
 * @param {number} availableInlineSize - line width
 * @param {Object} measurer - { measureRange(textNode, start, end) => width }
 * @param {number} lineHeight
 * @returns {{ fragment: PhysicalFragment, blockSize: number, endItemIndex: number, endTextOffset: number } | null}
 */
function breakLine(
  inlineItemsData,
  startItemIndex,
  startTextOffset,
  availableInlineSize,
  measurer,
  lineHeight,
) {
  const { items, textContent } = inlineItemsData;

  if (startItemIndex >= items.length) return null;

  let currentWidth = 0;
  let lastBreakItemIndex = startItemIndex;
  let lastBreakTextOffset = startTextOffset;
  let hasContent = false;
  let forcedBreak = false;

  let itemIndex = startItemIndex;
  let textOffset = startTextOffset;

  while (itemIndex < items.length) {
    const item = items[itemIndex];

    if (item.type === INLINE_CONTROL) {
      // Forced line break (<br>)
      if (hasContent) {
        // End the line here, advance past the control
        forcedBreak = true;
        itemIndex++;
        textOffset = item.endOffset;
        break;
      } else {
        // Empty line before the break
        forcedBreak = true;
        itemIndex++;
        textOffset = item.endOffset;
        break;
      }
    }

    if (item.type === INLINE_TEXT) {
      const itemText = textContent.slice(
        Math.max(item.startOffset, textOffset),
        item.endOffset,
      );

      // Measure word by word using Range on the live DOM Text node
      const words = itemText.split(/(\s+)/);
      let wordStart = Math.max(item.startOffset, textOffset);

      for (const word of words) {
        if (word.length === 0) continue;

        const localOffset = wordStart - item.startOffset;
        const wordWidth = measurer.measureRange(
          item.domNode,
          localOffset,
          localOffset + word.length,
        );

        if (currentWidth + wordWidth > availableInlineSize && hasContent) {
          // Line is full — break before this word
          // Revert to last break opportunity
          itemIndex = lastBreakItemIndex;
          textOffset = lastBreakTextOffset;

          // If we haven't moved past the start, we need to take at least one word
          if (textOffset === startTextOffset && itemIndex === startItemIndex) {
            textOffset = wordStart + word.length;
            // Check if we've consumed the entire item
            if (textOffset >= item.endOffset) {
              itemIndex++;
              if (itemIndex < items.length) {
                textOffset = items[itemIndex].startOffset;
              }
            }
          }

          const fragment = new PhysicalFragment(null, lineHeight);
          fragment.inlineSize = currentWidth;
          return {
            fragment,
            blockSize: lineHeight,
            endItemIndex: itemIndex,
            endTextOffset: textOffset,
          };
        }

        currentWidth += wordWidth;
        hasContent = true;
        wordStart += word.length;

        // Whitespace is a break opportunity
        if (/\s/.test(word)) {
          lastBreakItemIndex = itemIndex;
          lastBreakTextOffset = wordStart;
          // Check if we've reached the end of this item
          if (wordStart >= item.endOffset) {
            lastBreakItemIndex = itemIndex + 1;
            if (lastBreakItemIndex < items.length) {
              lastBreakTextOffset = items[lastBreakItemIndex].startOffset;
            }
          }
        }
      }

      // Consumed entire text item
      itemIndex++;
      if (itemIndex < items.length) {
        textOffset = items[itemIndex].startOffset;
      } else {
        textOffset = textContent.length;
      }
      // End of item is a break opportunity
      lastBreakItemIndex = itemIndex;
      lastBreakTextOffset = textOffset;
      continue;
    }

    // Skip kOpenTag, kCloseTag, kAtomicInline for now
    itemIndex++;
    if (itemIndex < items.length) {
      textOffset = items[itemIndex].startOffset;
    } else {
      textOffset = textContent.length;
    }
  }

  // Consumed all remaining content for this line
  if (!hasContent && !forcedBreak) return null;

  const fragment = new PhysicalFragment(null, lineHeight);
  fragment.inlineSize = currentWidth;
  return {
    fragment,
    blockSize: lineHeight,
    endItemIndex: itemIndex,
    endTextOffset: textOffset,
  };
}

/**
 * Given a flat textContent offset, find the kText item that contains it
 * and return the item index plus the local offset within that item's domNode.
 * Returns null if the offset falls outside any kText item.
 */
function findItemAtOffset(items, flatOffset) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type !== INLINE_TEXT) continue;
    if (flatOffset >= item.startOffset && flatOffset < item.endOffset) {
      return { itemIndex: i, localOffset: flatOffset - item.startOffset, item };
    }
  }
  return null;
}

/**
 * Binary search across the inline items to find the flat textContent offset
 * where content transitions past a given Y cutoff.
 *
 * @param {Object} measurer - must have charTop(textNode, localOffset)
 * @param {Object[]} items - InlineItemsData.items
 * @param {number} searchStart - flat offset to start searching from
 * @param {number} searchEnd - flat offset to search up to
 * @param {number} yCutoff - the Y position threshold
 * @returns {number} flat textContent offset of the first char past the cutoff
 */
function findBreakOffset(measurer, items, searchStart, searchEnd, yCutoff) {
  let lo = searchStart;
  let hi = searchEnd;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const loc = findItemAtOffset(items, mid);

    if (!loc) {
      // Offset is in a non-text item (control, tag) — move forward
      lo = mid + 1;
      continue;
    }

    const top = measurer.charTop(loc.item.domNode, loc.localOffset);
    if (top >= yCutoff) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

/**
 * Advance itemIndex/textOffset to the item containing a given flat offset.
 */
function advanceToOffset(items, flatOffset, textContentLength) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.endOffset > flatOffset) {
      return { itemIndex: i, textOffset: flatOffset };
    }
  }
  return { itemIndex: items.length, textOffset: textContentLength };
}

/**
 * Inline content layout generator.
 *
 * When a DOM measurer with charTop() is available, uses the element's
 * rendered height for accurate line counting and binary search for
 * break offsets. Falls back to word-by-word breakLine() for mock/test nodes.
 *
 * Content-addressed via itemIndex + textOffset — survives
 * inline-size changes between fragmentainers.
 */
// eslint-disable-next-line require-yield
export function* layoutInlineContent(node, constraintSpace, breakToken) {
  const lineFragments = [];
  let blockOffset = 0;

  const inlineItems = node.inlineItemsData;
  const measurer = node.measurer;
  const lineHeight = node.lineHeight || 20;

  // Guard: if no inline items data, return empty fragment
  if (!inlineItems || !inlineItems.items || inlineItems.items.length === 0) {
    const fragment = new PhysicalFragment(node, 0);
    fragment.inlineSize = constraintSpace.availableInlineSize;
    return { fragment, breakToken: null };
  }

  // If items exist but carry no content (only open/close tags, e.g. empty
  // elements with CSS pseudo-element content), treat as monolithic and use
  // the browser-measured height.
  const hasContentItems = inlineItems.items.some(
    (item) =>
      item.type === INLINE_TEXT ||
      item.type === INLINE_CONTROL ||
      item.type === INLINE_ATOMIC,
  );
  if (!hasContentItems) {
    const measuredHeight = node.element
      ? node.element.getBoundingClientRect().height
      : 0;
    const fragment = new PhysicalFragment(node, measuredHeight);
    fragment.inlineSize = constraintSpace.availableInlineSize;
    return { fragment, breakToken: null };
  }

  // Determine start position from break token
  let itemIndex = breakToken?.itemIndex ?? 0;
  let textOffset = breakToken?.textOffset ?? 0;

  // Use availableBlockSize (set by parent), which accounts for ancestor
  // padding/border reservations. Fall back to fragmentainer math if not set.
  // Floor the result — browsers round fragmentainer sizes down to integers
  // when printing, and fractional line-heights accumulate floating-point error.
  const rawAvailable =
    constraintSpace.availableBlockSize > 0
      ? constraintSpace.availableBlockSize
      : constraintSpace.fragmentainerBlockSize -
        constraintSpace.blockOffsetInFragmentainer;
  const availableBlockSpace = Math.floor(rawAvailable);

  // If not enough space for even one line and there's content above us in
  // this fragmentainer, produce a zero-height fragment. The parent will record the
  // break token and the content resumes in the next fragmentainer with full space.
  // The progress guarantee is enforced at the fragmentainer level, not here.
  if (
    availableBlockSpace < lineHeight &&
    constraintSpace.blockOffsetInFragmentainer > 0
  ) {
    const fragment = new PhysicalFragment(node, 0, []);
    fragment.inlineSize = constraintSpace.availableInlineSize;
    const inlineToken = new InlineBreakToken(node);
    inlineToken.itemIndex = itemIndex;
    inlineToken.textOffset = textOffset;
    fragment.breakToken = inlineToken;
    return { fragment, breakToken: inlineToken };
  }

  // Use browser element height when available (DOM node with element),
  // fall back to word-by-word breakLine() for mock/test nodes.
  const useBrowserHeight = measurer.charTop != null && node.element != null;

  // Hoisted for orphans/widows scoring at the end
  let consumedLines = 0;
  let remainingLines = 0;

  if (useBrowserHeight) {
    // Get the element's rendered height from the browser
    const element = node.element;
    const elementRect = element.getBoundingClientRect();
    const totalHeight = elementRect.height;

    // Compute total lines from the element's actual rendered height.
    // This is accurate regardless of inline elements splitting text nodes.
    const totalLines = Math.round(totalHeight / lineHeight);

    // How many lines were already consumed (from break token)?
    // The element top + consumed lines * lineHeight = where we resume.
    if (textOffset > 0) {
      // Find the Y position of the first char we're resuming at
      const loc = findItemAtOffset(inlineItems.items, textOffset);
      if (loc) {
        const charY = measurer.charTop(loc.item.domNode, loc.localOffset);
        consumedLines = Math.round((charY - elementRect.top) / lineHeight);
      }
    }

    remainingLines = totalLines - consumedLines;
    const fittingLines = Math.floor(availableBlockSpace / lineHeight);
    // Guarantee at least one line for progress when at top of page
    const minLines =
      remainingLines > 0 && constraintSpace.blockOffsetInFragmentainer === 0
        ? 1
        : 0;
    let linesToPlace = Math.max(
      minLines,
      Math.min(remainingLines, fittingLines),
    );

    // Orphans/widows clamping (CSS Fragmentation §4.4 Rule 3)
    const contentWillBreak = linesToPlace < remainingLines;
    if (contentWillBreak && constraintSpace.fragmentationType !== "none") {
      const orphans = node.orphans || 2;
      const widows = node.widows || 2;

      if (orphans + widows > remainingLines) {
        // Fewer lines than constraints — keep all together if they fit
        if (remainingLines <= fittingLines) {
          linesToPlace = remainingLines;
        }
        // Otherwise can't satisfy — place what fits, score as violation
      } else {
        // Clamp for orphans (minimum lines before break)
        if (linesToPlace < orphans && fittingLines >= orphans) {
          linesToPlace = orphans;
        }
        // Clamp for widows (minimum lines after break)
        const linesAfter = remainingLines - linesToPlace;
        if (linesAfter < widows && linesAfter > 0) {
          const maxLines = remainingLines - widows;
          if (maxLines >= orphans && maxLines > 0) {
            linesToPlace = maxLines;
          }
        }
      }
    }

    if (linesToPlace <= 0 && constraintSpace.blockOffsetInFragmentainer > 0) {
      // No lines fit — defer to next fragmentainer
      const fragment = new PhysicalFragment(node, 0, []);
      fragment.inlineSize = constraintSpace.availableInlineSize;
      const inlineToken = new InlineBreakToken(node);
      inlineToken.itemIndex = itemIndex;
      inlineToken.textOffset = textOffset;
      fragment.breakToken = inlineToken;
      return { fragment, breakToken: inlineToken };
    }

    // Create line fragments
    for (let i = 0; i < linesToPlace; i++) {
      lineFragments.push(new PhysicalFragment(null, lineHeight));
    }
    blockOffset = linesToPlace * lineHeight;

    if (linesToPlace >= remainingLines) {
      // All remaining content fits — consume everything
      itemIndex = inlineItems.items.length;
      textOffset = inlineItems.textContent.length;
    } else {
      // Need to break — find the text offset at the break line
      const yCutoff =
        elementRect.top + (consumedLines + linesToPlace) * lineHeight;
      const searchStart = textOffset;
      const searchEnd = inlineItems.textContent.length;

      const breakFlatOffset = findBreakOffset(
        measurer,
        inlineItems.items,
        searchStart,
        searchEnd,
        yCutoff,
        linesToPlace,
        remainingLines,
      );

      const pos = advanceToOffset(
        inlineItems.items,
        breakFlatOffset,
        inlineItems.textContent.length,
      );
      itemIndex = pos.itemIndex;
      textOffset = pos.textOffset;
    }
  } else {
    // Fallback: word-by-word measurement (for tests with mock nodes)
    while (itemIndex < inlineItems.items.length) {
      if (
        Math.floor(blockOffset + lineHeight) > availableBlockSpace &&
        lineFragments.length > 0
      ) {
        break;
      }

      const line = breakLine(
        inlineItems,
        itemIndex,
        textOffset,
        constraintSpace.availableInlineSize,
        measurer,
        lineHeight,
      );

      if (line === null) break;

      lineFragments.push(line.fragment);
      blockOffset += line.blockSize;
      itemIndex = line.endItemIndex;
      textOffset = line.endTextOffset;
    }
  }

  const fragment = new PhysicalFragment(node, blockOffset, lineFragments);
  fragment.inlineSize = constraintSpace.availableInlineSize;
  fragment.lineCount = lineFragments.length;

  // Produce inline break token if content remains.
  // Skip trailing non-content items (close tags, whitespace-only text, BRs)
  // so we don't create a break token for insignificant trailing content.
  let contentRemains = false;
  if (itemIndex < inlineItems.items.length) {
    for (let j = itemIndex; j < inlineItems.items.length; j++) {
      const item = inlineItems.items[j];
      if (item.type === INLINE_ATOMIC) {
        contentRemains = true;
        break;
      }
      if (item.type === INLINE_TEXT) {
        const text = inlineItems.textContent.slice(
          Math.max(item.startOffset, textOffset),
          item.endOffset,
        );
        if (text.trim().length > 0) {
          contentRemains = true;
          break;
        }
      }
    }
    if (!contentRemains) {
      // Only insignificant content remains — consume everything
      itemIndex = inlineItems.items.length;
      textOffset = inlineItems.textContent.length;
    }
  }
  let breakScore = BreakScore.PERFECT;

  if (contentRemains) {
    const inlineToken = new InlineBreakToken(node);
    inlineToken.itemIndex = itemIndex;
    inlineToken.textOffset = textOffset;

    // Detect mid-word break: non-whitespace/non-control text characters
    // on both sides of the break offset indicate a hyphenated break
    // (soft hyphen, hyphens:auto dictionary break, etc.)
    if (textOffset > 0 && textOffset < inlineItems.textContent.length) {
      const before = inlineItems.textContent.charCodeAt(textOffset - 1);
      const after = inlineItems.textContent.charCodeAt(textOffset);
      const isTextChar = (c) => c > 0x20 && c !== 0x00AD;
      if (isTextChar(before) && isTextChar(after)) {
        inlineToken.isHyphenated = true;
      }
    }

    fragment.breakToken = inlineToken;

    // Score the break for orphans/widows (CSS Fragmentation §4.4 Rule 3)
    if (constraintSpace.fragmentationType !== "none") {
      const orphans = node.orphans || 2;
      const widows = node.widows || 2;
      const linesPlaced = lineFragments.length;
      const totalLinesInElement = consumedLines + remainingLines;
      const linesAfterBreak = remainingLines - linesPlaced;

      if (totalLinesInElement > 0) {
        if (orphans + widows > totalLinesInElement) {
          // Fewer lines than constraints — should keep all together
          breakScore = BreakScore.VIOLATING_ORPHANS_WIDOWS;
        } else if (linesPlaced < orphans || linesAfterBreak < widows) {
          breakScore = BreakScore.VIOLATING_ORPHANS_WIDOWS;
        }
      }
    }
  }

  return { fragment, breakToken: fragment.breakToken || null, breakScore };
}
