import { InlineBreakToken, DEFAULT_HYPHEN } from "../fragmentation/tokens.js";
import { Fragment } from "../fragmentation/fragment.js";
import { BreakScore } from "../fragmentation/break-scoring.js";
import { INLINE_TEXT, INLINE_CONTROL, INLINE_ATOMIC } from "../measurement/collect-inlines.js";
import { DEFAULT_OVERFLOW_THRESHOLD } from "../fragmentation/fragmentation-context.js";
import { FRAGMENTATION_NONE } from "../fragmentation/constraint-space.js";
import { computeLineExtents } from "../measurement/line-box.js";

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

// White-space values that collapse trailing space at a soft wrap
// (CSS Text §4.1.1).
const COLLAPSING_WHITE_SPACE = new Set(["normal", "nowrap", "pre-line", "pre-wrap"]);

function hasTrailingCollapsibleSpace(items, textContent, flatOffset) {
	if (flatOffset <= 0 || flatOffset > textContent.length) return false;
	if (textContent.charCodeAt(flatOffset - 1) !== 0x20) return false;
	const loc = findItemAtOffset(items, flatOffset - 1);
	if (!loc) return false;
	return COLLAPSING_WHITE_SPACE.has(loc.item.whiteSpace || "normal");
}

function skipLeadingCollapsibleSpace(items, textContent, flatOffset) {
	let item = null;
	while (flatOffset < textContent.length) {
		if (textContent.charCodeAt(flatOffset) !== 0x20) return flatOffset;
		// Reuse the current text item while the offset stays within it; only
		// rescan when the run crosses into the next item (avoids an O(items)
		// findItemAtOffset per space char).
		if (!item || flatOffset < item.startOffset || flatOffset >= item.endOffset) {
			const loc = findItemAtOffset(items, flatOffset);
			if (!loc) return flatOffset;
			item = loc.item;
		}
		if (!COLLAPSING_WHITE_SPACE.has(item.whiteSpace || "normal")) return flatOffset;
		flatOffset += 1;
	}
	return flatOffset;
}

/**
 * Classify the break as hyphenated, honoring the containing item's
 * `hyphens` CSS property. Returns the resolved `hyphenate-character`
 * glyph (ready to render) or null when the break is not hyphenated.
 *
 * `hyphens: manual` → soft-hyphen (U+00AD) break points only
 * `hyphens: auto`   → soft-hyphen OR mid-word dictionary breaks
 * `hyphens: none`   → never hyphenated
 */
function computeHyphenation(items, textContent, flatOffset) {
	if (flatOffset <= 0 || flatOffset >= textContent.length) return null;
	const loc = findItemAtOffset(items, flatOffset - 1);
	if (!loc) return null;

	const hyphens = loc.item.hyphens || "manual";
	if (hyphens === "none") return null;

	const before = textContent.charCodeAt(flatOffset - 1);
	const after = textContent.charCodeAt(flatOffset);
	const isWordChar = (c) => c > 0x20 && c !== 0x00ad;
	const softHyphenBefore = before === 0x00ad;
	const midWord = isWordChar(before) && isWordChar(after);

	const hyphenated = softHyphenBefore || (hyphens === "auto" && midWord);
	if (!hyphenated) return null;

	return resolveHyphenateCharacter(loc.item.hyphenateCharacter);
}

