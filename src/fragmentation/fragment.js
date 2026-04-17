import { findChildBreakToken, BREAK_TOKEN_INLINE, DEFAULT_HYPHEN } from "./tokens.js";
import {
	INLINE_TEXT,
	INLINE_CONTROL,
	INLINE_OPEN_TAG,
	INLINE_CLOSE_TAG,
	INLINE_ATOMIC,
} from "../measurement/collect-inlines.js";
import { handlers } from "../handlers/registry.js";
import { isPseudoElement } from "../handlers/pseudo-elements.js";

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
		this.lineCount = 0;
		this.isRepeated = false;
		this.truncateMarginBlockStart = false;
		this.truncateMarginBlockEnd = false;
		this.isBlank = false;
		this.counterState = null;
		this.afterRender = null;
		this.isFirst = false;
		this.blockOffset = 0;
		this.isLast = false;
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
		const docFragment = document.createDocumentFragment();
		for (const child of this.childFragments) {
			if (!child.node) continue;
			const childInputBT = findChildBreakToken(inputBreakToken, child.node);
			child.#buildInto(childInputBT, docFragment);
		}
		return docFragment;
	}

	/**
	 * Build this fragment's cloned DOM into a parent element.
	 * Recursive workhorse — dispatches to type-specific builders.
	 *
	 * @param {import("./tokens.js").BreakToken|null} inputBreakToken
	 * @param {Element} parentEl
	 */
	#buildInto(inputBreakToken, parentEl) {
		if (!this.node) return;

		const node = this.node;

		if (this.multicolData) {
			this.#buildMulticol(inputBreakToken, parentEl);
		} else if (node.isInlineFormattingContext) {
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
			for (const child of this.childFragments) {
				if (!child.node) continue;
				// Skip materialized pseudo elements at wrong split boundaries
				if (child.node.element && !this.#shouldBuildPseudo(child.node.element, inputBreakToken))
					continue;
				const childInputBT = findChildBreakToken(inputBreakToken, child.node);
				child.#buildInto(childInputBT, el);
			}
			// Skip empty container shells — all built children were themselves
			// empty and skipped (e.g. an <ol> whose only <li> had no visible text).
			if (el.childNodes.length === 0 && this.breakToken) {
				return;
			}
			parentEl.appendChild(el);
		} else if (
			this.childFragments.length === 0 &&
			this.breakToken &&
			node.children?.length > 0
		) {
			// Empty container shell — all children pushed to next fragmentainer.
			// Don't build; content will appear on the next page/column.
			return;
		} else {
			const el = node.element.cloneNode(true);
			if (this.isRepeated) el.setAttribute("data-repeated", "");
			this.#applySplitAttributes(el, inputBreakToken);
			if (this.truncateMarginBlockStart) el.setAttribute("data-truncate-margin", "");
			if (this.truncateMarginBlockEnd) el.setAttribute("data-truncate-margin-end", "");

			// Sliced monolithic content: wrap in a clip container and offset
			// by the consumed amount to show the correct portion.
			const consumed = inputBreakToken?.consumedBlockSize || 0;
			if (consumed > 0 || this.breakToken) {
				const wrapper = document.createElement("div");
				wrapper.style.height = `${this.blockSize}px`;
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
	 * Build an inline formatting context fragment.
	 * Uses inlineItemsData + break token offsets to reconstruct
	 * only the visible portion of the content.
	 */
	#buildInline(inputBreakToken, parentEl) {
		const node = this.node;
		const data = node.inlineItemsData;
		const isAnonymous = !node.element;

		if (!data || !data.items || data.items.length === 0) {
			if (!isAnonymous) {
				const el = node.element.cloneNode(false);
				if (this.truncateMarginBlockStart) el.setAttribute("data-truncate-margin", "");
				if (this.truncateMarginBlockEnd) el.setAttribute("data-truncate-margin-end", "");
				parentEl.appendChild(el);
			}
			return;
		}

		const startOffset =
			inputBreakToken && inputBreakToken.type === BREAK_TOKEN_INLINE ? inputBreakToken.textOffset : 0;
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

		const ws = isAnonymous ? "normal" : node.whiteSpace;
		const collapseWS = !ws.startsWith("pre");
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

		const options = {
			collapseWS,
			pseudoContext,
			hasTrailingCollapsibleSpace,
			isHyphenated,
			hyphenateCharacter,
		};

		if (isAnonymous) {
			const docFragment = document.createDocumentFragment();
			Fragment.buildInlineContent(
				data.items,
				data.textContent,
				startOffset,
				endOffset,
				docFragment,
				options,
			);
			parentEl.appendChild(docFragment);
		} else {
			const el = node.element.cloneNode(false);
			this.#applySplitAttributes(el, inputBreakToken);
			if (this.truncateMarginBlockStart) el.setAttribute("data-truncate-margin", "");
			if (this.truncateMarginBlockEnd) el.setAttribute("data-truncate-margin-end", "");
			Fragment.buildInlineContent(
				data.items,
				data.textContent,
				startOffset,
				endOffset,
				el,
				options,
			);
			parentEl.appendChild(el);
		}
	}

	/**
	 * Build a multicol container fragment.
	 * Clones the element, disables native columns, builds each column
	 * child as a flex item with correct width and gap.
	 */
	#buildMulticol(inputBreakToken, parentEl) {
		const node = this.node;
		const { columnWidth, columnGap } = this.multicolData;

		const el = node.element.cloneNode(false);
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
			colEl.style.height = `${this.blockSize}px`;
			colEl.style.overflow = "hidden";
			colEl.style.flexShrink = "0";

			// Thread break tokens: col 0 uses inputBreakToken, col N uses col N-1's breakToken
			const colInputBT = i === 0 ? inputBreakToken : this.childFragments[i - 1].breakToken;

			for (const child of colFragment.childFragments) {
				if (!child.node) continue;
				const childInputBT = findChildBreakToken(colInputBT, child.node);
				child.#buildInto(childInputBT, colEl);
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
		if (
			inputBreakToken &&
			!inputBreakToken.isBreakBefore &&
			(inputBreakToken.type === BREAK_TOKEN_INLINE
				? inputBreakToken.textOffset > 0
				: inputBreakToken.consumedBlockSize > 0)
		)
			el.setAttribute("data-split-from", "");
		if (this.breakToken) {
			el.setAttribute("data-split-to", "");
			if (this.node.textAlign === "justify") {
				el.setAttribute("data-justify-last", "");
			}
		}
	}

	/**
	 * Set the start attribute on a continuation <ol> so list numbering
	 * continues from the previous fragment rather than restarting at 1.
	 *
	 * Uses the break token's child structure to count how many list items
	 * were built in previous fragments.
	 */
	#applyListContinuation(el, inputBreakToken) {
		const originalStart = parseInt(this.node.element.getAttribute("start"), 10) || 1;
		const firstChildToken = inputBreakToken.childBreakTokens?.[0];
		if (!firstChildToken) return;

		const childIndex = this.node.children.indexOf(firstChildToken.node);
		if (childIndex < 0) return;

		let itemCount = 0;
		for (let i = 0; i < childIndex; i++) {
			if (this.node.children[i].element?.tagName === "LI") itemCount++;
		}

		if (!firstChildToken.isBreakBefore && this.node.children[childIndex]?.element?.tagName === "LI") {
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
	 * Walk the fragment tree and composed DOM in parallel, registering
	 * each clone→source pair in the handler registry's shared map.
	 *
	 * Called once after build() to create the mapping that handlers
	 * (NthSelectors, MutationSync) use to resolve clone elements back to
	 * their source elements.
	 *
	 * @param {import("./tokens.js").BreakToken|null} inputBreakToken
	 * @param {Element} composedParent
	 */
	map(inputBreakToken, composedParent) {
		let childIdx = 0;
		for (const childFrag of this.childFragments) {
			if (!childFrag.node) continue;
			const childBT = findChildBreakToken(inputBreakToken, childFrag.node);

			// Skip empty container shells (same logic as #buildInto)
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

			// Skip blocks whose built children were all empty (build skips these)
			if (childFrag.hasBlockChildren) {
				// Check if this would produce an empty shell after building
				// We can't know for sure without checking the composed DOM,
				// so just try to match and handle mismatches gracefully
			}

			const clone = composedParent.children[childIdx];
			if (!clone) break;

			if (childFrag.node.element) {
				// For sliced monolithic content, the builder wraps in a clip div.
				// The actual clone is inside the wrapper.
				const consumed = childBT?.consumedBlockSize || 0;
				if (
					!childFrag.hasBlockChildren &&
					!childFrag.node.isInlineFormattingContext &&
					!childFrag.multicolData &&
					(consumed > 0 || childFrag.breakToken) &&
					childFrag.childFragments.length === 0
				) {
					// Monolithic with clip wrapper — the clone is inside
					const inner = clone.firstElementChild;
					if (inner) {
						Fragment.#mapDeep(inner, childFrag.node.element);
					}
				} else if (childFrag.multicolData) {
					handlers.trackClone(clone, childFrag.node.element);
					// Multicol children are synthetic — don't recurse into columns
				} else {
					handlers.trackClone(clone, childFrag.node.element);
					if (childFrag.hasBlockChildren) {
						childFrag.map(childBT, clone);
					} else if (childFrag.node.isInlineFormattingContext) {
						// Inline fragments rebuild content from items — map the container only
					} else {
						// Leaf deep clone
						Fragment.#mapDeep(clone, childFrag.node.element);
					}
				}
			}

			childIdx++;
		}
	}

	/**
	 * Recursively map a deep clone's children to their source counterparts.
	 */
	static #mapDeep(clone, source) {
		handlers.trackClone(clone, source);
		const sourceChildren = source.children;
		const cloneChildren = clone.children;
		for (let i = 0; i < sourceChildren.length && i < cloneChildren.length; i++) {
			Fragment.#mapDeep(cloneChildren[i], sourceChildren[i]);
		}
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
