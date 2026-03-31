import { DOMLayoutNode } from "./dom/layout-node.js";
import { runLayoutGenerator, getLayoutAlgorithm } from "./layout-request.js";
import { renderFragmentTree } from "./compositor/render-fragments.js";
import { PageSizeResolver } from "./page-rules.js";
import { CounterState, walkFragmentTree } from "./counter-state.js";
import { ConstraintSpace } from "./constraint-space.js";
import { FRAGMENTATION_COLUMN } from "./constants.js";
import "./dom/content-measure.js";

function buildLayoutTree(rootElement) {
  return new DOMLayoutNode(rootElement);
}

const MAX_ZERO_PROGRESS = 5;

/**
 * Coordinator for the content-to-fragmentation pipeline.
 *
 * Encapsulates the full lifecycle: build layout tree, paginate via
 * the fragmentainer loop, and return a FragmentedFlow that owns the
 * fragment results and provides rendering methods.
 *
 * Accepts options in priority order:
 * - `constraintSpace` — full control, bypasses @page rules entirely
 * - `resolver` — pre-configured PageSizeResolver or RegionResolver
 * - `width` / `height` — sugar for column fragmentation at a fixed size
 * - (none) — auto-collects @page rules from document.styleSheets,
 *   defaults to US Letter
 *
 * Matches Chromium's LayoutView pattern. Uses CSS Fragmentation
 * Module Level 3 terminology throughout.
 */
export class FragmentainerLayout {
  #content;
  #styles;
  #resolver;
  #constraintSpace;

  // Stepper state (initialized lazily on first next() call)
  #tree = null;
  #measureElement = null;
  #ownsMeasurer = false;
  #breakToken = null;
  #fragmentainerIndex = 0;
  #counterState = null;
  #contentStyles = null;
  #prevFragment = null;
  #fragments = [];

