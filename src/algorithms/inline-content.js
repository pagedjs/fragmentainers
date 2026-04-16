import { BlockBreakToken, InlineBreakToken } from "../fragmentation/tokens.js";
import { Fragment } from "../fragmentation/fragment.js";
import { BreakScore } from "../fragmentation/break-scoring.js";
import { INLINE_TEXT, INLINE_CONTROL, INLINE_ATOMIC } from "../measurement/collect-inlines.js";
import { DEFAULT_OVERFLOW_THRESHOLD } from "../fragmentation/fragmentation-context.js";
import { FRAGMENTATION_NONE } from "../fragmentation/constraint-space.js";
import { measureLines } from "../measurement/line-box.js";

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
 * True if the item list contains any content-carrying items
 * (text, control, or atomic) — i.e. anything that can produce a line box.
 * False for lists of only open/close tags, where the element is empty.
 */
function hasContentItems(items) {
	return items.some(
		(item) =>
			item.type === INLINE_TEXT || item.type === INLINE_CONTROL || item.type === INLINE_ATOMIC,
	);
}

/**
 * Inline content layout algorithm.
 *
 * Uses the element's rendered height for accurate line counting and
 * binary search for break offsets.
 *
 * Content-addressed via itemIndex + textOffset — survives
 * inline-size changes between fragmentainers.
 *
 * Never yields a LayoutRequest — all measurement happens via the
 * node's inlineItemsData + measurer. The `*layout()` generator still
 * runs under the standard dispatch protocol; it returns the final
 * `{ fragment, breakToken, breakScore }` on its first `.next()`.
 */
export class InlineContentAlgorithm {
	#node;
	#constraintSpace;
	#breakToken;

	// Cross-phase state (set during layout, consumed by #buildOutput)
	#lineFragments = [];
	#blockOffset = 0;
	#itemIndex;
	#textOffset;
	#consumedLines = 0;
	#remainingLines = 0;

	// Class A break scoring (earlyBreakTarget) is only implemented by
	// BlockContainerAlgorithm — inline content emits its own breakScore.
	constructor(node, constraintSpace, breakToken) {
		this.#node = node;
		this.#constraintSpace = constraintSpace;
		this.#breakToken = breakToken;
		this.#itemIndex = breakToken?.itemIndex ?? 0;
		this.#textOffset = breakToken?.textOffset ?? 0;
	}

