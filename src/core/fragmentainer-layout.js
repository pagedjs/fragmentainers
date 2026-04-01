import { DOMLayoutNode } from "../dom/layout-node.js";
import { runLayoutGenerator, getLayoutAlgorithm } from "./layout-request.js";
import { createFragments } from "./layout-request.js";
import { PhysicalFragment } from "./fragment.js";
import { BlockBreakToken } from "./tokens.js";
import { renderFragmentTree } from "../compositor/render-fragments.js";
import { PageSizeResolver } from "../atpage/page-rules.js";
import { CounterState, walkFragmentTree } from "./counter-state.js";
import { ConstraintSpace } from "./constraint-space.js";
import { isMonolithic, isForcedBreakValue } from "./helpers.js";
import { FRAGMENTATION_COLUMN } from "./constants.js";
import { MeasurementBatch } from "../dom/measurement-batch.js";
import "../dom/content-measure.js";

function buildLayoutTree(rootElement) {
  return new DOMLayoutNode(rootElement);
}

function* chunks(array, size) {
  for (let i = 0; i < array.length; i += size) {
    yield array.slice(i, i + size);
  }
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
      : undefined;

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
   * When content is a large DocumentFragment (more children than
   * `batchSize`), uses the batched pipeline: elements are injected
   * into the measurement container a batch at a time, measured,
   * laid out, then detached so memory stays bounded.
   *
   * For small content or mock nodes, falls through to `#flowStepper()`.
   *
   * @param {Object} [options]
   * @param {number} [options.batchSize=10] — elements per batch
   * @param {boolean} [options.progressive=false] — reserved for future use
   * @returns {Promise<FragmentedFlow>} The fragmented content with rendering methods
   */
  async flow({ batchSize = 10, progressive = false } = {}) {
    // Batched pipeline: large DocumentFragments with page resolver
    if (typeof DocumentFragment !== "undefined" &&
        this.#content instanceof DocumentFragment &&
        this.#content.children.length > batchSize &&
        !this.#constraintSpace) {
      return this.#initBatchedPipeline(batchSize, progressive);
    }

    return this.#flowStepper();
  }

  /**
   * Simple stepper path — lay out all content in one pass.
   * @returns {Promise<FragmentedFlow>}
   */
  async #flowStepper() {
    this.setup();

    // Force a style/layout pass so the browser discovers @font-face
    // references in the newly injected content, then wait for fonts
    // and images to finish loading before measuring.
    if (this.#measureElement) {
      void this.#measureElement.offsetHeight;
    }
    if (typeof document !== "undefined" && document.fonts?.ready) {
      await document.fonts.ready;
    }
    if (this.#measureElement) {
      await this.#waitForImages(this.#measureElement.contentRoot);
    }

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
   * Batched pipeline — process elements in chunks.
   *
   * 1. Set up an empty measurement container.
   * 2. For each batch of top-level children:
   *    a. Inject into measurer, build layout tree, batch-read sizes.
   *    b. Run createFragments for this batch.
   *    c. Detach elements from measurer.
   * 3. Compose per-batch fragments into page-level fragments.
   *
   * @param {number} batchSize
   * @param {boolean} _progressive — reserved
   * @returns {Promise<FragmentedFlow>}
   */
  async #initBatchedPipeline(batchSize, _progressive) {
    const content = this.#content;
    const children = [...content.children];

    // Set up measurement container
    const measurer = document.createElement("content-measure");
    document.body.appendChild(measurer);
    this.#measureElement = measurer;
    this.#ownsMeasurer = true;

    const styles = this.#styles || [...document.styleSheets];
    measurer.setupEmpty(styles);
    this.#contentStyles = measurer.getContentStyles();

    // Auto-create resolver from @page rules in styles if neither set
    if (!this.#resolver && !this.#constraintSpace) {
      this.#resolver = PageSizeResolver.fromStyleSheets(styles);
    }

    const state = this.#createBatchState();

    for (const batch of chunks(children, batchSize)) {
      await this.#processBatch(batch, measurer, state);
    }

    const pageFragments = this.#composePageFragments(state);
    this.#fragments = pageFragments;
    measurer.remove();

    return new FragmentedFlow(pageFragments, this.#contentStyles, this);
  }

  /**
   * Create fresh state for the batched pipeline.
   */
  #createBatchState() {
    return {
      allChildFragments: [],
      breakToken: null,
      fragmentainerIndex: 0,
      counterState: new CounterState(),
    };
  }

  /**
   * Process a single batch of elements.
   */
  async #processBatch(batch, measurer, state) {
    // Inject batch elements
    for (const el of batch) {
      measurer.injectChild(el);
    }

    // Apply constraint space first — forces a synchronous reflow
    // (via offsetHeight) so the browser discovers @font-face
    // references in the newly injected content.
    const constraintSpace = this.#resolveConstraintSpace(state);
    measurer.applyConstraintSpace(constraintSpace);

    // Wait for fonts and images to finish loading before measuring.
    if (typeof document !== "undefined" && document.fonts?.ready) {
      await document.fonts.ready;
    }
    await this.#waitForImages(measurer.contentRoot);

    // Build layout tree and batch-read all measurements (now that
    // fonts and images are loaded, sizes are accurate).
    const tree = buildLayoutTree(measurer.contentRoot);
    const mb = new MeasurementBatch();
    mb.collectAll(tree);

    // Run fragmentation on this batch
    const fragments = createFragments(tree, constraintSpace);

    // Collect child fragments from each fragmentainer
    for (const frag of fragments) {
      state.allChildFragments.push(...frag.childFragments);
    }

    // Update break token from the last fragment
    if (fragments.length > 0) {
      const lastFrag = fragments[fragments.length - 1];
      state.breakToken = lastFrag.breakToken;
    }

    // Detach batch elements from measurer
    for (const el of batch) {
      measurer.detachChild(el);
    }
  }

  /**
   * Resolve constraint space for the current batch.
   */
  #resolveConstraintSpace(state) {
    if (this.#constraintSpace) return this.#constraintSpace;
    if (this.#resolver) {
      const constraints = this.#resolver.resolve(state.fragmentainerIndex, null, null);
      return constraints.toConstraintSpace();
    }
    // Default fallback
    return new ConstraintSpace({
      availableInlineSize: 816,
      availableBlockSize: 1056,
      fragmentainerBlockSize: 1056,
      fragmentationType: "page",
    });
  }

  /**
   * Wait for all <img> elements under `root` to finish loading.
   * Resolves immediately when there are no pending images.
   */
  #waitForImages(root) {
    if (!root) return Promise.resolve();
    const pending = [];
    for (const img of root.querySelectorAll("img")) {
      if (!img.complete) {
        pending.push(new Promise((r) => {
          img.addEventListener("load", r, { once: true });
          img.addEventListener("error", r, { once: true });
        }));
      }
    }
    return pending.length > 0 ? Promise.all(pending) : Promise.resolve();
  }

  /**
   * Compose collected child fragments into page-level fragments.
   */
  #composePageFragments(state) {
    if (state.allChildFragments.length === 0) return [];

    const fragments = [];
    let pageChildren = [];
    let pageBlockOffset = 0;
    let pageIndex = 0;

    const getConstraints = (idx) => {
      if (this.#resolver) {
        return this.#resolver.resolve(idx, null, null);
      }
      return null;
    };

    const constraints = getConstraints(pageIndex);
    const cs = constraints
      ? constraints.toConstraintSpace()
      : this.#constraintSpace;
    let pageBlockSize = cs.fragmentainerBlockSize;

    for (const childFrag of state.allChildFragments) {
      const childSize = childFrag.blockSize;

      // Check if this child would overflow the current page
      if (pageBlockOffset + childSize > pageBlockSize && pageChildren.length > 0) {
        // Finish current page
        const pageFrag = this.#buildPageFragment(pageChildren, pageBlockOffset, pageIndex, constraints);
        fragments.push(pageFrag);

        // Start new page
        pageIndex++;
        pageChildren = [];
        pageBlockOffset = 0;
        const newConstraints = getConstraints(pageIndex);
        const newCs = newConstraints
          ? newConstraints.toConstraintSpace()
          : this.#constraintSpace;
        pageBlockSize = newCs.fragmentainerBlockSize;
      }

      pageChildren.push(childFrag);
      pageBlockOffset += childSize;
    }

    // Flush remaining children into a final page
    if (pageChildren.length > 0) {
      const finalConstraints = getConstraints(pageIndex);
      const pageFrag = this.#buildPageFragment(pageChildren, pageBlockOffset, pageIndex, finalConstraints);
      fragments.push(pageFrag);
    }

    return fragments;
  }

  /**
   * Build a page-level PhysicalFragment from child fragments.
   */
  #buildPageFragment(children, blockOffset, pageIndex, constraints) {
    const frag = new PhysicalFragment(null, blockOffset, children);
    if (constraints) {
      frag.constraints = constraints;
    } else if (this.#constraintSpace) {
      frag.constraints = {
        contentArea: {
          inlineSize: this.#constraintSpace.availableInlineSize,
          blockSize: this.#constraintSpace.availableBlockSize,
        },
      };
    }
    frag.inlineSize = constraints
      ? constraints.toConstraintSpace().availableInlineSize
      : this.#constraintSpace?.availableInlineSize || 816;

    // Build a break token if there are more children to come
    if (children.length > 0) {
      const lastChild = children[children.length - 1];
      if (lastChild.breakToken) {
        frag.breakToken = lastChild.breakToken;
      }
    }

    return frag;
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

    if (this.#ownsMeasurer && this.#measureElement) {
      // Rebuild layout tree from existing measurer (content already injected)
      this.#tree = buildLayoutTree(this.#measureElement.contentRoot);
    } else if (typeof DocumentFragment !== "undefined" && content instanceof DocumentFragment) {
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
    wrapper.appendChild(renderFragmentTree(fragment, prevBreakToken, el.nthFormulas, this.#contentStyles?.sourceRefs));
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
