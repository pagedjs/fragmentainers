import { findChildBreakToken } from "../core/helpers.js";
import {
	INLINE_TEXT,
	INLINE_CONTROL,
	INLINE_OPEN_TAG,
	INLINE_CLOSE_TAG,
	INLINE_ATOMIC,
	BREAK_TOKEN_INLINE,
} from "../core/constants.js";
import { modules } from "../modules/registry.js";

/**
 * Check if a fragment has block-level child fragments (not line fragments).
 * Line fragments have node === null.
 */
export function hasBlockChildFragments(fragment) {
	return fragment.childFragments.length > 0 && fragment.childFragments.some((f) => f.node !== null);
}

/**
 * Compose a fragment's cloned DOM into a parent element, or — when called
 * without a parentEl — compose all child fragments into a new DocumentFragment.
 *
 * @param {import("../core/fragment.js").PhysicalFragment} fragment
 * @param {import("../core/tokens.js").BreakToken|null} inputBreakToken - break token from the previous fragmentainer
 * @param {Element|null} [parentEl] - target to append into; omit for top-level call
 * @returns {DocumentFragment|undefined} A DocumentFragment when parentEl is omitted
 */
export function composeFragment(fragment, inputBreakToken, parentEl) {
	if (!parentEl) {
		const docFragment = document.createDocumentFragment();
		for (const child of fragment.childFragments) {
			if (!child.node) continue;
			const childInputBT = findChildBreakToken(inputBreakToken, child.node);
			composeFragment(child, childInputBT, docFragment);
		}
		return docFragment;
	}

	if (!fragment.node) return;

	const node = fragment.node;

	if (fragment.multicolData) {
		composeMulticolFragment(fragment, inputBreakToken, parentEl);
	} else if (node.isInlineFormattingContext) {
		composeInlineFragment(fragment, inputBreakToken, parentEl);
	} else if (hasBlockChildFragments(fragment)) {
		const el = node.element.cloneNode(false);
		if (fragment.isRepeated) el.setAttribute("data-repeated", "");
		applySplitAttributes(el, inputBreakToken, fragment);
		if (inputBreakToken && el.tagName === "OL") {
			applyListContinuation(el, node, inputBreakToken);
		}
		for (const child of fragment.childFragments) {
			if (!child.node) continue;
			const childInputBT = findChildBreakToken(inputBreakToken, child.node);
			composeFragment(child, childInputBT, el);
		}
		// Skip empty container shells — all composed children were themselves
		// empty and skipped (e.g. an <ol> whose only <li> had no visible text).
		if (el.childNodes.length === 0 && fragment.breakToken) {
			return;
		}
		parentEl.appendChild(el);
	} else if (
		fragment.childFragments.length === 0 &&
		fragment.breakToken &&
		node.children?.length > 0
	) {
		// Empty container shell — all children pushed to next fragmentainer.
		// Don't compose; content will appear on the next page/column.
		return;
	} else {
		const el = node.element.cloneNode(true);
		if (fragment.isRepeated) el.setAttribute("data-repeated", "");
		applySplitAttributes(el, inputBreakToken, fragment);

		// Sliced monolithic content: wrap in a clip container and offset
		// by the consumed amount to show the correct portion.
		const consumed = inputBreakToken?.consumedBlockSize || 0;
		if (consumed > 0 || fragment.breakToken) {
			const wrapper = document.createElement("div");
			wrapper.style.height = `${fragment.blockSize}px`;
			wrapper.style.overflow = "hidden";
			if (consumed > 0) {
				el.style.marginTop = `-${consumed}px`;
			}
			wrapper.appendChild(el);
			parentEl.appendChild(wrapper);
		} else {
			parentEl.appendChild(el);
		}
	}
}

