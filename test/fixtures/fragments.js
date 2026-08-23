import { Fragment } from "../../src/fragmentation/fragment.js";
import { BlockBreakToken, InlineBreakToken } from "../../src/fragmentation/tokens.js";

/**
 * A block container's fragment whose inline content breaks across
 * fragmentainers: the element's fragment holds its anonymous inline node's
 * fragment, and the element's block break token carries the inline break
 * token — the shape BlockContainerAlgorithm + InlineContentAlgorithm produce.
 *
 * @param {import("../../src/layout/layout-node.js").DOMLayoutNode} node
 * @param {number} blockSize
 * @param {number} [textOffset] - where the inline content breaks
 */
export function splitTextBlock(node, blockSize, textOffset) {
	const inlineNode = node.children[0];
	const text = inlineNode.inlineItemsData?.textContent ?? "";
	const inlineToken = new InlineBreakToken(inlineNode);
	inlineToken.itemIndex = 0;
	inlineToken.textOffset = textOffset ?? Math.max(1, Math.floor(text.length / 2));

	const inlineFragment = new Fragment(inlineNode, blockSize);
	inlineFragment.breakToken = inlineToken;

	const token = new BlockBreakToken(node);
	token.consumedBlockSize = blockSize;
	token.childBreakTokens = [inlineToken];

	const fragment = new Fragment(node, blockSize, [inlineFragment]);
	fragment.breakToken = token;
	return fragment;
}
