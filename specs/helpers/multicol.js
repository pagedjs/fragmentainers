/**
 * Multicol spec processor — replaces CSS column layout with
 * the library's fragmentation engine output.
 */
import { ConstraintSpace } from "/src/core/constraint-space.js";
import { buildLayoutTree } from "/src/dom/index.js";
import { createFragments } from "/src/core/layout-request.js";
import { renderFragmentTree } from "/src/compositor/render-fragments.js";

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
export async function processMulticol(container) {
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
      fragmentationType: "column",
    }),
  );

  container.innerHTML = "";
  container.style.display = "flex";
  container.style.flexWrap = "nowrap";
  container.style.alignItems = "flex-start";
  container.style.gap = `${columnGap}px`;

  for (let i = 0; i < fragments.length; i++) {
    const colEl = document.createElement("div");
    colEl.style.width = `${columnWidth}px`;
    colEl.style.height = `${totalHeight}px`;
    colEl.style.overflow = "hidden";
    colEl.style.flexShrink = "0";

    const prevBT = i > 0 ? fragments[i - 1].breakToken : null;
    colEl.appendChild(renderFragmentTree(fragments[i], prevBT));
    container.appendChild(colEl);
  }
}
