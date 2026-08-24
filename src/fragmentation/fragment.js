import {
	findChildBreakToken,
	BREAK_TOKEN_BLOCK,
	BREAK_TOKEN_INLINE,
	DEFAULT_HYPHEN,
} from "./tokens.js";
import {
	INLINE_TEXT,
	INLINE_CONTROL,
	INLINE_OPEN_TAG,
	INLINE_CLOSE_TAG,
	INLINE_ATOMIC,
} from "../measurement/collect-inlines.js";
import { isPseudoElement } from "../handlers/pseudo-elements.js";
import { ensureFlowContext } from "./flow-context.js";
import { isMonolithic } from "../layout/layout-helpers.js";
import { CloneMap } from "./clone-map.js";

/**
 * The output of a layout algorithm — a positioned fragment.
 * Represents the portion of a CSS box that belongs to exactly one fragmentainer.
 */
export class Fragment {
	constructor(node, blockSize, childFragments = []) {
		this.node = node;
		this.blockSize = blockSize;
		this.inlineSize = 0;
		this.childFragments = childFragments;
		this.breakToken = null;
		this.constraints = null;
		this.multicolData = null;
		this.isRepeated = false;
		this.truncateMarginBlockStart = false;
		this.truncateMarginBlockEnd = false;
		this.isBlank = false;
		this.counterState = null;
		this.flowSnapshots = [];
		this.pushedBreakMark = 0;
		this.afterRender = null;
		this.isFirst = false;
		this.blockOffset = 0;
		this.isLast = false;
		this.needsBlockClip = false;
		// The box's block-size is specified: its fragments are slices of that
		// block-size (CSS Fragmentation §5.3) rather than sized by content.
		this.hasFixedBlockSize = false;
	}

	/**
	 * Check if this fragment has block-level child fragments (not line fragments).
	 * Line fragments have node === null.
	 */
	get hasBlockChildren() {
		return this.childFragments.length > 0 && this.childFragments.some((f) => f.node !== null);
	}

	/**
	 * Build this fragment's cloned DOM into a new DocumentFragment.
	 * Top-level entry point for composition.
	 *
	 * @param {import("./tokens.js").BreakToken|null} inputBreakToken - break token from the previous fragmentainer
	 * @returns {DocumentFragment}
	 */
	build(inputBreakToken) {
		// The root node's flow owns the clone→source map for this build.
		// Child nodes need no context of their own for composition.
		const cloneMap = this.node ? ensureFlowContext(this.node).cloneMap : new CloneMap();
		const docFragment = document.createDocumentFragment();
		for (const child of this.childFragments) {
			if (!child.node) continue;
			const childInputBT = findChildBreakToken(inputBreakToken, child.node);
			child.#buildInto(childInputBT, docFragment, cloneMap);
		}
		return docFragment;
	}

	/**
	 * Build this fragment's cloned DOM into a parent element.
	 * Recursive workhorse — dispatches to type-specific builders.
	 *
	 * @param {import("./tokens.js").BreakToken|null} inputBreakToken
	 * @param {Element} parentEl
	 * @param {import("./clone-map.js").CloneMap} cloneMap
	 */
	#buildInto(inputBreakToken, parentEl, cloneMap) {
		if (!this.node) return;

		// A done token (isAtBlockEnd) means this box's own extent finished on an
		// earlier fragmentainer in a parallel flow — a completed table cell, flex
		// item or grid item, or a fixed-size box whose content overflows its
		// block-end (§2.1). Its extent must not be re-rendered, but its box has
		// to stay: dropping it would collapse the track it holds and shift the
		// siblings that do continue. Overflowing content still continuing is
		// built into it as overflow of a box with no extent of its own.
		if (inputBreakToken?.type === BREAK_TOKEN_BLOCK && inputBreakToken.isAtBlockEnd) {
			if (!this.node.element) return;
			const emptied = this.node.element.cloneNode(false);
			this.#applySplitAttributes(emptied, inputBreakToken);
			if (emptied.tagName === "OL") this.#applyListContinuation(emptied, inputBreakToken);
			cloneMap.track(emptied, this.node.element);
			if (this.childFragments.length > 0) {
				this.#buildChildren(emptied, inputBreakToken, cloneMap);
			}
			applyPastBlockEnd(emptied);
			parentEl.appendChild(emptied);
			return;
		}

		const node = this.node;