/**
 * Walk the fragment tree and composed DOM in parallel, registering
 * each clone→source pair in the module registry's shared map.
 *
 * Called once after composeFragment to build the mapping that modules
 * (NthSelectors, MutationSync) use to resolve clone elements back to
 * their source elements.
 *
 * @param {import("../core/fragment.js").PhysicalFragment} fragment
 * @param {import("../core/tokens.js").BreakToken|null} inputBreakToken
 * @param {Element} composedParent
 */
export function mapFragment(fragment, inputBreakToken, composedParent) {
	let childIdx = 0;
	for (const childFrag of fragment.childFragments) {
		if (!childFrag.node) continue;
		const childBT = findChildBreakToken(inputBreakToken, childFrag.node);

		// Skip empty container shells (same logic as composeFragment)
		if (
			childFrag.childFragments.length === 0 &&
			childFrag.breakToken &&
			childFrag.node.children?.length > 0
		)
			continue;

		// Skip empty inline fragments that were suppressed
		if (childFrag.node.isInlineFormattingContext) {
			const data = childFrag.node.inlineItemsData;
			if (data?.items?.length > 0) {
				const startOffset = childBT && childBT.type === BREAK_TOKEN_INLINE ? childBT.textOffset : 0;
				const endOffset =
					childFrag.breakToken && childFrag.breakToken.type === BREAK_TOKEN_INLINE
						? childFrag.breakToken.textOffset
						: data.textContent.length;
				if (startOffset >= endOffset && childFrag.breakToken) continue;
			}
		}

		// Skip blocks whose composed children were all empty (compositor skips these)
		if (hasBlockChildFragments(childFrag)) {
			// Check if this would produce an empty shell after composition
			// We can't know for sure without checking the composed DOM,
			// so just try to match and handle mismatches gracefully
		}

		const clone = composedParent.children[childIdx];
		if (!clone) break;

		if (childFrag.node.element) {
			// For sliced monolithic content, the compositor wraps in a clip div.
			// The actual clone is inside the wrapper.
			const consumed = childBT?.consumedBlockSize || 0;
			if (
				!hasBlockChildFragments(childFrag) &&
				!childFrag.node.isInlineFormattingContext &&
				!childFrag.multicolData &&
				(consumed > 0 || childFrag.breakToken) &&
				childFrag.childFragments.length === 0
			) {
				// Monolithic with clip wrapper — the clone is inside
				const inner = clone.firstElementChild;
				if (inner) {
					mapDeep(inner, childFrag.node.element);
				}
			} else if (childFrag.multicolData) {
				modules.trackClone(clone, childFrag.node.element);
				// Multicol children are synthetic — don't recurse into columns
			} else {
				modules.trackClone(clone, childFrag.node.element);
				if (hasBlockChildFragments(childFrag)) {
					mapFragment(childFrag, childBT, clone);
				} else if (childFrag.node.isInlineFormattingContext) {
					// Inline fragments rebuild content from items — map the container only
				} else {
					// Leaf deep clone
					mapDeep(clone, childFrag.node.element);
				}
			}
		}

		childIdx++;
	}
}

/**
 * Recursively map a deep clone's children to their source counterparts.
 */
function mapDeep(clone, source) {
	modules.trackClone(clone, source);
	const sourceChildren = source.children;
	const cloneChildren = clone.children;
	for (let i = 0; i < sourceChildren.length && i < cloneChildren.length; i++) {
		mapDeep(cloneChildren[i], sourceChildren[i]);
	}
}

/**
 * Compose an inline formatting context fragment.
 * Uses inlineItemsData + break token offsets to reconstruct
 * only the visible portion of the content.
 */
