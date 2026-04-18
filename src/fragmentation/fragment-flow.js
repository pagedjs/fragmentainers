import { LayoutNode } from "../layout/layout-node-base.js";
import { BlockContainerAlgorithm } from "../algorithms/block-container.js";
import { runLayoutGenerator } from "../layout/layout-driver.js";
import { ConstraintSpace, FRAGMENTATION_PAGE } from "./constraint-space.js";
import { Fragment } from "./fragment.js";

/**
 * Synthetic root whose children are the flow's append-only queue. Layout
 * algorithms dispatch on this node's classification getters; all defaults
 * from LayoutNode apply (block container, no box model, no style).
 */
class FlowRootNode extends LayoutNode {
	#queue;

	constructor(queue) {
		super();
		this.#queue = queue;
	}

	get children() {
		return this.#queue;
	}

	get debugName() {
		return "[flow-root]";
	}
}

/**
 * A parallel fragmentation flow. Holds an append-only queue of LayoutNodes
 * that share a fragmentainer with the main flow. Each call to
 * `layoutFragmentainer` lays out as much of the queue as fits in the given
 * block space, producing a Fragment and carrying the remainder forward via
 * a BlockBreakToken. Queue items split naturally via the standard block
 * fragmentation machinery (consumedBlockSize on their break tokens).
 *
 * Consumers attach this flow to a handler and feed it nodes from per-page
 * extraction in their `extractFlowChildren` hook. Domain-specific layout
 * (e.g. footnote area positioning, ::marker suppression on continuations)
 * lives in the handler's `composeFlowFragment`, not here.
 */
export class FragmentFlow {
	#queue = [];
	#root = new FlowRootNode(this.#queue);
	#breakToken = null;

	enqueue(nodes) {
		if (!nodes) return;
		for (const node of nodes) {
			if (this.#queue.indexOf(node) === -1) this.#queue.push(node);
		}
	}

	/**
	 * @param {Object} opts
	 * @param {number} opts.availableInlineSize
	 * @param {number} opts.availableBlockSize - cap for the flow's fragment
	 * @returns {{ fragment: Fragment, breakToken: import('./tokens.js').BlockBreakToken|null, rejectedNode: LayoutNode|null }}
	 */
	layoutFragmentainer({ availableInlineSize, availableBlockSize }) {
		const inputBreakToken = this.#breakToken;
		if (this.#queue.length === 0 || availableBlockSize <= 0) {
			const fragment = new Fragment(this.#root, 0);
			fragment.inlineSize = availableInlineSize;
			return { fragment, breakToken: null, rejectedNode: null, inputBreakToken };
		}

		const cs = new ConstraintSpace({
			availableInlineSize,
			availableBlockSize,
			fragmentainerBlockSize: availableBlockSize,
			fragmentationType: FRAGMENTATION_PAGE,
		});

		const algo = new BlockContainerAlgorithm(this.#root, cs, inputBreakToken);
		const result = runLayoutGenerator(algo);

		// Drop fully-consumed items; the first childBreakToken pins the one still in progress.
		const continuing = result.breakToken?.childBreakTokens?.[0]?.node ?? null;
		const doneCount = continuing ? this.#queue.indexOf(continuing) : this.#queue.length;
		if (doneCount > 0) this.#queue.splice(0, doneCount);

		this.#breakToken = result.breakToken;

		return {
			fragment: result.fragment,
			breakToken: result.breakToken,
			rejectedNode: detectRejectedNode(result.breakToken),
			inputBreakToken,
		};
	}

	get breakToken() {
		return this.#breakToken;
	}

	/**
	 * Capture the current state so a speculative layout pass can be undone.
	 * Paired with `restore()` for coordinator re-iteration.
	 */
	snapshot() {
		return { queue: [...this.#queue], breakToken: this.#breakToken };
	}

	restore(s) {
		if (!s) return;
		this.#queue.splice(0, this.#queue.length, ...s.queue);
		this.#breakToken = s.breakToken;
	}

	destroy() {
		this.#queue.length = 0;
		this.#breakToken = null;
	}
}

/**
 * A child's break-before token means the algorithm pushed it forward
 * without placing any content — it didn't fit, typically because the
 * node carries `break-inside: avoid`. The flow consumer treats this as
 * a push-forward signal (e.g. in the footnote case, move the call's
 * containing block to the next page so call + body stay together).
 */
function detectRejectedNode(breakToken) {
	const children = breakToken?.childBreakTokens;
	if (!children) return null;
	for (const child of children) {
		if (child.isBreakBefore) return child.node;
	}
	return null;
}
