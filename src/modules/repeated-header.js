import { LayoutModule } from "./module.js";
import { ConstraintSpace } from "../fragmentation/constraint-space.js";
import { findChildBreakToken } from "../fragmentation/tokens.js";
import { FRAGMENTATION_NONE, FRAGMENTATION_PAGE } from "../fragmentation/constraint-space.js";

class RepeatedTableHeader extends LayoutModule {
	beforeChildren(node, constraintSpace, breakToken) {
		if (!breakToken || !node.isTable) return null;
		if (constraintSpace.fragmentationType !== FRAGMENTATION_PAGE) return null;

		const thead = node.children.find((c) => c.isTableHeaderGroup);
		if (!thead || findChildBreakToken(breakToken, thead)) return null;

		return {
			node: thead,
			constraintSpace: new ConstraintSpace({
				availableInlineSize: constraintSpace.availableInlineSize,
				availableBlockSize: constraintSpace.fragmentainerBlockSize,
				fragmentainerBlockSize: constraintSpace.fragmentainerBlockSize,
				fragmentationType: FRAGMENTATION_NONE,
			}),
			isRepeated: true,
		};
	}
}

export { RepeatedTableHeader };
