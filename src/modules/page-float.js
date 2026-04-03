import { Module } from "./module.js";
import { ConstraintSpace } from "../core/constraint-space.js";
import { composeFragment } from "../compositor/compositor.js";
import { FRAGMENTATION_NONE } from "../core/constants.js";

class PageFloatModule extends Module {
  matches(node) {
    return node.getCustomProperty("float-reference") === "page";
  }

  layout(rootNode, constraintSpace, breakToken, layoutChild) {
    let reservedBlockStart = 0;
    let reservedBlockEnd = 0;
    const placed = [];

    for (const child of rootNode.children) {
      if (!this.matches(child)) continue;

      const floatSpace = new ConstraintSpace({
        availableInlineSize: constraintSpace.availableInlineSize,
        availableBlockSize: constraintSpace.fragmentainerBlockSize,
        fragmentainerBlockSize: constraintSpace.fragmentainerBlockSize,
        fragmentationType: FRAGMENTATION_NONE,
      });

      const result = layoutChild(child, floatSpace);
      const placement = child.getCustomProperty("float") === "bottom"
        ? "bottom" : "top";

      placed.push({ node: child, fragment: result.fragment, placement });

      if (placement === "top") {
        reservedBlockStart += result.fragment.blockSize;
      } else {
        reservedBlockEnd += result.fragment.blockSize;
      }
    }

    return {
      reservedBlockStart,
      reservedBlockEnd,
      afterRender(fragment, contentStyles) {
        if (placed.length === 0) return;
        fragment.style.setProperty("position", "relative");
        for (const pf of placed) {
          const floatContent = composeFragment(
            pf.fragment, null, null, contentStyles?.sourceRefs,
          );
          const floatWrapper = document.createElement("div");
          floatWrapper.style.setProperty("position", "absolute");
          floatWrapper.style.setProperty("left", "0");
          floatWrapper.style.setProperty("right", "0");
          if (pf.placement === "top") {
            floatWrapper.style.setProperty("top", "0");
          } else {
            floatWrapper.style.setProperty("bottom", "0");
          }
          floatWrapper.appendChild(floatContent);
          fragment.appendChild(floatWrapper);
        }
      },
    };
  }
}

export const PageFloat = new PageFloatModule();
