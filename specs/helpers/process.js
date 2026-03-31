/**
 * Spec test page processor — injected into test pages via Playwright.
 *
 * Detects whether the page uses @page rules (pagination) or CSS columns
 * (multicol), then runs the library's fragmentation engine accordingly.
 */
import { FragmentainerLayout } from "/src/fragmentainer-layout.js";
import { ConstraintSpace } from "/src/constraint-space.js";
import { buildLayoutTree } from "/src/dom/index.js";
import { createFragments } from "/src/layout-request.js";
import { renderFragmentTree } from "/src/compositor/render-fragments.js";
import { PageSizeResolver } from "/src/page-rules.js";

async function run() {
  try {
    await document.fonts.ready;

    const resolver = PageSizeResolver.fromDocument();
    const multicolContainers = findMulticolContainers(document.body);

    if (resolver.pageRules.length > 0) {
      await runPageMode(resolver);
    } else if (multicolContainers.length > 0) {
      await runMulticolMode(multicolContainers);
    }

    document.documentElement.dataset.specReady = "true";
  } catch (err) {
    console.error("Spec process error:", err);
    document.documentElement.dataset.specError = err.message + "\n" + err.stack;
    document.documentElement.dataset.specReady = "true";
  }
}

// ---- Page mode ----

async function runPageMode(resolver) {
  const firstConstraints = resolver.resolve(0, null, null);
  const measureWidth = firstConstraints.contentArea.inlineSize;

  const wrapper = document.createElement("div");
  wrapper.style.width = `${measureWidth}px`;

  while (document.body.firstChild) {
    wrapper.appendChild(document.body.firstChild);
  }

  document.body.style.margin = "0";
  document.body.style.padding = "0";
  document.body.style.background = "none";
  document.body.appendChild(wrapper);

  const layout = new FragmentainerLayout(wrapper, { resolver });
  const flow = layout.flow();

  document.body.removeChild(wrapper);

  // Render each page sized to the full page box, with @page margins
  // as padding (matching the reference HTML pattern).
  for (let i = 0; i < flow.fragmentainerCount; i++) {
    const { pageBoxSize, margins } = flow.fragments[i].constraints;
    const fragEl = flow.renderFragmentainer(i);
    fragEl.className = "spec-page";
    fragEl.dataset.pageIndex = i;
    fragEl.style.width = `${pageBoxSize.inlineSize}px`;
    fragEl.style.height = `${pageBoxSize.blockSize}px`;
    fragEl.style.boxSizing = "border-box";
    fragEl.style.paddingTop = `${margins.top}px`;
    fragEl.style.paddingRight = `${margins.right}px`;
    fragEl.style.paddingBottom = `${margins.bottom}px`;
    fragEl.style.paddingLeft = `${margins.left}px`;
    document.body.appendChild(fragEl);
  }

  document.documentElement.dataset.pageCount = String(flow.fragmentainerCount);
}

// ---- Multicol mode ----

function findMulticolContainers(root) {
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

async function runMulticolMode(containers) {
  for (const container of containers) {
    await processMulticol(container);
  }
}

async function processMulticol(container) {
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

// Start processing
run();
