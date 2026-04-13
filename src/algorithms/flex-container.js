import { BlockBreakToken } from "../fragmentation/tokens.js";
import { ConstraintSpace } from "../fragmentation/constraint-space.js";
import { Fragment } from "../fragmentation/fragment.js";
import { FlowThreadNode } from "../layout/flow-thread-node.js";
import { LayoutRequest } from "../layout/layout-request.js";
import { findChildBreakToken } from "../fragmentation/tokens.js";
import { FRAGMENTATION_NONE } from "../fragmentation/constraint-space.js";

export const ALGORITHM_FLEX = "FlexData";
export const ALGORITHM_FLEX_LINE = "FlexLineData";

/**
 * Flex container layout algorithm.
 *
 * Row direction: items within a flex line are parallel flows (same
 * pattern as table-row). Multi-line flex stacks lines in the block
 * direction with breaks between lines.
 *
 * Column direction: items are sequential in the block direction,
 * delegated to a flow thread (same Chromium pattern as multicol).
 */
export class FlexAlgorithm {
	#node;
	#constraintSpace;
	#breakToken;
	// earlyBreakTarget is part of the algorithm constructor protocol but
	// flex doesn't run Class A break scoring — accepted for parity.
	// eslint-disable-next-line no-unused-private-class-members
	#earlyBreakTarget;

	// Row-direction cross-iteration state
	#lineFragments = [];
	#blockOffset = 0;
	#startLine = 0;
	#containerBreakToken = null;

	constructor(node, constraintSpace, breakToken, earlyBreakTarget = null) {
		this.#node = node;
		this.#constraintSpace = constraintSpace;
		this.#breakToken = breakToken;
		this.#earlyBreakTarget = earlyBreakTarget;
		if (breakToken?.algorithmData?.type === ALGORITHM_FLEX) {
			this.#startLine = breakToken.algorithmData.flexLineIndex;
		}
	}