	// eslint-disable-next-line require-yield
	*layout() {
		const inlineItems = this.#node.inlineItemsData;

		// Guard: no inline data at all → empty fragment
		if (!inlineItems?.items?.length) return this.#buildEmptyFragment();

		// Guard: only non-content items (empty element with pseudo-content) → monolithic
		if (!hasContentItems(inlineItems.items)) return this.#buildMonolithicFragment();

		// Explicit CSS height: box size is authoritative (not line count).
		// Fragment by box height, slicing at fragmentainer boundaries — the
		// element's own content positions itself within each slice.
		if (this.#node.element && this.#node.computedBlockSize() != null) {
			return this.#layoutExplicitHeight();
		}

		// Guard: insufficient space for even one line → zero-height continuation
		if (this.#insufficientSpace()) return this.#buildInsufficientSpaceFragment();

		const contentRemains = this.#layoutLines();
		// Slow path may signal "no lines fit at this point in the fragmentainer" by
		// returning null — produce the same zero-height continuation as the guard above.
		if (contentRemains === null) return this.#buildInsufficientSpaceFragment();
		return this.#buildOutput(contentRemains);
	}

	#buildEmptyFragment() {
		const fragment = new Fragment(this.#node, 0);
		fragment.inlineSize = this.#constraintSpace.availableInlineSize;
		return { fragment, breakToken: null };
	}

	#buildMonolithicFragment() {
		let measuredHeight = 0;
		if (this.#node.element) {
			measuredHeight = this.#node.isTableCell
				? this.#node.intrinsicBlockSize
				: this.#node.element.getBoundingClientRect().height;
		}
		const fragment = new Fragment(this.#node, measuredHeight);
		fragment.inlineSize = this.#constraintSpace.availableInlineSize;
		return { fragment, breakToken: null };
	}

	#layoutExplicitHeight() {
		const totalHeight = this.#node.borderBoxBlockSize();
		const consumed = this.#breakToken?.consumedBlockSize || 0;
		const remaining = totalHeight - consumed;
		const available = this.#availableBlockSpace();
		const fits =
			this.#constraintSpace.fragmentationType === FRAGMENTATION_NONE ||
			remaining <= available ||
			available <= 0;

		const fragment = new Fragment(this.#node, fits ? remaining : available);
		fragment.inlineSize = this.#constraintSpace.availableInlineSize;

		if (fits) return { fragment, breakToken: null };

		const token = new BlockBreakToken(this.#node);
		token.consumedBlockSize = consumed + available;
		token.sequenceNumber = (this.#breakToken?.sequenceNumber ?? -1) + 1;
		token.hasSeenAllChildren = true;
		fragment.breakToken = token;
		return { fragment, breakToken: token };
	}

	#insufficientSpace() {
		const lineHeight = this.#node.lineHeight || DEFAULT_OVERFLOW_THRESHOLD;
		const availableBlockSpace = this.#availableBlockSpace();
		return availableBlockSpace < lineHeight && this.#constraintSpace.blockOffsetInFragmentainer > 0;
	}

	#buildInsufficientSpaceFragment() {
		const fragment = new Fragment(this.#node, 0, []);
		fragment.inlineSize = this.#constraintSpace.availableInlineSize;
		const inlineToken = new InlineBreakToken(this.#node);
		inlineToken.itemIndex = this.#itemIndex;
		inlineToken.textOffset = this.#textOffset;
		fragment.breakToken = inlineToken;
		return { fragment, breakToken: inlineToken };
	}

	#availableBlockSpace() {
		// Use availableBlockSize (set by parent), which accounts for ancestor
		// padding/border reservations. Fall back to fragmentainer math if not set.
		return this.#constraintSpace.availableBlockSize > 0
			? this.#constraintSpace.availableBlockSize
			: this.#constraintSpace.fragmentainerBlockSize -
					this.#constraintSpace.blockOffsetInFragmentainer;
	}

	#layoutLines() {
		const inlineItems = this.#node.inlineItemsData;
		const measurer = this.#node.measurer;
		const lineHeight = this.#node.lineHeight || DEFAULT_OVERFLOW_THRESHOLD;

		// Box insets (padding + border) for IFC elements that have their own
		// box model — mirrors block-container.js handling.
		const boxStart = (this.#node.paddingBlockStart || 0) + (this.#node.borderBlockStart || 0);
		const boxEnd = (this.#node.paddingBlockEnd || 0) + (this.#node.borderBlockEnd || 0);
		const isFirstFragment = !this.#breakToken;

		// Get the element's rendered height from the browser.
		// Anonymous blocks (from mixed-content wrapping) have no element;
		// fall back to a Range-based contentRect.
		const element = this.#node.element;
		const elementRect = element ? element.getBoundingClientRect() : this.#node.contentRect;
		const totalHeight = elementRect.height;

		// Compute consumed height from break token (for continuation fragments)
		let consumedHeight = 0;
		if (this.#textOffset > 0) {
			const loc = findItemAtOffset(inlineItems.items, this.#textOffset);
			if (loc) {
				const charY = measurer.charTop(loc.item.domNode, loc.localOffset);
				consumedHeight = charY - elementRect.top;
			}
		}
		const availableBlockSpace = this.#availableBlockSpace();
		const remainingHeight = totalHeight - consumedHeight;

		if (remainingHeight <= availableBlockSpace) {
			// FAST PATH — all remaining content fits, no expensive measurement needed.
			// Use lineHeight (which may be DPR-adjusted for normalized output)
			// as the authoritative per-line height for block size computation.
			// Line count is derived from content height (excluding box insets).
			// Table cells are stretched to the row's tallest cell by the browser,
			// so deriving line count from content height over-counts. Use actual
			// line-box enumeration instead.
			const contentHeight = totalHeight - boxStart - boxEnd;
			const totalLines =
				this.#node.isTableCell && element
					? measureLines(element).count
					: Math.round(contentHeight / lineHeight);
			this.#consumedLines = isFirstFragment
				? 0
				: Math.round(Math.max(0, consumedHeight - boxStart) / lineHeight);
			this.#remainingLines = totalLines - this.#consumedLines;
			if (this.#remainingLines < 1) this.#remainingLines = 1;

			for (let i = 0; i < this.#remainingLines; i++) {
				this.#lineFragments.push(new Fragment(null, lineHeight));
			}
			this.#blockOffset = (isFirstFragment ? boxStart : 0) + this.#remainingLines * lineHeight;

			// Consume everything
			this.#itemIndex = inlineItems.items.length;
			this.#textOffset = inlineItems.textContent.length;
			return false;
		}

		// SLOW PATH — content breaks. Use accurate gap-based line height
		// from measureLines() to determine exactly how many lines fit.
		const measured = element ? measureLines(element) : null;
		const accurateLineHeight =
			measured && measured.lineHeight > 0 ? measured.lineHeight : lineHeight;
		const contentHeight = totalHeight - boxStart - boxEnd;
		const totalLines =
			measured && measured.count > 0
				? measured.count
				: Math.round(contentHeight / accurateLineHeight);

		this.#consumedLines = isFirstFragment
			? 0
			: Math.round(Math.max(0, consumedHeight - boxStart) / accurateLineHeight);
		this.#remainingLines = totalLines - this.#consumedLines;
		const fittingLines = Math.floor(
			(availableBlockSpace - (isFirstFragment ? boxStart : 0)) / accurateLineHeight,
		);
		// Guarantee at least one line for progress when at top of page
		const minLines =
			this.#remainingLines > 0 && this.#constraintSpace.blockOffsetInFragmentainer === 0 ? 1 : 0;
		let linesToPlace = Math.max(minLines, Math.min(this.#remainingLines, fittingLines));

		// Orphans/widows clamping (CSS Fragmentation §4.4 Rule 3)
		const contentWillBreak = linesToPlace < this.#remainingLines;
		if (contentWillBreak && this.#constraintSpace.fragmentationType !== "none") {
			const orphans = this.#node.orphans || 2;
			const widows = this.#node.widows || 2;

			if (orphans + widows > this.#remainingLines) {
				if (this.#remainingLines <= fittingLines) {
					linesToPlace = this.#remainingLines;
				}
			} else {
				if (linesToPlace < orphans && fittingLines >= orphans) {
					linesToPlace = orphans;
				}
				const linesAfter = this.#remainingLines - linesToPlace;
				if (linesAfter < widows && linesAfter > 0) {
					const maxLines = this.#remainingLines - widows;
					if (maxLines >= orphans && maxLines > 0) {
						linesToPlace = maxLines;
					}
				}
			}
		}

		if (linesToPlace <= 0 && this.#constraintSpace.blockOffsetInFragmentainer > 0) {
			// Signal to *layout(): no lines fit at this point in the fragmentainer
			// → caller should produce a zero-height continuation fragment.
			return null;
		}

		for (let i = 0; i < linesToPlace; i++) {
			this.#lineFragments.push(new Fragment(null, accurateLineHeight));
		}
		this.#blockOffset = (isFirstFragment ? boxStart : 0) + linesToPlace * accurateLineHeight;

		if (linesToPlace >= this.#remainingLines) {
			this.#itemIndex = inlineItems.items.length;
			this.#textOffset = inlineItems.textContent.length;
			return false;
		}
		// Find the text offset at the break line.
		// Content starts at boxStart below the element's border-box top.
		const yCutoff =
			elementRect.top + boxStart + (this.#consumedLines + linesToPlace) * accurateLineHeight;

		let breakFlatOffset;
		if (element && measurer.offsetAtY) {
			breakFlatOffset = measurer.offsetAtY(element, inlineItems.items, yCutoff);
		}
		if (breakFlatOffset == null) {
			const searchStart = this.#textOffset;
			const searchEnd = inlineItems.textContent.length;
			breakFlatOffset = findBreakOffset(
				measurer,
				inlineItems.items,
				searchStart,
				searchEnd,
				yCutoff,
			);
		}

		const pos = advanceToOffset(inlineItems.items, breakFlatOffset, inlineItems.textContent.length);
		this.#itemIndex = pos.itemIndex;
		this.#textOffset = pos.textOffset;
		return true;
	}

	#buildOutput(contentRemains) {
		const inlineItems = this.#node.inlineItemsData;
		const boxEnd = (this.#node.paddingBlockEnd || 0) + (this.#node.borderBlockEnd || 0);
		const fragment = new Fragment(this.#node, this.#blockOffset, this.#lineFragments);
		fragment.inlineSize = this.#constraintSpace.availableInlineSize;
		fragment.lineCount = this.#lineFragments.length;

		// Produce inline break token if content remains.
		// Skip trailing non-content items (close tags, whitespace-only text, BRs)
		// so we don't create a break token for insignificant trailing content.
		let actuallyRemains = false;
		if (contentRemains && this.#itemIndex < inlineItems.items.length) {
			for (let j = this.#itemIndex; j < inlineItems.items.length; j++) {
				const item = inlineItems.items[j];
				if (item.type === INLINE_ATOMIC) {
					actuallyRemains = true;
					break;
				}
				if (item.type === INLINE_TEXT) {
					const text = inlineItems.textContent.slice(
						Math.max(item.startOffset, this.#textOffset),
						item.endOffset,
					);
					if (text.trim().length > 0) {
						actuallyRemains = true;
						break;
					}
				}
			}
			if (!actuallyRemains) {
				// Only insignificant content remains — consume everything
				this.#itemIndex = inlineItems.items.length;
				this.#textOffset = inlineItems.textContent.length;
			}
		}

		// Add bottom box inset (padding + border) on the last fragment only
		if (!actuallyRemains) {
			fragment.blockSize += boxEnd;
		}

		let breakScore = BreakScore.PERFECT;

		if (actuallyRemains) {
			const inlineToken = new InlineBreakToken(this.#node);
			inlineToken.itemIndex = this.#itemIndex;
			inlineToken.textOffset = this.#textOffset;

			// Detect mid-word break: non-whitespace/non-control text characters
			// on both sides of the break offset indicate a hyphenated break
			// (soft hyphen, hyphens:auto dictionary break, etc.)
			if (this.#textOffset > 0 && this.#textOffset < inlineItems.textContent.length) {
				const before = inlineItems.textContent.charCodeAt(this.#textOffset - 1);
				const after = inlineItems.textContent.charCodeAt(this.#textOffset);
				const isTextChar = (c) => c > 0x20 && c !== 0x00ad;
				if (isTextChar(before) && isTextChar(after)) {
					inlineToken.isHyphenated = true;
				}
			}

			fragment.breakToken = inlineToken;

			// Score the break for orphans/widows (CSS Fragmentation §4.4 Rule 3)
			if (this.#constraintSpace.fragmentationType !== "none") {
				const orphans = this.#node.orphans || 2;
				const widows = this.#node.widows || 2;
				const linesPlaced = this.#lineFragments.length;
				const totalLinesInElement = this.#consumedLines + this.#remainingLines;
				const linesAfterBreak = this.#remainingLines - linesPlaced;

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
}