  /**
   * @param {DocumentFragment|Element|object} content - Content to fragment
   * @param {object} [options]
   * @param {CSSStyleSheet[]} [options.styles] - Stylesheets (copies document.styleSheets if omitted)
   * @param {ConstraintSpace} [options.constraintSpace] - Direct constraint space (bypasses @page rules)
   * @param {PageSizeResolver|RegionResolver} [options.resolver] - Pre-configured resolver
   * @param {number} [options.width] - Container width in CSS px (column fragmentation)
   * @param {number} [options.height] - Container height in CSS px (column fragmentation)
   */
  constructor(content, options = {}) {
    // Normalize Element → DocumentFragment (clone into fragment)
    if (content.nodeType === 1 /* ELEMENT_NODE */) {
      const frag = document.createDocumentFragment();
      frag.appendChild(content.cloneNode(true));
      this.#content = frag;
    } else {
      this.#content = content;
    }

    this.#styles = options.styles
      ? (Array.isArray(options.styles) ? options.styles : [options.styles])
      : null;

    if (options.constraintSpace) {
      this.#constraintSpace = options.constraintSpace;
      this.#resolver = null;
    } else if (options.resolver) {
      this.#resolver = options.resolver;
    } else if (options.width || options.height) {
      const w = options.width || options.height;
      const h = options.height || options.width;
      this.#constraintSpace = new ConstraintSpace({
        availableInlineSize: w,
        availableBlockSize: h,
        fragmentainerBlockSize: h,
        fragmentationType: options.type || FRAGMENTATION_COLUMN,
      });
      this.#resolver = null;
    }
    // Page resolver auto-created in setup() from styles if neither set
  }

  /**
   * Lay out the next fragmentainer and return its fragment.
   *
   * The caller controls the loop — call next() repeatedly to fill
   * regions, pages, or any container. Check fragment.breakToken to
   * know if content remains.
   *
   * @returns {import('./fragment.js').PhysicalFragment}
   */
  next() {
    this.setup();

    // Resolve constraint space for this fragmentainer
    let constraintSpace;
    let constraints = null;

    if (this.#resolver) {
      constraints = this.#resolver.resolve(
        this.#fragmentainerIndex,
        this.#tree,
        this.#breakToken,
      );
      constraintSpace = constraints.toConstraintSpace();
    } else {
      constraintSpace = this.#constraintSpace;
    }

    // Sync DOM measurement container
    if (this.#measureElement) {
      this.#measureElement.applyConstraintSpace(constraintSpace);
    }

    // Layout this fragmentainer (with two-pass earlyBreak support)
    const result = this.#layoutFragmentainer(
      this.#tree,
      constraintSpace,
      this.#breakToken,
    );
    if (constraints) {
      result.fragment.constraints = constraints;
    } else {
      result.fragment.constraints = {
        contentArea: {
          inlineSize: constraintSpace.availableInlineSize,
          blockSize: constraintSpace.availableBlockSize,
        },
      };
    }

    // Counter state accumulation
    const prevBT = this.#prevFragment?.breakToken ?? null;
    walkFragmentTree(result.fragment, prevBT, this.#counterState);
    if (!this.#counterState.isEmpty()) {
      result.fragment.counterState = this.#counterState.snapshot();
    }

    // Advance state
    this.#breakToken = result.breakToken;
    this.#prevFragment = result.fragment;
    this.#fragmentainerIndex++;
    this.#fragments.push(result.fragment);

    return result.fragment;
  }

  /**
   * Run fragmentation to completion and return a FragmentedFlow.
   *
   * Sugar over next() — calls it in a loop until all content is consumed.
   *
   * @returns {FragmentedFlow} The fragmented content with rendering methods
   */
  flow() {
    const fragments = [];
    let zeroProgressCount = 0;
    let fragment;

    do {
      fragment = this.next();
      fragments.push(fragment);

      // Zero-progress safety
      if (fragment.breakToken && fragment.blockSize === 0) {
        zeroProgressCount++;
        if (zeroProgressCount >= MAX_ZERO_PROGRESS) {
          console.warn(
            `Fragmentainer: stopped after ${MAX_ZERO_PROGRESS} consecutive zero-progress fragmentainers`,
          );
          break;
        }
      } else {
        zeroProgressCount = 0;
      }
    } while (fragment.breakToken !== null);

    return new FragmentedFlow(fragments, this.#contentStyles, this);
  }

  /**
   * Reset the stepper to re-layout from a specific fragmentainer.
   *
   * Used for reflow: when source content changes, reset to the
   * break token before the affected fragmentainer and re-run next()
   * forward. Measurements are already live — no cache invalidation
   * needed for size-only changes.
   *
   * Pass `{ rebuild: true }` after structural DOM changes (add/remove
   * elements) to force a layout tree reconstruction. This is needed
   * because DOMLayoutNode caches are stale after structural mutations.
   *
   * @param {number} [fromIndex=0] - Fragmentainer index to restart from
   * @param {Object} [options]
   * @param {boolean} [options.rebuild=false] - Rebuild the layout tree from source DOM
   */
  reflow(fromIndex = 0, { rebuild = false } = {}) {
    if (rebuild) {
      this.#tree = null;
      this.setup(true);
    } else {
      this.setup();
    }
    const prev = fromIndex > 0 ? this.#fragments[fromIndex - 1] : null;
    this.#breakToken = prev?.breakToken ?? null;
    this.#fragmentainerIndex = fromIndex;
    this.#prevFragment = null;
    this.#counterState = new CounterState();
    if (prev?.counterState) {
      this.#counterState.restore(prev.counterState);
    }
    this.#fragments.length = fromIndex;
  }

  /**
   * Lay out one fragmentainer with two-pass earlyBreak support.
   */
  #layoutFragmentainer(rootNode, constraintSpace, breakToken) {
    const rootAlgorithm = getLayoutAlgorithm(rootNode);
    let result = runLayoutGenerator(
      rootAlgorithm,
      rootNode,
      constraintSpace,
      breakToken,
    );
    if (result.earlyBreak) {
      result = runLayoutGenerator(
        rootAlgorithm,
        rootNode,
        constraintSpace,
        breakToken,
        result.earlyBreak,
      );
    }
    return result;
  }

  /**
   * Initialize layout tree and measurement state.
   * Called lazily on first next() call. Can also be called explicitly
   * to force re-initialization (e.g. after structural DOM changes).
   *
   * @param {boolean} [forceUpdate=false] - Force re-initialization
   */
  setup(forceUpdate = false) {
    if (this.#tree && !forceUpdate) return;
    const content = this.#content;

    if (typeof DocumentFragment !== "undefined" && content instanceof DocumentFragment) {
      // Create internal <content-measure> and inject the fragment
      const measurer = document.createElement("content-measure");
      document.body.appendChild(measurer);
      const wrapper = measurer.injectFragment(content, this.#styles);

      this.#tree = buildLayoutTree(wrapper);
      this.#measureElement = measurer;
      this.#contentStyles = measurer.getContentStyles();
      this.#ownsMeasurer = true;

      // Auto-create resolver from @page rules in styles if neither set
      if (!this.#resolver && !this.#constraintSpace) {
        const sheets = this.#styles || [...document.styleSheets];
        this.#resolver = PageSizeResolver.fromStyleSheets(sheets);
      }
    } else if (content.nodeType) {
      // DOM element passed directly (legacy path)
      this.#tree = buildLayoutTree(content);
      const root = content.getRootNode();
      this.#measureElement = root.host?.applyConstraintSpace ? root.host : null;
      if (root.host && typeof root.host.getContentStyles === "function") {
        this.#contentStyles = root.host.getContentStyles();
      }
    } else {
      // Mock node (unit tests)
      this.#tree = content;
    }

    this.#counterState = new CounterState();
  }

  /**
   * Clean up the internal measurement container.
   * Call when the layout is no longer needed.
   */
  destroy() {
    if (this.#ownsMeasurer && this.#measureElement) {
      this.#measureElement.remove();
      this.#measureElement = null;
    }
  }
}

/**
 * The result of running fragmentation — a "fragmented flow" in CSS spec terms.
 *
 * Owns the fragment array and provides rendering methods. Each fragment
 * carries its own `constraints` (from PageSizeResolver via createFragments),
 * so no separate sizes array is needed.
 */
export class FragmentedFlow {
  #fragments;
  #contentStyles;
  #layout;

  /**
   * @param {import('./fragment.js').PhysicalFragment[]} fragments
   * @param {{ sheets: CSSStyleSheet[], nthFormulas: Map }|null} contentStyles
   * @param {FragmentainerLayout|null} layout — back-reference for reflow
   */
  constructor(fragments, contentStyles, layout = null) {
    this.#fragments = fragments;
    this.#contentStyles = contentStyles;
    this.#layout = layout;
  }

  /** @returns {import('./fragment.js').PhysicalFragment[]} */
  get fragments() {
    return this.#fragments;
  }

  /** @returns {number} */
  get fragmentainerCount() {
    return this.#fragments.length;
  }

  /**
   * Render a single fragmentainer as a <fragment-container> element.
   *
   * @param {number} index - Zero-based fragmentainer index
   * @returns {Element} A <fragment-container> element
   */
  renderFragmentainer(index) {
    const fragment = this.#fragments[index];
    const { contentArea } = fragment.constraints;
    const prevBreakToken =
      index > 0 ? this.#fragments[index - 1].breakToken : null;

    const el = document.createElement("fragment-container");
    el.fragmentIndex = index;
    el.style.width = `${contentArea.inlineSize}px`;
    el.style.height = `${contentArea.blockSize}px`;
    el.style.overflow = "hidden";
    const counterSnapshot =
      index > 0 ? this.#fragments[index - 1].counterState : null;
    const wrapper = el.setupForRendering(
      this.#contentStyles,
      counterSnapshot,
    );
    wrapper.appendChild(renderFragmentTree(fragment, prevBreakToken, el.nthFormulas));
    return el;
  }

  /**
   * Render all fragmentainers.
   *
   * @returns {Element[]} Array of <fragment-container> elements
   */
  render() {
    const elements = [];
    for (let i = 0; i < this.#fragments.length; i++) {
      elements.push(this.renderFragmentainer(i));
    }
    return elements;
  }

  /**
   * Re-layout from a specific fragmentainer and return new rendered elements.
   *
   * Resets the layout stepper to the break token before `fromIndex`,
   * re-runs layout to completion with live measurements, splices the
   * new fragments into this flow, and renders them.
   *
   * @param {number} [fromIndex=0] - Fragmentainer index to re-layout from
   * @param {Object} [options]
   * @param {boolean} [options.rebuild=false] - Rebuild layout tree (for structural DOM changes)
   * @returns {{ from: number, removedCount: number, elements: Element[] }}
   */
  reflow(fromIndex = 0, options = {}) {
    this.#layout.reflow(fromIndex, options);

    // Re-run layout to completion
    const newFragments = [];
    let zeroProgressCount = 0;
    let fragment;
    do {
      fragment = this.#layout.next();
      newFragments.push(fragment);
      if (fragment.breakToken && fragment.blockSize === 0) {
        if (++zeroProgressCount >= MAX_ZERO_PROGRESS) break;
      } else {
        zeroProgressCount = 0;
      }
    } while (fragment.breakToken !== null);

    // Splice new fragments into the array
    const removedCount = this.#fragments.length - fromIndex;
    this.#fragments.splice(fromIndex, Infinity, ...newFragments);

    // Render the new fragments
    const elements = [];
    for (let i = fromIndex; i < this.#fragments.length; i++) {
      elements.push(this.renderFragmentainer(i));
    }
    return { from: fromIndex, removedCount, elements };
  }
}
