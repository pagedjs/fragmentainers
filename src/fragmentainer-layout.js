import { DOMLayoutNode } from "./dom/layout-node.js";
import { createFragments } from "./driver.js";
import { renderFragmentTree } from "./compositor/render-fragments.js";
import { PageSizeResolver } from "./page-rules.js";

function buildLayoutTree(rootElement) {
  return new DOMLayoutNode(rootElement);
}

const DEFAULT_SIZE = { inlineSize: 816, blockSize: 1056 };

/**
 * Coordinator for the content-to-fragmentation pipeline.
 *
 * Encapsulates the full lifecycle: build layout tree, paginate via
 * the driver, and return a FragmentedFlow that owns the fragment
 * results and provides rendering methods.
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
    const fragments = createFragments(tree, this.#resolver);
    const contentStyles = this.#captureContentStyles(element);
    return new FragmentedFlow(fragments, contentStyles);
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
