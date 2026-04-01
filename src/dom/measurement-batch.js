import { measureElementBlockSize } from "./measure.js";
import { buildCumulativeHeights } from "../core/speculative-layout.js";

/**
 * Batch-populates measurement caches on a DOMLayoutNode subtree.
 *
 * Walks the tree depth-first and reads all DOM measurements in a
 * controlled sequence that minimizes browser reflows. When all
 * getBoundingClientRect() calls happen in a single JS frame with
 * no DOM writes in between, the browser performs layout once and
 * returns all rects from the same layout pass.
 *
 * After collectAll(), the layout algorithms can run as pure
 * computation — no further DOM reads are needed.
 */
export class MeasurementBatch {
  /**
   * Collect all measurements for a subtree rooted at `rootNode`.
   *
   * @param {import('./layout-node.js').DOMLayoutNode} rootNode
   */
  collectAll(rootNode) {
    const nodes = this.#flatten(rootNode);

    // Phase 1: Warm style caches (getComputedStyle — batched reads, no reflow)
    // Accessing these properties triggers #getStyle()/#getStyleMap() caching.
    for (const node of nodes) {
      if (!node.element) continue;
      // Touch classification (triggers style read + caches result)
      void node.isInlineFormattingContext;
      // Touch box model (triggers computedStyleMap caching)
      void node.marginBlockStart;
      void node.marginBlockEnd;
      void node.paddingBlockStart;
      void node.paddingBlockEnd;
      void node.borderBlockStart;
      void node.borderBlockEnd;
      // Touch fragmentation CSS
      void node.breakBefore;
      void node.breakAfter;
      void node.breakInside;
      // Touch compositor-accessed styles
      void node.textAlign;
      void node.whiteSpace;
      // Cache lineHeight (used by inline layout + debug viewer;
      // must survive element detachment in the batched pipeline)
      void node.lineHeight;
    }

    // Phase 2: Batch block size reads (getBoundingClientRect — one layout pass)
    for (const node of nodes) {
      if (!node.element) continue;
      if (typeof node.setBlockSizeCache === "function") {
        node.setBlockSizeCache(measureElementBlockSize(node.element));
      }
    }

    // Phase 3: Collect inline items data for all inline FCs
    for (const node of nodes) {
      if (node.isInlineFormattingContext) {
        void node.inlineItemsData;
      }
    }

    // Phase 4: Build cumulative height prefix sums for nodes with
    // enough block children to benefit from the fast-path skip in
    // layoutBlockContainer. Small child lists don't gain from the
    // prefix sum — the per-child overhead is already negligible.
    const CUMULATIVE_THRESHOLD = 20;
    for (const node of nodes) {
      if (node.children.length >= CUMULATIVE_THRESHOLD && !node.isInlineFormattingContext) {
        node.cumulativeHeights = buildCumulativeHeights(node);
      }
    }
  }

  /**
   * Depth-first flatten of the layout tree.
   *
   * @param {import('./layout-node.js').DOMLayoutNode} rootNode
   * @returns {import('./layout-node.js').DOMLayoutNode[]}
   */
  #flatten(rootNode) {
    const result = [];
    const stack = [rootNode];
    while (stack.length > 0) {
      const node = stack.pop();
      result.push(node);
      // Accessing .children triggers lazy wrapping + caching
      const children = node.children;
      // Push in reverse so left-most child is processed first
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i]);
      }
    }
    return result;
  }
}
