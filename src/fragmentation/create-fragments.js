import { Fragmenter } from "./fragmenter.js";

/**
 * Fragment a pre-built layout tree and return its Fragments.
 *
 * A thin batch wrapper over `Fragmenter`: it skips DOM measurement
 * (the tree is already built and measured by the caller) and composition
 * (no `<fragment-container>` elements are created), leaving the fragment
 * data. Callers that want elements build them with `fragment.build()`.
 *
 * @param {import('../layout/layout-node-base.js').LayoutNode} rootNode
 * @param {import('./constraint-space.js').ConstraintSpace | { resolve: Function }} constraintSpaceOrResolver
 * @param {{ fragmentainerIndex: number, blockOffset: number }|null} [continuation] -
 *   Resume point from a previous run. When given, the return value carries
 *   the outgoing continuation alongside the fragments.
 * @returns {import('./fragment.js').Fragment[] | { fragments: import('./fragment.js').Fragment[], continuation: { fragmentainerIndex: number, blockOffset: number } }}
 */
export function createFragments(rootNode, constraintSpaceOrResolver, continuation = null) {
	const options =
		typeof constraintSpaceOrResolver?.resolve === "function"
			? { resolver: constraintSpaceOrResolver }
			: { constraintSpace: constraintSpaceOrResolver };
	if (continuation) options.continuation = continuation;

	const flow = new Fragmenter(rootNode, options);
	const { fragments } = flow.flow();

	if (continuation !== null) {
		return { fragments, continuation: flow.continuation };
	}
	return fragments;
}
