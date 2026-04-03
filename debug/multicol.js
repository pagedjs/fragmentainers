/**
 * Multicol processor — replaces CSS column layout with
 * the library's fragmentation engine output.
 */
import {
  ConstraintSpace,
  buildLayoutTree,
  createFragments,
  composeFragment,
  constants,
} from "../src/index.js";
import "./multicol-container.js";

const { FRAGMENTATION_COLUMN } = constants;

/**
 * Find all elements in the subtree that use CSS columns.
 */
export function findMulticolContainers(root) {
  const result = [];
  for (const el of root.querySelectorAll("*")) {
    const style = getComputedStyle(el);
    if (
      (style.columnCount !== "auto" && parseInt(style.columnCount) > 0) ||
      (style.columnWidth !== "auto" && style.columnWidth !== "none")
    ) {
      result.push(el);
    }
  }
  return result;
}

/**
 * Replace a single multicol container's content with fragmented columns.
 */
export async function multicol(container) {
  const style = getComputedStyle(container);

  const totalWidth = container.clientWidth;
  const totalHeight = container.clientHeight;
  const columnCount = parseInt(style.columnCount) || 1;
  const columnGap =
    style.columnGap === "normal" ? 0 : parseFloat(style.columnGap) || 0;

  const columnWidth =
    (totalWidth - (columnCount - 1) * columnGap) / columnCount;

  if (columnWidth <= 0 || totalHeight <= 0) return;

  const wrapper = document.createElement("div");
  wrapper.style.width = `${columnWidth}px`;

  while (container.firstChild) {
    wrapper.appendChild(container.firstChild);
  }

  container.style.columns = "auto";
  container.style.columnCount = "auto";
  container.style.columnWidth = "auto";
  container.style.columnFill = "initial";
  container.style.columnGap = "0";

  container.appendChild(wrapper);

  const tree = buildLayoutTree(wrapper);
  const fragments = createFragments(
    tree,
    new ConstraintSpace({
      availableInlineSize: columnWidth,
      availableBlockSize: totalHeight,
      fragmentainerBlockSize: totalHeight,
      fragmentationType: FRAGMENTATION_COLUMN,
    }),
  );

  container.innerHTML = "";

  const mc = document.createElement("multicol-container");
  mc.setColumns(columnWidth, totalHeight, columnGap);

  for (let i = 0; i < fragments.length; i++) {
    const colEl = document.createElement("div");
    const prevBT = i > 0 ? fragments[i - 1].breakToken : null;
    colEl.appendChild(composeFragment(fragments[i], prevBT));
    mc.appendChild(colEl);
  }

  container.appendChild(mc);
}