	*layout() {
		const isRowDirection =
			this.#node.flexDirection === "row" || this.#node.flexDirection === "row-reverse";
		if (!isRowDirection) return yield* this.layoutColumnFlow();
		if (this.#node.children.length === 0) return this.#emptyOutput();

		const flexLines = groupFlexLines(
			this.#node.children,
			this.#node.flexWrap,
			this.#constraintSpace,
		);
		yield* this.layoutRowLines(flexLines);
		return this.#buildOutput();
	}

	#emptyOutput() {
		const fragment = new Fragment(this.#node, 0);
		fragment.inlineSize = this.#constraintSpace.availableInlineSize;
		return { fragment, breakToken: null };
	}

	*layoutRowLines(flexLines) {
		for (let lineIdx = this.#startLine; lineIdx < flexLines.length; lineIdx++) {
			const lineItems = flexLines[lineIdx];

			// Lay out this flex line as parallel flows (table-row pattern)
			const lineResult = yield* this.layoutFlexLine(lineItems, this.#blockOffset);

			this.#lineFragments.push(lineResult.fragment);
			this.#blockOffset += lineResult.fragment.blockSize;

			if (lineResult.anyBroke) {
				this.#containerBreakToken = this.#buildContainerBreakTokenForLine(
					lineIdx,
					lineResult.breakToken ? [lineResult.breakToken] : [],
				);
				break;
			}

			// Class A break between flex lines: if next line doesn't fit, bail
			if (
				this.#constraintSpace.fragmentationType !== FRAGMENTATION_NONE &&
				lineIdx + 1 < flexLines.length &&
				this.#blockOffset >=
					this.#constraintSpace.fragmentainerBlockSize -
						this.#constraintSpace.blockOffsetInFragmentainer
			) {
				this.#containerBreakToken = this.#buildContainerBreakTokenForLine(lineIdx + 1, []);
				break;
			}
		}
	}

	*layoutFlexLine(lineItems, blockOffset) {
		const itemFragments = [];
		const itemBreakTokens = [];
		let maxItemBlockSize = 0;
		let anyBroke = false;

		const itemCount = lineItems.length;
		const itemInlineSize = this.#constraintSpace.availableInlineSize / itemCount;

		for (let i = 0; i < itemCount; i++) {
			const item = lineItems[i];
			const itemBreakToken = findChildBreakToken(this.#breakToken, item);
			const effectiveItemBreakToken = itemBreakToken?.isBreakBefore ? null : itemBreakToken;

			const itemConstraint = new ConstraintSpace({
				availableInlineSize: item.itemInlineSize || itemInlineSize,
				availableBlockSize: this.#constraintSpace.availableBlockSize - blockOffset,
				fragmentainerBlockSize: this.#constraintSpace.fragmentainerBlockSize,
				blockOffsetInFragmentainer:
					this.#constraintSpace.blockOffsetInFragmentainer + blockOffset,
				fragmentationType: this.#constraintSpace.fragmentationType,
			});

			const result = yield new LayoutRequest(item, itemConstraint, effectiveItemBreakToken);

			itemFragments.push(result.fragment);
			if (result.fragment.blockSize > maxItemBlockSize) {
				maxItemBlockSize = result.fragment.blockSize;
			}

			if (result.breakToken) {
				itemBreakTokens.push(result.breakToken);
				anyBroke = true;
			} else {
				itemBreakTokens.push(null);
			}
		}

		// Parallel flow rule: completed items need isAtBlockEnd tokens
		if (anyBroke) {
			for (let i = 0; i < itemBreakTokens.length; i++) {
				if (itemBreakTokens[i] === null) {
					const doneToken = new BlockBreakToken(lineItems[i]);
					doneToken.isAtBlockEnd = true;
					doneToken.hasSeenAllChildren = true;
					itemBreakTokens[i] = doneToken;
				}
			}
		}

		const lineFragment = new Fragment(this.#node, maxItemBlockSize, itemFragments);
		lineFragment.inlineSize = this.#constraintSpace.availableInlineSize;

		let lineToken = null;
		if (anyBroke) {
			lineToken = new BlockBreakToken(this.#node);
			lineToken.childBreakTokens = itemBreakTokens;
			lineToken.hasSeenAllChildren = true;
			lineToken.algorithmData = { type: ALGORITHM_FLEX_LINE };
		}

		return { fragment: lineFragment, breakToken: lineToken, anyBroke };
	}

	*layoutColumnFlow() {
		const flowThread = new FlowThreadNode(this.#node);

		const contentToken = this.#breakToken?.childBreakTokens?.[0] ?? null;
		const result = yield new LayoutRequest(flowThread, this.#constraintSpace, contentToken);

		const fragment = new Fragment(
			this.#node,
			result.fragment.blockSize,
			result.fragment.childFragments,
		);
		fragment.inlineSize = this.#constraintSpace.availableInlineSize;

		if (result.breakToken) {
			const containerToken = new BlockBreakToken(this.#node);
			containerToken.consumedBlockSize =
				(this.#breakToken?.consumedBlockSize || 0) + result.fragment.blockSize;
			containerToken.sequenceNumber = (this.#breakToken?.sequenceNumber ?? -1) + 1;
			containerToken.childBreakTokens = [result.breakToken];
			containerToken.hasSeenAllChildren = false;
			containerToken.algorithmData = { type: ALGORITHM_FLEX, flexLineIndex: 0 };
			fragment.breakToken = containerToken;
		}

		return { fragment, breakToken: fragment.breakToken || null };
	}

	#buildContainerBreakTokenForLine(flexLineIndex, childBreakTokens) {
		const token = new BlockBreakToken(this.#node);
		token.consumedBlockSize = (this.#breakToken?.consumedBlockSize || 0) + this.#blockOffset;
		token.sequenceNumber = (this.#breakToken?.sequenceNumber ?? -1) + 1;
		token.childBreakTokens = childBreakTokens;
		token.hasSeenAllChildren = false;
		token.algorithmData = {
			type: ALGORITHM_FLEX,
			flexLineIndex,
		};
		return token;
	}

	#buildOutput() {
		const fragment = new Fragment(this.#node, this.#blockOffset, this.#lineFragments);
		fragment.inlineSize = this.#constraintSpace.availableInlineSize;
		if (this.#containerBreakToken) fragment.breakToken = this.#containerBreakToken;
		return { fragment, breakToken: fragment.breakToken || null };
	}
}

/**
 * Group flex children into lines.
 * For nowrap: all items on one line.
 * For wrap: split when cumulative inline size exceeds available space.
 */
function groupFlexLines(children, flexWrap, constraintSpace) {
	if (flexWrap === "nowrap") {
		return [children];
	}

	// Simple wrapping: items that don't fit start a new line
	const lines = [];
	let currentLine = [];
	let currentWidth = 0;
	const available = constraintSpace.availableInlineSize;

	for (const child of children) {
		const itemWidth = child.itemInlineSize || available / children.length;
		if (currentLine.length > 0 && currentWidth + itemWidth > available) {
			lines.push(currentLine);
			currentLine = [];
			currentWidth = 0;
		}
		currentLine.push(child);
		currentWidth += itemWidth;
	}

	if (currentLine.length > 0) lines.push(currentLine);
	return lines;
}