// Computed style serializes `<string>` with quotes intact (e.g. `"-"`,
// `"\u2053"`) and passes CSS escape sequences through unevaluated. This
// strips one layer of straight quotes; it does not re-evaluate escapes
// or handle escaped quotes within the string.
function resolveHyphenateCharacter(raw) {
	if (!raw || raw === "auto") return DEFAULT_HYPHEN;
	const m = raw.match(/^"(.*)"$|^'(.*)'$/);
	return m ? (m[1] ?? m[2]) : raw;
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
 * Lays out the line boxes of an anonymous inline node (the inline-level
 * content of a block container) and breaks between them — Class B break
 * points (CSS Fragmentation §4.1). The box that contains the lines is the
 * block container's concern: its block-size, padding, border and
 * decorations at breaks are handled by BlockContainerAlgorithm, so a
 * fragment produced here is exactly the extent of the lines it places.
 *
 * Content-addressed via itemIndex + textOffset — survives
 * inline-size changes between fragmentainers.
 *
 * Never yields a LayoutRequest — all measurement happens via the
 * node's inlineItemsData + measurer. The `*layout()` generator still
 * runs under the standard dispatch protocol; it returns the final
 * `{ fragment, breakToken, breakScore }` on its first `.next()`.
 */
// Sub-pixel slack when snapping a character's ink top onto a line top.
const LINE_SNAP_TOLERANCE = 0.0625;

/**
 * Index of the line whose top is at or above `y` — the line a character with
 * ink top `y` renders on.
 */
function lineIndexAtTop(tops, y) {
	if (!Number.isFinite(y)) return tops.length;
	for (let i = tops.length - 1; i >= 0; i--) {
		if (y >= tops[i] - LINE_SNAP_TOLERANCE) return i;
	}
	return 0;
}

export class InlineContentAlgorithm {
	#node;
	#constraintSpace;

	// Cross-phase state (set during layout, consumed by #buildOutput)
	#lineFragments = [];
	#blockOffset = 0;
	#itemIndex;
	#textOffset;
	#consumedLines = 0;
	#remainingLines = 0;
	#lineExtents = [];
	#hasTrailingCollapsibleSpace = false;

	// Class A break scoring (earlyBreakTarget) is only implemented by
	// BlockContainerAlgorithm — inline content emits its own breakScore.
	constructor(node, constraintSpace, breakToken) {
		this.#node = node;
		this.#constraintSpace = constraintSpace;
		this.#itemIndex = breakToken?.itemIndex ?? 0;
		this.#textOffset = breakToken?.textOffset ?? 0;
	}

	get node() {
		return this.#node;
	}

	// eslint-disable-next-line require-yield
	*layout() {
		const inlineItems = this.#node.inlineItemsData;

		// Nothing that produces a line box (no items, or only open/close tags):
		// the containing block sizes itself from the browser measurement.
		if (!inlineItems?.items?.length || !hasContentItems(inlineItems.items)) {
			return this.#buildEmptyFragment();
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

	/**
	 * Block extent of `count` line boxes starting at `first`. Line boxes tile
	 * their containing block, so a run of them is the sum of its own advances
	 * — never a line count times one nominal height, which is wrong for every
	 * line that carries something taller than the strut.
	 */
	#extentOf(first, count) {
		let extent = 0;
		for (let i = 0; i < count; i++) extent += this.#lineExtent(first + i);
		return extent;
	}

	#lineExtent(index) {
		const extent = this.#lineExtents[index];
		return extent > 0 ? extent : this.#node.lineHeight || DEFAULT_OVERFLOW_THRESHOLD;
	}

	#layoutLines() {
		const inlineItems = this.#node.inlineItemsData;
		const measurer = this.#node.measurer;
		const lineHeight = this.#node.lineHeight || DEFAULT_OVERFLOW_THRESHOLD;

		// The extent of the line boxes, measured across the inline content
		// itself (a Range), so the containing block's own size never enters
		// the line count.
		const contentRect = this.#node.contentRect;
		const contentHeight = contentRect.height;
		const measured = this.#node.measureLines();
		const accurateLineHeight = measured.lineHeight > 0 ? measured.lineHeight : lineHeight;
		this.#lineExtents = computeLineExtents(measured, lineHeight, this.#node.contentBoxExtent);
		const totalLines =
			measured.count > 0 ? measured.count : Math.round(contentHeight / accurateLineHeight);

		// Which line the break token resumes on (for continuation fragments).
		// The token's character is snapped to a measured line top rather than
		// divided by a nominal line height, so lines of differing extent do
		// not accumulate an error in the resume index.
		let resumeLine = 0;
		if (this.#textOffset > 0) {
			const loc = findItemAtOffset(inlineItems.items, this.#textOffset);
			if (loc) {
				const charY = measurer.charTop(loc.item.domNode, loc.localOffset);
				resumeLine = lineIndexAtTop(measured.tops, charY);
			}
		}
		const availableBlockSpace = this.#availableBlockSpace();
		this.#consumedLines = Math.min(Math.max(0, resumeLine), totalLines);
		this.#remainingLines = totalLines - this.#consumedLines;
		const remainingHeight = this.#extentOf(this.#consumedLines, this.#remainingLines);

		if (remainingHeight <= availableBlockSpace) {
			// FAST PATH — all remaining line boxes fit. Range bounds describe
			// glyph ink, not the line-box extent, so the measured count above is
			// still required even though no break offset needs to be found.
			if (this.#remainingLines < 1) this.#remainingLines = 1;

			for (let i = 0; i < this.#remainingLines; i++) {
				this.#lineFragments.push(new Fragment(null, this.#lineExtent(this.#consumedLines + i)));
			}
			this.#blockOffset = this.#extentOf(this.#consumedLines, this.#remainingLines);

			// Consume everything
			this.#itemIndex = inlineItems.items.length;
			this.#textOffset = inlineItems.textContent.length;
			return false;
		}

		// SLOW PATH — content breaks. Walk the same per-line extents the fast
		// path sums, so the modelled size of a run of lines does not depend on
		// how much room it was offered.
		let fittingLines = 0;
		let fittingExtent = 0;
		while (fittingLines < this.#remainingLines) {
			const next = fittingExtent + this.#lineExtent(this.#consumedLines + fittingLines);
			if (next > availableBlockSpace) break;
			fittingExtent = next;
			fittingLines += 1;
		}
		// Guarantee at least one line for progress when at top of page
		const minLines =
			this.#remainingLines > 0 && this.#constraintSpace.blockOffsetInFragmentainer === 0 ? 1 : 0;
		let linesToPlace = Math.max(minLines, Math.min(this.#remainingLines, fittingLines));

		// Orphans/widows clamping (CSS Fragmentation §4.4 Rule 3)
		const contentWillBreak = linesToPlace < this.#remainingLines;
		if (contentWillBreak && this.#constraintSpace.fragmentationType !== FRAGMENTATION_NONE) {
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
			this.#lineFragments.push(new Fragment(null, this.#lineExtent(this.#consumedLines + i)));
		}
		this.#blockOffset = this.#extentOf(this.#consumedLines, linesToPlace);

		if (linesToPlace >= this.#remainingLines) {
			this.#itemIndex = inlineItems.items.length;
			this.#textOffset = inlineItems.textContent.length;
			return false;
		}
		const breakLineIndex = this.#consumedLines + linesToPlace;
		let breakFlatOffset = measurer.offsetAtLine(inlineItems.items, measured.tops, breakLineIndex);
		if (breakFlatOffset == null) {
			// No DOM text offset covers the break: the run is atomic inlines end to
			// end, or its text renders through a native pseudo whose line count came
			// from the height fallback. Either way the run cannot be split.
			if (this.#constraintSpace.blockOffsetInFragmentainer > 0) return null;
			// Top of the fragmentainer: with no earlier one to push back to, the run
			// overflows — refusing it would stall the fragmentation loop.
			for (let i = linesToPlace; i < this.#remainingLines; i++) {
				this.#lineFragments.push(new Fragment(null, this.#lineExtent(this.#consumedLines + i)));
			}
			this.#blockOffset = this.#extentOf(this.#consumedLines, this.#remainingLines);
			this.#itemIndex = inlineItems.items.length;
			this.#textOffset = inlineItems.textContent.length;
			return false;
		}

		// Advance past a leading collapsed space so page N+1 doesn't
		// start with one, and flag a trailing collapsed space so the
		// render layer trims it off page N (Chromium parity — see
		// references/chromium-inline-break-token-findings.md).
		breakFlatOffset = skipLeadingCollapsibleSpace(
			inlineItems.items,
			inlineItems.textContent,
			breakFlatOffset,
		);
		this.#hasTrailingCollapsibleSpace = hasTrailingCollapsibleSpace(
			inlineItems.items,
			inlineItems.textContent,
			breakFlatOffset,
		);

		const pos = advanceToOffset(inlineItems.items, breakFlatOffset, inlineItems.textContent.length);
		this.#itemIndex = pos.itemIndex;
		this.#textOffset = pos.textOffset;
		return true;
	}

	#buildOutput(contentRemains) {
		const inlineItems = this.#node.inlineItemsData;
		const fragment = new Fragment(this.#node, this.#blockOffset, this.#lineFragments);
		fragment.inlineSize = this.#constraintSpace.availableInlineSize;

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

		let breakScore = BreakScore.PERFECT;

		if (actuallyRemains) {
			const inlineToken = new InlineBreakToken(this.#node);
			inlineToken.itemIndex = this.#itemIndex;
			inlineToken.textOffset = this.#textOffset;
			inlineToken.hasTrailingCollapsibleSpace = this.#hasTrailingCollapsibleSpace;

			const hyphen = computeHyphenation(
				inlineItems.items,
				inlineItems.textContent,
				this.#textOffset,
			);
			if (hyphen) {
				inlineToken.isHyphenated = true;
				inlineToken.hyphenateCharacter = hyphen;
			}

			fragment.breakToken = inlineToken;

			// Score the break for orphans/widows (CSS Fragmentation §4.4 Rule 3)
			if (this.#constraintSpace.fragmentationType !== FRAGMENTATION_NONE) {
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
