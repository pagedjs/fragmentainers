import { DOMLayoutNode } from "./dom/layout-node.js";
import { runLayoutGenerator, getLayoutAlgorithm } from "./layout-request.js";
import { renderFragmentTree } from "./compositor/render-fragments.js";
import { PageSizeResolver } from "./page-rules.js";
import { resolveNamedPageForBreakToken } from "./helpers.js";
import { CounterState, walkFragmentTree } from "./counter-state.js";
import { ConstraintSpace } from "./constraint-space.js";

function buildLayoutTree(rootElement) {
  return new DOMLayoutNode(rootElement);
}

const DEFAULT_SIZE = { inlineSize: 816, blockSize: 1056 };
const MAX_ZERO_PROGRESS = 5;

/**
 * Coordinator for the content-to-fragmentation pipeline.
 *
 * Encapsulates the full lifecycle: build layout tree, paginate via
 * the fragmentainer loop, and return a FragmentedFlow that owns the
 * fragment results and provides rendering methods.
 *
 * Matches Chromium's LayoutView pattern. Uses CSS Fragmentation
 * Module Level 3 terminology throughout.
 */
export class FragmentainerLayout {
  #contentElement;
  #resolver;

  /**
   * @param {Element} contentElement - The root content element to fragment
   * @param {object} [options]
   * @param {PageSizeResolver} [options.resolver] - Pre-configured resolver with @page rules
   * @param {{ inlineSize: number, blockSize: number }} [options.defaultSize] - Single default fragmentainer size
   */
  constructor(contentElement, options = {}) {
    this.#contentElement = contentElement;
    if (options.resolver) {
      this.#resolver = options.resolver;
    } else {
      const size = options.defaultSize || DEFAULT_SIZE;
      this.#resolver = new PageSizeResolver([], size);
    }
  }

  /**
   * Run fragmentation and return a FragmentedFlow.
   *
   * @returns {FragmentedFlow} The fragmented content with rendering methods
   */
  flow() {
    const element = this.#contentElement instanceof DocumentFragment
      ? this.#contentElement.firstElementChild
      : this.#contentElement;
    const tree = buildLayoutTree(element);

    // Resolve the measure element: when content lives inside a
    // <content-measure> shadow root, the host provides
    // applyConstraintSpace() for DOM measurement sync.
    const root = element.getRootNode();
    const measureElement = root.host?.applyConstraintSpace ? root.host : null;

    const { fragments } = this.#fragmentRoot(tree, measureElement, 0, 0);
    const contentStyles = this.#captureContentStyles(element);
    return new FragmentedFlow(fragments, contentStyles);
  }