function composeInlineFragment(fragment, inputBreakToken, parentEl) {
	const node = fragment.node;
	const data = node.inlineItemsData;
	const isAnonymous = !node.element;

	if (!data || !data.items || data.items.length === 0) {
		if (!isAnonymous) {
			const el = node.element.cloneNode(false);
			parentEl.appendChild(el);
		}
		return;
	}

	const startOffset =
		inputBreakToken && inputBreakToken.type === BREAK_TOKEN_INLINE ? inputBreakToken.textOffset : 0;
	const endOffset =
		fragment.breakToken && fragment.breakToken.type === BREAK_TOKEN_INLINE
			? fragment.breakToken.textOffset
			: data.textContent.length;

	// No visible text in this fragment and content continues on the next
	// fragmentainer — skip to avoid empty element shells (e.g. an <li>
	// that shows only its ::marker with no text).
	if (startOffset >= endOffset && fragment.breakToken) {
		return;
	}

	const ws = isAnonymous ? "normal" : node.whiteSpace;
	const collapseWS = !ws.startsWith("pre");
	const isHyphenated = fragment.breakToken?.isHyphenated ?? false;

	if (isAnonymous) {
		const docFragment = document.createDocumentFragment();
		buildInlineContent(
			data.items,
			data.textContent,
			startOffset,
			endOffset,
			docFragment,
			collapseWS,
			isHyphenated,
		);
		parentEl.appendChild(docFragment);
	} else {
		const el = node.element.cloneNode(false);
		applySplitAttributes(el, inputBreakToken, fragment);
		buildInlineContent(
			data.items,
			data.textContent,
			startOffset,
			endOffset,
			el,
			collapseWS,
			isHyphenated,
		);
		parentEl.appendChild(el);
	}
}

/**
 * Compose a multicol container fragment.
 * Clones the element, disables native columns, composes each column
 * child as a flex item with correct width and gap.
 */
function composeMulticolFragment(fragment, inputBreakToken, parentEl) {
	const node = fragment.node;
	const { columnWidth, columnGap } = fragment.multicolData;

	const el = node.element.cloneNode(false);
	el.style.columns = "auto";
	el.style.columnCount = "auto";
	el.style.columnWidth = "auto";
	el.style.columnGap = "0";
	el.style.columnFill = "initial";
	el.style.display = "flex";
	el.style.flexWrap = "nowrap";
	el.style.alignItems = "flex-start";

	for (let i = 0; i < fragment.childFragments.length; i++) {
		const colFragment = fragment.childFragments[i];

		if (i > 0 && columnGap > 0) {
			const gapEl = document.createElement("div");
			gapEl.style.width = `${columnGap}px`;
			gapEl.style.flexShrink = "0";
			el.appendChild(gapEl);
		}

		const colEl = document.createElement("div");
		colEl.style.width = `${columnWidth}px`;
		colEl.style.height = `${fragment.blockSize}px`;
		colEl.style.overflow = "hidden";
		colEl.style.flexShrink = "0";

		// Thread break tokens: col 0 uses inputBreakToken, col N uses col N-1's breakToken
		const colInputBT = i === 0 ? inputBreakToken : fragment.childFragments[i - 1].breakToken;

		for (const child of colFragment.childFragments) {
			if (!child.node) continue;
			const childInputBT = findChildBreakToken(colInputBT, child.node);
			composeFragment(child, childInputBT, colEl);
		}

		el.appendChild(colEl);
	}

	parentEl.appendChild(el);
}

/**
 * Mark cloned elements with data-split-from / data-split-to attributes
 * so the override stylesheet can suppress first/last-fragment-only CSS.
 *
 * @param {Element} el - The cloned element
 * @param {import("../core/tokens.js").BreakToken|null} inputBreakToken - non-null if continuation
 * @param {import("../core/fragment.js").PhysicalFragment} fragment
 */
function applySplitAttributes(el, inputBreakToken, fragment) {
	if (
		inputBreakToken &&
		!inputBreakToken.isBreakBefore &&
		(inputBreakToken.type === BREAK_TOKEN_INLINE
			? inputBreakToken.textOffset > 0
			: inputBreakToken.consumedBlockSize > 0)
	)
		el.setAttribute("data-split-from", "");
	if (fragment.breakToken) {
		el.setAttribute("data-split-to", "");
		if (fragment.node.textAlign === "justify") {
			el.setAttribute("data-justify-last", "");
		}
	}
}

