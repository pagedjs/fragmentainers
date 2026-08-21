import { BlockContainerAlgorithm } from "../algorithms/block-container.js";
import { FlexAlgorithm } from "../algorithms/flex-container.js";
import { GridAlgorithm } from "../algorithms/grid-container.js";
import { InlineContentAlgorithm } from "../algorithms/inline-content.js";
import { MulticolAlgorithm } from "../algorithms/multicol-container.js";
import { TableRowAlgorithm } from "../algorithms/table-row.js";
import { ensureFlowContext } from "../fragmentation/flow-context.js";

/**
 * Runs a layout algorithm to completion, recursively fulfilling
 * any child LayoutRequests it yields.
 *
 * The root node gets a default FlowContext if its creator set none
 * (direct callers without a Fragmenter). Children normally inherit
 * context at construction; as a fallback for nodes built another way
 * (e.g. duck-typed test nodes), each dispatched child inherits its
 * parent's context here.
 *
 * @param {Object} algorithm - Algorithm instance with a *layout() generator method
 */
export function runLayoutGenerator(algorithm) {
	ensureFlowContext(algorithm.node);
	return runGenerator(algorithm);
}

function runGenerator(algorithm) {
	const gen = algorithm.layout();
	let genResult = gen.next();

	while (!genResult.done) {
		const request = genResult.value;

		if (!request.node.hasContext) request.node.context = algorithm.node.context;
		const ChildAlgoClass = getLayoutAlgorithm(request.node);
		const childAlgo = new ChildAlgoClass(
			request.node,
			request.constraintSpace,
			request.breakToken,
			request.earlyBreakTarget,
		);
		const childResult = runGenerator(childAlgo);

		// Propagate earlyBreak signal up to the driver immediately
		if (childResult.earlyBreak) return childResult;

		// Send the child's result back into the parent generator
		genResult = gen.next(childResult);
	}

	return genResult.value;
}

/**
 * Dispatch to the correct layout algorithm class based on node type.
 */
export function getLayoutAlgorithm(node) {
	if (node.isMulticolContainer) return MulticolAlgorithm;
	if (node.isFlexContainer) return FlexAlgorithm;
	if (node.isGridContainer) return GridAlgorithm;
	if (node.isInlineFormattingContext) return InlineContentAlgorithm;
	if (node.isTableRow) return TableRowAlgorithm;
	return BlockContainerAlgorithm;
}