  /**
   * Lay out one fragmentainer with two-pass earlyBreak support.
   *
   * @param {import('./dom/layout-node.js').DOMLayoutNode} rootNode
   * @param {ConstraintSpace} constraintSpace
   * @param {import('./tokens.js').BreakToken|null} breakToken
   * @returns {{ fragment: import('./fragment.js').PhysicalFragment, breakToken: import('./tokens.js').BreakToken|null, earlyBreak?: object }}
   */
  #layoutFragmentainer(rootNode, constraintSpace, breakToken) {
    const rootAlgorithm = getLayoutAlgorithm(rootNode);
    let result = runLayoutGenerator(rootAlgorithm, rootNode, constraintSpace, breakToken);
    if (result.earlyBreak) {
      result = runLayoutGenerator(
        rootAlgorithm, rootNode, constraintSpace, breakToken, result.earlyBreak
      );
    }
    return result;
  }

  /**
   * Lay out a single content root across fragmentainers.
   * Resolves constraints per-fragmentainer, syncs the DOM measurement
   * container, and collects fragments.
   *
   * Analogous to Chromium's constraint propagation — each fragmentainer
   * gets its own ConstraintSpace, and the browser's layout state is
   * synchronized before reading DOM measurements.
   *
   * @param {import('./dom/layout-node.js').DOMLayoutNode} tree — root layout node
   * @param {Element|null} measureElement — <content-measure> host, or null
   * @param {number} startIndex — first fragmentainer index
   * @param {number} startOffset — block offset into first fragmentainer
   * @returns {{ fragments: import('./fragment.js').PhysicalFragment[], continuation: { fragmentainerIndex: number, blockOffset: number } }}
   */
  #fragmentRoot(tree, measureElement, startIndex, startOffset) {
    const fragments = [];
    let breakToken = null;
    let zeroProgressCount = 0;
    const counterState = new CounterState();

    for (let i = startIndex; breakToken !== null || i === startIndex; i++) {
      const namedPage = resolveNamedPageForBreakToken(tree, breakToken);
      const constraints = this.#resolver.resolve(i, namedPage, null);
      let constraintSpace = constraints.toConstraintSpace();

      // Adjust first fragmentainer's offset when continuing from previous element
      if (i === startIndex && startOffset > 0) {
        constraintSpace = new ConstraintSpace({
          availableInlineSize: constraintSpace.availableInlineSize,
          availableBlockSize: constraintSpace.fragmentainerBlockSize - startOffset,
          fragmentainerBlockSize: constraintSpace.fragmentainerBlockSize,
          blockOffsetInFragmentainer: startOffset,
          fragmentationType: constraintSpace.fragmentationType,
          isNewFormattingContext: constraintSpace.isNewFormattingContext,
        });
      }

      // Sync DOM measurement container to this fragmentainer's constraints.
      // Analogous to Chromium's constraint propagation — ensure the browser's
      // layout state matches the fragmentainer's available inline size before
      // the engine reads any DOM measurements.
      if (measureElement) {
        measureElement.applyConstraintSpace(constraintSpace);
      }

      const result = this.#layoutFragmentainer(tree, constraintSpace, breakToken);
      result.fragment.constraints = constraints;
      fragments.push(result.fragment);
      breakToken = result.breakToken;

      // Counter state accumulation
      const prevBT = i > startIndex
        ? fragments[fragments.length - 2]?.breakToken ?? null
        : null;
      walkFragmentTree(result.fragment, prevBT, counterState);
      if (!counterState.isEmpty()) {
        result.fragment.counterState = counterState.snapshot();
      }

      // Zero-progress safety
      if (breakToken && result.fragment.blockSize === 0) {
        zeroProgressCount++;
        if (zeroProgressCount >= MAX_ZERO_PROGRESS) {
          console.warn(`Fragmentainer: stopped after ${MAX_ZERO_PROGRESS} consecutive zero-progress fragmentainers`);
          break;
        }
      } else {
        zeroProgressCount = 0;
      }
    }

    // Build continuation state
    const lastFragment = fragments[fragments.length - 1];
    const lastIndex = startIndex + fragments.length - 1;
    const lastOffset = lastFragment
      ? lastFragment.blockSize + (fragments.length === 1 ? startOffset : 0) : 0;
    const pageBlockSize = lastFragment?.constraints?.contentArea?.blockSize ?? 0;

    return {
      fragments,
      continuation: {
        fragmentainerIndex: lastOffset >= pageBlockSize ? lastIndex + 1 : lastIndex,
        blockOffset: lastOffset >= pageBlockSize ? 0 : lastOffset,
      },
    };
  }

  /**
   * Capture content styles from the shadow host if available.
   * When the content element lives inside a <content-measure> shadow root,
   * the host exposes getContentStyles() for CSS isolation during rendering.
   */
  #captureContentStyles(element) {
    const el = element || this.#contentElement;
    const root = el.getRootNode();
    const host = root.host;
    if (host && typeof host.getContentStyles === "function") {
      return host.getContentStyles();
    }
    return null;
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

  /**
   * @param {import('./fragment.js').PhysicalFragment[]} fragments
   * @param {{ sheets: CSSStyleSheet[], cssText: string }|null} contentStyles
   */
  constructor(fragments, contentStyles) {
    this.#fragments = fragments;
    this.#contentStyles = contentStyles;
  }

  /** @returns {import('./fragment.js').PhysicalFragment[]} */
  get fragments() { return this.#fragments; }

  /** @returns {number} */
  get fragmentainerCount() { return this.#fragments.length; }

  /**
   * Render a single fragmentainer as a <fragment-container> element.
   *
   * @param {number} index - Zero-based fragmentainer index
   * @returns {Element} A <fragment-container> element
   */
  renderFragmentainer(index) {
    const fragment = this.#fragments[index];
    const { contentArea } = fragment.constraints;
    const prevBreakToken = index > 0 ? this.#fragments[index - 1].breakToken : null;

    const el = document.createElement("fragment-container");
    el.style.width = `${contentArea.inlineSize}px`;
    el.style.height = `${contentArea.blockSize}px`;
    el.style.overflow = "hidden";
    const counterSnapshot = index > 0
      ? this.#fragments[index - 1].counterState
      : null;
    const wrapper = el.setupForRendering(this.#contentStyles, counterSnapshot);
    wrapper.appendChild(renderFragmentTree(fragment, prevBreakToken));
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
}