/**
 * Set the start attribute on a continuation <ol> so list numbering
 * continues from the previous fragment rather than restarting at 1.
 *
 * Uses the break token's child structure to count how many list items
 * were composed in previous fragments.
 */
function applyListContinuation(el, node, inputBreakToken) {
	const originalStart = parseInt(node.element.getAttribute("start"), 10) || 1;
	const firstChildToken = inputBreakToken.childBreakTokens?.[0];
	if (!firstChildToken) return;

	const childIndex = node.children.indexOf(firstChildToken.node);
	if (childIndex < 0) return;

	let itemCount = 0;
	for (let i = 0; i < childIndex; i++) {
		if (node.children[i].element?.tagName === "LI") itemCount++;
	}

	if (!firstChildToken.isBreakBefore && node.children[childIndex]?.element?.tagName === "LI") {
		const hadVisibleContent =
			firstChildToken.type === BREAK_TOKEN_INLINE
				? firstChildToken.textOffset > 0
				: firstChildToken.consumedBlockSize > 0;
		if (hadVisibleContent) {
			itemCount++;
		}
	}

	el.setAttribute("start", String(originalStart + itemCount));
}

/**
 * Build DOM content from inline items within the given text offset range.
 * Reconstructs text nodes, inline elements, <br>s, and atomic inlines
 * for only the visible portion of the content.
 *
 * @param {Object[]} items - InlineItemsData.items array
 * @param {string} textContent - concatenated text string
 * @param {number} startOffset - visible range start (from input break token)
 * @param {number} endOffset - visible range end (from output break token)
 * @param {Element} container - DOM element to append content into
 * @param {boolean} [collapseWS=false] - collapse whitespace runs
 */
export function buildInlineContent(
	items,
	textContent,
	startOffset,
	endOffset,
	container,
	collapseWS = false,
	_isHyphenated = false,
) {
	let current = container;
	const stack = [];
	let lastTextNode = null;
	let i = 0;

	while (i < items.length) {
		const item = items[i];

		if (item.type === INLINE_TEXT) {
			const itemStart = item.startOffset;
			const itemEnd = item.endOffset;

			if (itemEnd <= startOffset) {
				i++;
				continue;
			}
			if (itemStart >= endOffset) break;

			const visStart = Math.max(itemStart, startOffset);
			const visEnd = Math.min(itemEnd, endOffset);
			let text = textContent.slice(visStart, visEnd);
			if (collapseWS) text = text.replace(/\s+/g, " ");

			if (text.length > 0) {
				lastTextNode = document.createTextNode(text);
				current.appendChild(lastTextNode);
			}
		} else if (item.type === INLINE_OPEN_TAG) {
			if (
				item.startOffset < item.endOffset &&
				(item.endOffset <= startOffset || item.startOffset >= endOffset)
			) {
				let depth = 1;
				i++;
				while (i < items.length && depth > 0) {
					if (items[i].type === INLINE_OPEN_TAG) depth++;
					else if (items[i].type === INLINE_CLOSE_TAG) depth--;
					i++;
				}
				continue;
			}
			const el = item.element.cloneNode(false);
			current.appendChild(el);
			stack.push(current);
			current = el;
		} else if (item.type === INLINE_CLOSE_TAG) {
			current = stack.pop() || container;
		} else if (item.type === INLINE_CONTROL) {
			if (item.startOffset >= startOffset && item.startOffset < endOffset) {
				current.appendChild(document.createElement("br"));
			}
		} else if (item.type === INLINE_ATOMIC) {
			if (item.startOffset >= startOffset && item.startOffset < endOffset) {
				const el = item.element.cloneNode(true);
				current.appendChild(el);
			}
		}

		i++;
	}

	// Trim trailing whitespace at break boundaries — the space before
	// the break is not composed (it belongs to the inter-word gap).
	if (lastTextNode && endOffset < textContent.length) {
		lastTextNode.textContent = lastTextNode.textContent.replace(/\s+$/, "");
	}
}
