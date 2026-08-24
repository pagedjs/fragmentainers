import {
	INLINE_ATOMIC,
	INLINE_CLOSE_TAG,
	INLINE_OPEN_TAG,
	INLINE_TEXT,
} from "../measurement/collect-inlines.js";
import { BREAK_TOKEN_INLINE, findChildBreakToken } from "./tokens.js";

function contains(ancestor, descendant) {
	return (
		ancestor !== descendant &&
		typeof ancestor?.contains === "function" &&
		ancestor.contains(descendant)
	);
}

function isContinuation(token) {
	return token !== null && !token.isBreakBefore;
}

function childInputToken(parentToken, childNode, taken) {
	if (!Array.isArray(parentToken?.childBreakTokens)) return null;
	return findChildBreakToken(parentToken, childNode, taken);
}

function mergeMatches(matches) {
	const found = matches.filter((match) => match.found);
	if (found.length === 0) return { found: false, precise: false, continuation: false };

	const precise = found.filter((match) => match.precise);
	const relevant = precise.length > 0 ? precise : found;
	return {
		found: true,
		precise: precise.length > 0,
		// One fresh occurrence makes the source target fresh on this fragmentainer.
		continuation: relevant.every((match) => match.continuation),
	};
}

function includeRange(range, start, end) {
	if (!Number.isFinite(start) || !Number.isFinite(end)) return;
	range.start = Math.min(range.start, start);
	range.end = Math.max(range.end, end);
}

/** Return the flat text range occupied by an element in InlineItemsData. */
function inlineTargetRange(items, target) {
	const range = { start: Infinity, end: -Infinity };
	const openRanges = new Map();

	for (const item of items) {
		if (item.type === INLINE_OPEN_TAG) {
			openRanges.set(item.element, [item.startOffset, item.endOffset]);
			if (item.element === target || contains(target, item.element)) {
				includeRange(range, item.startOffset, item.endOffset);
			}
		} else if (item.type === INLINE_CLOSE_TAG) {
			if (item.element === target || contains(target, item.element)) {
				const offsets = openRanges.get(item.element);
				if (offsets) includeRange(range, offsets[0], offsets[1]);
			}
		} else if (item.type === INLINE_ATOMIC) {
			if (
				item.element === target ||
				contains(target, item.element) ||
				contains(item.element, target)
			) {
				includeRange(range, item.startOffset, item.endOffset);
			}
		} else if (item.type === INLINE_TEXT && contains(target, item.domNode)) {
			includeRange(range, item.startOffset, item.endOffset);
		}
	}

	return Number.isFinite(range.start) && Number.isFinite(range.end) ? range : null;
}

function locateInline(fragment, inputToken, target) {
	const data = fragment.node.inlineItemsData;
	if (!data?.items?.length) return { found: false, precise: false, continuation: false };

	const range = inlineTargetRange(data.items, target);
	if (!range || range.start >= range.end) {
		return { found: false, precise: false, continuation: false };
	}

	const start = inputToken?.type === BREAK_TOKEN_INLINE ? inputToken.textOffset : 0;
	const end =
		fragment.breakToken?.type === BREAK_TOKEN_INLINE
			? fragment.breakToken.textOffset
			: data.textContent.length;
	const found = range.start < end && range.end > start;
	return {
		found,
		precise: found,
		continuation: found && start > range.start,
	};
}

function locateInFragment(fragment, inputToken, target) {
	const node = fragment?.node;
	if (!node) return { found: false, precise: false, continuation: false };

	if (node.isInlineNode) return locateInline(fragment, inputToken, target);

	if (node.element === target) {
		return { found: true, precise: true, continuation: isContinuation(inputToken) };
	}

	const childMatches = [];
	const taken = new Set();
	for (const child of fragment.childFragments ?? []) {
		if (!child.node) continue;
		const childToken = childInputToken(inputToken, child.node, taken);
		childMatches.push(locateInFragment(child, childToken, target));
	}

	const nested = mergeMatches(childMatches);
	if (nested.found) return nested;

	const element = node.element;
	if (element && contains(target, element)) {
		// Box-less ancestors occupy a fragmentainer when one of their source
		// descendants does; exact descendants remain the preferred match above.
		return { found: true, precise: false, continuation: isContinuation(inputToken) };
	}

	const hasNodeChildren = (fragment.childFragments ?? []).some((child) => child.node);
	if (element && !hasNodeChildren && contains(element, target)) {
		// A leaf block is composed with cloneNode(true), so a source descendant
		// with no LayoutNode of its own occupies the same fragment interval.
		return { found: true, precise: false, continuation: isContinuation(inputToken) };
	}

	return { found: false, precise: false, continuation: false };
}

/**
 * Locate a source element in an ordered run of top-level fragments.
 *
 * @param {import("./fragment.js").Fragment[]} fragments
 * @param {Element} element
 * @param {object} [options]
 * @param {import("./fragment.js").Fragment|null} [options.previous]
 * @param {number} [options.indexOffset=0]
 * @returns {{ index: number, fragment: import("./fragment.js").Fragment, isContinuation: boolean }[]}
 */
export function locate(fragments, element, { previous = null, indexOffset = 0 } = {}) {
	if (!Array.isArray(fragments) || !element) return [];

	let seenFallback = false;
	if (previous && !previous.isBlank) {
		seenFallback = locateInFragment(previous, null, element).found;
	}

	const locations = [];
	let previousFragment = previous;
	for (let i = 0; i < fragments.length; i++) {
		const fragment = fragments[i];
		const inputToken = previousFragment?.breakToken ?? null;
		if (fragment.isBlank) {
			previousFragment = fragment;
			continue;
		}
		const match = locateInFragment(fragment, inputToken, element);
		if (match.found) {
			locations.push({
				index: indexOffset + i,
				fragment,
				isContinuation: match.precise
					? match.continuation
					: seenFallback || match.continuation,
			});
			seenFallback = true;
		}
		previousFragment = fragment;
	}
	return locations;
}
