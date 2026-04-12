import { LayoutModule } from "./module.js";
import { ConstraintSpace } from "../fragmentation/constraint-space.js";
import { FRAGMENTATION_NONE, FRAGMENTATION_PAGE } from "../fragmentation/constraint-space.js";

const ANCHOR_BLOCK_START = "block-start";
const ANCHOR_BLOCK_END = "block-end";
const ANCHOR_OVERLAY = "overlay";

/**
 * Classify which edge of the page a fixed element anchors to.
 * Reads the element's specified (inline) styles rather than computed
 * values, because computed style resolves `top` from `bottom + height`
 * even when the author only specified `bottom`.
 *
 * @param {HTMLElement} element - The DOM element
 * @returns {string} ANCHOR_BLOCK_START | ANCHOR_BLOCK_END | ANCHOR_OVERLAY
 */
function classifyAnchorEdge(element) {
	const specified = element.style;
	const hasTop = specified.top !== "" && specified.top !== "auto";
	const hasBottom = specified.bottom !== "" && specified.bottom !== "auto";

	if (hasBottom && !hasTop) return ANCHOR_BLOCK_END;
	if (hasTop) return ANCHOR_BLOCK_START;
	return ANCHOR_OVERLAY;
}

/**
 * Layout module for position: fixed elements in paged media.
 *
 * CSS 2.1 §9.6.1 requires that fixed-positioned boxes repeat on every
 * page. This module claims fixed children from normal flow, reserves
 * space at the block-start/block-end of each page, and clones the
 * elements into every rendered fragmentainer.
 *
 * Only active in page fragmentation — fixed elements are viewport-relative
 * in column/region contexts and don't participate in those flows.
 */
class FixedPosition extends LayoutModule {
	#fixedSelectors = [];

	resetRules() {
		this.#fixedSelectors = [];
	}

	claim(node) {
		return node.position === "fixed";
	}

	matchRule(rule) {
		if (rule.style.getPropertyValue("position").trim() === "fixed") {
			this.#fixedSelectors.push(rule.selectorText);
		}
	}

	claimPersistent(content) {
		const claimed = [];
		for (const el of content.children) {
			if (el.style.position === "fixed") {
				claimed.push(el);
				continue;
			}
			for (const selector of this.#fixedSelectors) {
				try {
					if (el.matches(selector)) {
						claimed.push(el);
						break;
					}
				} catch {
					continue;
				}
			}
		}
		return claimed;
	}

	layout(rootNode, constraintSpace, breakToken, layoutChild) {
		if (constraintSpace.fragmentationType !== FRAGMENTATION_PAGE) {
			return { reservedBlockStart: 0, reservedBlockEnd: 0, afterRender: null };
		}

		let reservedBlockStart = 0;
		let reservedBlockEnd = 0;
		const placed = [];

		// Walk the full subtree — fixed elements can be at any depth.
		// Don't recurse into fixed elements themselves (they're monolithic).
		// Skip disconnected nodes (e.g. lookahead boundary nodes from the
		// segmented measurer) — their children haven't been styled yet.
		const collect = (node) => {
			for (const child of node.children) {
				if (child.element && !child.element.isConnected) continue;
				if (this.claim(child)) {
					const fixedSpace = new ConstraintSpace({
						availableInlineSize: constraintSpace.availableInlineSize,
						availableBlockSize: constraintSpace.fragmentainerBlockSize,
						fragmentainerBlockSize: constraintSpace.fragmentainerBlockSize,
						fragmentationType: FRAGMENTATION_NONE,
					});

					const result = layoutChild(child, fixedSpace);

					let anchorEdge = ANCHOR_OVERLAY;
					if (child.element) {
						anchorEdge = classifyAnchorEdge(child.element);
					}

					placed.push({
						node: child,
						fragment: result.fragment,
						anchorEdge,
					});

					if (anchorEdge === ANCHOR_BLOCK_START) {
						reservedBlockStart += result.fragment.blockSize;
					} else if (anchorEdge === ANCHOR_BLOCK_END) {
						reservedBlockEnd += result.fragment.blockSize;
					}
				} else {
					collect(child);
				}
			}
		};

		collect(rootNode);

		return {
			reservedBlockStart,
			reservedBlockEnd,
			afterRender:
				placed.length > 0
					? (wrapper) => {
							wrapper.style.setProperty("position", "relative");
							for (const pf of placed) {
								// Fixed elements are monolithic — clone the source element
								// directly rather than walking the fragment tree (which only
								// renders children, not the node itself).
								const clone = pf.node.element.cloneNode(true);
								clone.style.setProperty("position", "absolute");
								clone.style.setProperty("left", "0");
								clone.style.setProperty("right", "0");
								if (pf.anchorEdge === ANCHOR_BLOCK_END) {
									clone.style.setProperty("top", "auto");
									clone.style.setProperty("bottom", "0");
								} else {
									clone.style.setProperty("top", "0");
									clone.style.setProperty("bottom", "auto");
								}
								wrapper.appendChild(clone);
							}
						}
					: null,
		};
	}
}

export { FixedPosition };
