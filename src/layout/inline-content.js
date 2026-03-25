import { InlineBreakToken } from '../tokens.js';
import { PhysicalFragment } from '../fragment.js';

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
 * @param {Function} measureText - (text) => width in px
 * @param {number} lineHeight
 * @returns {{ fragment: PhysicalFragment, blockSize: number, endItemIndex: number, endTextOffset: number } | null}
 */
function breakLine(inlineItemsData, startItemIndex, startTextOffset, availableInlineSize, measureText, lineHeight) {
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

    if (item.type === 'kControl') {
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

    if (item.type === 'kText') {
      const itemText = textContent.slice(
        Math.max(item.startOffset, textOffset),
        item.endOffset
      );

      // Measure word by word
      const words = itemText.split(/(\s+)/);
      let wordStart = Math.max(item.startOffset, textOffset);

      for (const word of words) {
        if (word.length === 0) continue;

        const wordWidth = measureText(word);

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
          return { fragment, blockSize: lineHeight, endItemIndex: itemIndex, endTextOffset: textOffset };
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
  return { fragment, blockSize: lineHeight, endItemIndex: itemIndex, endTextOffset: textOffset };
}

/**
 * Inline content layout generator.
 *
 * Produces lines from InlineItemsData until block space runs out
 * or all content is consumed. Produces InlineBreakToken when
 * fragmentainer space is exhausted.
 *
 * Content-addressed via itemIndex + textOffset — survives
 * inline-size changes between fragmentainers.
 */
export function* layoutInlineContent(node, constraintSpace, breakToken) {
  const lineFragments = [];
  let blockOffset = 0;

  const inlineItems = node.inlineItemsData;
  const measureText = node.measureText;
  const lineHeight = node.lineHeight || 20;

  // Guard: if no inline items data, return empty fragment
  if (!inlineItems || !inlineItems.items || inlineItems.items.length === 0) {
    const fragment = new PhysicalFragment(node, 0);
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
  const rawAvailable = constraintSpace.availableBlockSize > 0
    ? constraintSpace.availableBlockSize
    : constraintSpace.fragmentainerBlockSize - constraintSpace.blockOffsetInFragmentainer;
  const availableBlockSpace = Math.floor(rawAvailable);

  // If not enough space for even one line and there's content above us on
  // this page, produce a zero-height fragment. The parent will record the
  // break token and the content resumes on the next page with full space.
  // The progress guarantee is enforced at the fragmentainer level, not here.
  if (availableBlockSpace < lineHeight && constraintSpace.blockOffsetInFragmentainer > 0) {
    const fragment = new PhysicalFragment(node, 0, []);
    fragment.inlineSize = constraintSpace.availableInlineSize;
    const inlineToken = new InlineBreakToken(node);
    inlineToken.itemIndex = itemIndex;
    inlineToken.textOffset = textOffset;
    fragment.breakToken = inlineToken;
    return { fragment, breakToken: inlineToken };
  }

  while (itemIndex < inlineItems.items.length) {
    // Check if we have room for another line (use floor to avoid sub-pixel overflow)
    if (Math.floor(blockOffset + lineHeight) > availableBlockSpace && lineFragments.length > 0) {
      break;
    }

    const line = breakLine(
      inlineItems,
      itemIndex,
      textOffset,
      constraintSpace.availableInlineSize,
      measureText,
      lineHeight
    );

    if (line === null) break;

    lineFragments.push(line.fragment);
    blockOffset += line.blockSize;
    itemIndex = line.endItemIndex;
    textOffset = line.endTextOffset;
  }

  const fragment = new PhysicalFragment(node, blockOffset, lineFragments);
  fragment.inlineSize = constraintSpace.availableInlineSize;

  // Produce inline break token if content remains
  const contentRemains = itemIndex < inlineItems.items.length;
  if (contentRemains) {
    const inlineToken = new InlineBreakToken(node);
    inlineToken.itemIndex = itemIndex;
    inlineToken.textOffset = textOffset;
    fragment.breakToken = inlineToken;
  }

  return { fragment, breakToken: fragment.breakToken || null };
}
