import { LayoutModule } from "./module.js";
import { ConstraintSpace } from "../core/constraint-space.js";
import { FRAGMENTATION_NONE } from "../core/constants.js";

const VALID_VALUES = new Set(["fill", "contain", "cover"]);

class PageFitLayoutModule extends LayoutModule {
	matches(node) {
		const value = node.getCustomProperty("page-fit");
		return value !== null && VALID_VALUES.has(value);
	}

	layout(rootNode, constraintSpace, breakToken, layoutChild) {
		const placed = [];

		for (const child of rootNode.children) {
			if (!this.matches(child)) continue;

			const value = child.getCustomProperty("page-fit");
			const floatSpace = new ConstraintSpace({
				availableInlineSize: constraintSpace.availableInlineSize,
				availableBlockSize: constraintSpace.fragmentainerBlockSize,
				fragmentainerBlockSize: constraintSpace.fragmentainerBlockSize,
				fragmentationType: FRAGMENTATION_NONE,
			});

			const result = layoutChild(child, floatSpace);
			placed.push({ node: child, fragment: result.fragment, fit: value });
		}

		const reservedBlockStart = placed.length > 0 ? constraintSpace.fragmentainerBlockSize : 0;

		return {
			reservedBlockStart,
			reservedBlockEnd: 0,
			afterRender(fragment, contentStyles) {
				if (placed.length === 0) return;
				fragment.style.setProperty("position", "relative");
				for (const pf of placed) {
					const clone = pf.node.element.cloneNode(true);
					clone.style.setProperty("width", "100%");
					clone.style.setProperty("height", "100%");
					clone.style.setProperty("object-fit", pf.fit);
					clone.style.setProperty("position", "absolute");
					clone.style.setProperty("inset", "0");
					fragment.appendChild(clone);
				}
			},
		};
	}
}

export const PageFit = new PageFitLayoutModule();