		if (this.multicolData) {
			this.#buildMulticol(inputBreakToken, parentEl, cloneMap);
		} else if (node.isInlineNode) {
			this.#buildInline(inputBreakToken, parentEl);
		} else if (this.hasBlockChildren) {
			const el = node.element.cloneNode(false);
			if (this.isRepeated) el.setAttribute("data-repeated", "");
			this.#applySplitAttributes(el, inputBreakToken);
			if (this.truncateMarginBlockStart) el.setAttribute("data-truncate-margin", "");
			if (this.truncateMarginBlockEnd) el.setAttribute("data-truncate-margin-end", "");
			if (inputBreakToken && el.tagName === "OL") {
				this.#applyListContinuation(el, inputBreakToken);
			}
			this.#buildChildren(el, inputBreakToken, cloneMap);
			// Skip empty container shells — all built children were themselves
			// empty and skipped (e.g. an <ol> whose only <li> had no visible text).
			if (el.childNodes.length === 0 && this.breakToken && !this.needsBlockClip) {
				this.breakToken.wasSuppressed = true;
				return;
			}
			cloneMap.track(el, node.element);
			if (node.isTable && consumedBlockSize(inputBreakToken) > 0 && !this.needsBlockClip) {
				// A table's specified height is a minimum for the whole table, not
				// for each reconstructed continuation fragment (CSS2 §17.5.3).
				el.style.setProperty("height", "auto", "important");
				el.style.setProperty("min-height", "0", "important");
				parentEl.appendChild(el);
			} else if (
				this.hasFixedBlockSize &&
				(consumedBlockSize(inputBreakToken) > 0 ||
					!!this.breakToken?.continuesInFlow)
			) {
				// A continuation of a fixed-size box with content shows the rest
				// of that block-size (§5.3), with its content — and any overflow
				// of it (§2.1) — laid out from the top of the continuation.
				this.#appendSizedFragment(el, parentEl, inputBreakToken);
			} else if (this.needsBlockClip) {
				if (node.boxDecorationBreak === "clone" && !isMonolithic(node)) {
					this.#appendSizedFragment(el, parentEl, inputBreakToken);
				} else {
					this.#appendWithBlockSlice(el, parentEl, inputBreakToken);
				}
			} else {
				parentEl.appendChild(el);
			}
		} else if (
			this.childFragments.length === 0 &&
			this.breakToken &&
			node.children?.length > 0 &&
			!this.needsBlockClip
		) {
			// Empty container shell — all children pushed to next fragmentainer.
			// Don't build; content will appear on the next page/column. A block-clip
			// slice is not a shell: it falls through so the visible slice renders.
			return;
		} else if (this.childFragments.length === 0 && this.needsBlockClip && !isMonolithic(node)) {
			// The rest of a box whose block-size outran the fragmentainer after
			// all its content was placed (CSS Fragmentation §5.3): an empty box
			// showing only this fragment's slice of the decorations.
			const el = node.element.cloneNode(false);
			this.#applySplitAttributes(el, inputBreakToken);
			cloneMap.track(el, node.element);
			if (node.boxDecorationBreak === "clone") {
				this.#appendSizedFragment(el, parentEl, inputBreakToken);
			} else {
				this.#appendWithBlockSlice(el, parentEl, inputBreakToken);
			}
		} else {
			const el = node.element.cloneNode(true);
			if (this.isRepeated) el.setAttribute("data-repeated", "");
			this.#applySplitAttributes(el, inputBreakToken);
			if (this.truncateMarginBlockStart) el.setAttribute("data-truncate-margin", "");
			if (this.truncateMarginBlockEnd) el.setAttribute("data-truncate-margin-end", "");
			cloneMap.trackDeep(el, node.element);
			if (this.needsBlockClip) {
				this.#appendWithBlockSlice(el, parentEl, inputBreakToken);
			} else {
				parentEl.appendChild(el);
			}
		}
	}

	/**
	 * Build the block-level child fragments into the clone of this box.
	 */
	#buildChildren(el, inputBreakToken, cloneMap) {
		// Grid rows and flex lines are anonymous: several child fragments can
		// share this node, and each must take its own token.
		const taken = new Set();
		for (const child of this.childFragments) {
			if (!child.node) continue;
			// Skip materialized pseudo elements at wrong split boundaries
			if (child.node.element && !this.#shouldBuildPseudo(child.node.element, inputBreakToken))
				continue;
			const childInputBT = findChildBreakToken(inputBreakToken, child.node, taken);
			child.#buildInto(childInputBT, el, cloneMap);
		}
	}

	/**
	 * Build the line boxes of an anonymous inline node straight into the
	 * containing block's clone. Uses inlineItemsData + break token offsets
	 * to reconstruct only the visible portion of the content.
	 */
	#buildInline(inputBreakToken, parentEl) {
		const node = this.node;
		const data = node.inlineItemsData;
		if (!data || !data.items || data.items.length === 0) return;

		const startOffset =
			inputBreakToken && inputBreakToken.type === BREAK_TOKEN_INLINE
				? inputBreakToken.textOffset
				: 0;
		const endOffset =
			this.breakToken && this.breakToken.type === BREAK_TOKEN_INLINE
				? this.breakToken.textOffset
				: data.textContent.length;

		// No visible text in this fragment and content continues on the next
		// fragmentainer — skip to avoid empty element shells (e.g. an <li>
		// that shows only its ::marker with no text).
		if (startOffset >= endOffset && this.breakToken) {
			return;
		}

		const collapseWS = !node.whiteSpace.startsWith("pre");
		const isInlineToken = this.breakToken?.type === BREAK_TOKEN_INLINE;
		const hasTrailingCollapsibleSpace = isInlineToken
			? this.breakToken.hasTrailingCollapsibleSpace
			: false;
		const isHyphenated = isInlineToken ? this.breakToken.isHyphenated : false;
		const hyphenateCharacter = isInlineToken ? this.breakToken.hyphenateCharacter : DEFAULT_HYPHEN;

		// Build context for pseudo element suppression at split boundaries
		const isContinuation =
			inputBreakToken &&
			!inputBreakToken.isBreakBefore &&
			(inputBreakToken.type === BREAK_TOKEN_INLINE
				? inputBreakToken.textOffset > 0
				: inputBreakToken.consumedBlockSize > 0);
		const pseudoContext = {
			isContinuation: !!isContinuation,
			willContinue: !!this.breakToken,
		};

		const docFragment = document.createDocumentFragment();
		Fragment.buildInlineContent(data.items, data.textContent, startOffset, endOffset, docFragment, {
			collapseWS,
			pseudoContext,
			hasTrailingCollapsibleSpace,
			isHyphenated,
			hyphenateCharacter,
		});
		parentEl.appendChild(docFragment);
	}

	#appendWithBlockSlice(el, parentEl, inputBreakToken) {
		const consumed = consumedBlockSize(inputBreakToken);
		const wrapper = document.createElement("div");
		wrapper.style.height = `${this.blockSize}px`;
		wrapper.style.overflow = "hidden";
		if (consumed > 0) {
			el.style.setProperty("margin-top", `-${consumed}px`, "important");
		}
		wrapper.appendChild(el);
		parentEl.appendChild(wrapper);
	}

	/**
	 * Size an independently composed fragment without changing its inline-axis
	 * box model. For content-box elements, translate the fragment's border-box
	 * block size back to the CSS height after accounting for the decorations
	 * that this fragment actually paints.
	 */
	#appendSizedFragment(el, parentEl, inputBreakToken) {
		const node = this.node;
		const isClone = node.boxDecorationBreak === "clone";
		const isContinuation = consumedBlockSize(inputBreakToken) > 0;
		const continuesOwnBox = !!this.breakToken?.continuesInFlow;
		let insets = 0;
		if (isClone || !isContinuation) {
			insets += node.paddingBlockStart + node.borderBlockStart;
		}
		if (isClone || !continuesOwnBox) {
			insets += node.paddingBlockEnd + node.borderBlockEnd;
		}
		const height = node.boxSizing === "border-box" ? this.blockSize : this.blockSize - insets;
		el.style.setProperty("min-height", "0", "important");
		el.style.setProperty("max-height", "none", "important");
		el.style.setProperty("height", `${Math.max(0, height)}px`, "important");
		parentEl.appendChild(el);
	}

	/**
	 * Build a multicol container fragment.
	 * Clones the element, disables native columns, builds each column
	 * child as a flex item with correct width and gap.
	 */
	#buildMulticol(inputBreakToken, parentEl, cloneMap) {
		const node = this.node;
		const { columnWidth, columnGap, columnHeight } = this.multicolData;
		const columnBlockSize = columnHeight ?? this.blockSize;

		const el = node.element.cloneNode(false);
		cloneMap.track(el, node.element);
		// Columns are fragmentainers: they clip at the column height, not at
		// the multicol's used block-size, which a parallel flow (§2.1) adds
		// nothing to. The multicol keeps that used size.
		const insets =
			node.paddingBlockStart + node.borderBlockStart + node.paddingBlockEnd + node.borderBlockEnd;
		el.style.setProperty(
			"height",
			`${node.boxSizing === "border-box" ? this.blockSize + insets : this.blockSize}px`,
			"important",
		);
		el.style.columns = "auto";
		el.style.columnCount = "auto";
		el.style.columnWidth = "auto";
		el.style.columnGap = "0";
		el.style.columnFill = "initial";
		el.style.display = "flex";
		el.style.flexWrap = "nowrap";
		el.style.alignItems = "flex-start";

		for (let i = 0; i < this.childFragments.length; i++) {
			const colFragment = this.childFragments[i];

			if (i > 0 && columnGap > 0) {
				const gapEl = document.createElement("div");
				gapEl.style.width = `${columnGap}px`;
				gapEl.style.flexShrink = "0";
				el.appendChild(gapEl);
			}

			const colEl = document.createElement("div");
			colEl.style.width = `${columnWidth}px`;
			colEl.style.height = `${columnBlockSize}px`;
			colEl.style.overflow = "hidden";
			colEl.style.flexShrink = "0";

			// Thread break tokens: col 0 uses inputBreakToken, col N uses col N-1's breakToken
			const colInputBT = i === 0 ? inputBreakToken : this.childFragments[i - 1].breakToken;

			for (const child of colFragment.childFragments) {
				if (!child.node) continue;
				const childInputBT = findChildBreakToken(colInputBT, child.node);
				child.#buildInto(childInputBT, colEl, cloneMap);
			}

			el.appendChild(colEl);
		}

		parentEl.appendChild(el);
	}

	/**
	 * Determine whether a materialized pseudo element should be built
	 * into the current fragment. ::before is excluded on continuation
	 * fragments; ::after is excluded on non-last fragments.
	 *
	 * @param {Element} element — the <frag-pseudo> element
	 * @param {import("./tokens.js").BreakToken|null} inputBreakToken — parent's input break token
	 * @returns {boolean} true if the pseudo should be included
	 */
	#shouldBuildPseudo(element, inputBreakToken) {
		if (!isPseudoElement(element)) return true;
		const which = element.dataset.pseudo;
		// ::before only appears on the first fragment (no inputBreakToken)
		if (which === "before" && inputBreakToken && !inputBreakToken.isBreakBefore) return false;
		// ::after only appears on the last fragment (no output breakToken)
		if (which === "after" && this.breakToken) return false;
		return true;
	}

	/**
	 * Mark cloned elements with data-split-from / data-split-to attributes
	 * so the override stylesheet can suppress first/last-fragment-only CSS.
	 *
	 * @param {Element} el - The cloned element
	 * @param {import("./tokens.js").BreakToken|null} inputBreakToken - non-null if continuation
	 */
	#applySplitAttributes(el, inputBreakToken) {
		const isContinuation =
			inputBreakToken &&
			!inputBreakToken.isBreakBefore &&
			(inputBreakToken.type === BREAK_TOKEN_INLINE
				? inputBreakToken.textOffset > 0
				: (inputBreakToken.consumedBlockSize > 0 || inputBreakToken.isAtBlockEnd) &&
					!inputBreakToken.wasSuppressed);
		if (isContinuation) {
			el.setAttribute("data-split-from", "");
		}
		if (this.breakToken) {
			// A box at its block-end is complete, decorations included; only
			// its overflow continues (§2.1).
			if (this.breakToken.continuesInFlow) el.setAttribute("data-split-to", "");
			this.#applyTextAlignLast(el);
		}
		if (this.node.boxDecorationBreak === "clone" && (isContinuation || this.breakToken)) {
			el.setAttribute("data-box-decoration-clone", "");
		}
	}

	#isDeepestSplitElement() {
		// The anonymous inline node's break belongs to this element: it is the
		// box the lines are in.
		const childBreakTokens = this.breakToken?.childBreakTokens ?? [];
		if (this.breakToken?.isAtBlockEnd) {
			return childBreakTokens.some((token) => token.node?.isInlineNode);
		}
		return !childBreakTokens.some((token) => token.continuesInFlow && !token.node?.isInlineNode);
	}

	#applyTextAlignLast(el) {
		if (!this.#isDeepestSplitElement()) return;

		const alignLast = this.#resolvedTextAlignLastForSplit();
		if (!alignLast) return;

		el.dataset.alignLastSplitElement = alignLast;
		el.style.setProperty("text-align-last", alignLast, "important");
		if (alignLast === "justify") {
			el.setAttribute("data-justify-last", "");
		}
	}

	#resolvedTextAlignLastForSplit() {
		const alignLast = this.node.textAlignLast;
		if (alignLast === "auto") {
			return this.node.textAlign === "justify" ? "justify" : null;
		}
		return alignLast;
	}

	/**
	 * Set the start attribute on a continuation <ol> so list numbering
	 * continues from the previous fragment rather than restarting at 1.
	 *
	 * Uses the break token's child structure to count how many list items
	 * were built in previous fragments.
	 */
	#applyListContinuation(el, inputBreakToken) {
		const parsedStart = parseInt(this.node.element.getAttribute("start"), 10);
		const originalStart = Number.isNaN(parsedStart) ? 1 : parsedStart;
		const firstChildToken = inputBreakToken.childBreakTokens?.[0];
		if (!firstChildToken) return;

		const childIndex = this.node.children.indexOf(firstChildToken.node);
		if (childIndex < 0) return;

		let itemCount = 0;
		for (let i = 0; i < childIndex; i++) {
			if (this.node.children[i].element?.tagName === "LI") itemCount++;
		}

		if (
			!firstChildToken.isBreakBefore &&
			this.node.children[childIndex]?.element?.tagName === "LI"
		) {
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
	 * @param {Object} [options]
	 * @param {boolean} [options.collapseWS=false] - collapse whitespace runs
	 * @param {Object|null} [options.pseudoContext=null] - pseudo element suppression context
	 * @param {boolean} [options.hasTrailingCollapsibleSpace=false] - trim one
	 *   trailing space from the last rendered text node
	 * @param {boolean} [options.isHyphenated=false] - append a hyphen glyph
	 *   after the last rendered text node (stripping a trailing soft hyphen first)
	 * @param {string} [options.hyphenateCharacter=DEFAULT_HYPHEN] - glyph to
	 *   append when `isHyphenated` is true
	 */
	static buildInlineContent(
		items,
		textContent,
		startOffset,
		endOffset,
		container,
		{
			collapseWS = false,
			pseudoContext = null,
			hasTrailingCollapsibleSpace = false,
			isHyphenated = false,
			hyphenateCharacter = DEFAULT_HYPHEN,
		} = {},
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
				// Skip materialized pseudo elements at wrong split boundaries
				if (pseudoContext && isPseudoElement(item.element)) {
					const which = item.element.dataset.pseudo;
					const skip =
						(which === "before" && pseudoContext.isContinuation) ||
						(which === "after" && pseudoContext.willContinue);
					if (skip) {
						let depth = 1;
						i++;
						while (i < items.length && depth > 0) {
							if (items[i].type === INLINE_OPEN_TAG) depth++;
							else if (items[i].type === INLINE_CLOSE_TAG) depth--;
							i++;
						}
						continue;
					}
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
					// Skip materialized pseudo elements at wrong split boundaries
					if (pseudoContext && isPseudoElement(item.element)) {
						const which = item.element.dataset.pseudo;
						const skip =
							(which === "before" && pseudoContext.isContinuation) ||
							(which === "after" && pseudoContext.willContinue);
						if (skip) {
							i++;
							continue;
						}
					}
					const el = item.element.cloneNode(true);
					current.appendChild(el);
				}
			}

			i++;
		}

		if (lastTextNode && hasTrailingCollapsibleSpace) {
			const t = lastTextNode.textContent;
			if (t.length > 0 && t.charCodeAt(t.length - 1) === 0x20) {
				lastTextNode.textContent = t.slice(0, -1);
			}
		}

		if (lastTextNode && isHyphenated) {
			let t = lastTextNode.textContent;
			if (t.length > 0 && t.charCodeAt(t.length - 1) === 0x00ad) {
				t = t.slice(0, -1);
			}
			lastTextNode.textContent = t + hyphenateCharacter;
		}
	}
}

function consumedBlockSize(inputBreakToken) {
	return inputBreakToken?.type === BREAK_TOKEN_BLOCK ? inputBreakToken.consumedBlockSize : 0;
}

/**
 * Past its block-end (CSS Fragmentation §2.1) a box has no extent and no
 * decorations; the content built into it is overflow.
 */
function applyPastBlockEnd(el) {
	for (const property of [
		"height",
		"min-height",
		"margin-block-start",
		"margin-block-end",
		"padding-block-start",
		"padding-block-end",
	]) {
		el.style.setProperty(property, "0", "important");
	}
	el.style.setProperty("border-block-start", "none", "important");
	el.style.setProperty("border-block-end", "none", "important");
	// The shadow is cast by a box that has no extent here. The outline is
	// not: Chromium draws it around the zero-extent fragment, so it stays.
	el.style.setProperty("box-shadow", "none", "important");
}
