import { DOMLayoutNode } from "./dom/layout-node.js";
import { createFragments } from "./driver.js";
import { PhysicalFragment } from "./fragment.js";
import { renderFragmentTree } from "./compositor/render-fragments.js";
import { PageSizeResolver } from "./page-rules.js";

// Lazy import: ContentMeasureGroup requires browser DOM (HTMLElement).
// Loaded on first use to keep this module importable in Node.js tests.
let _ContentMeasureGroup = null;
async function getContentMeasureGroup() {
  if (!_ContentMeasureGroup) {
    const mod = await import("./dom/frag-measure.js");
    _ContentMeasureGroup = mod.ContentMeasureGroup;
  }
  return _ContentMeasureGroup;
}
function getContentMeasureGroupSync() {
  if (!_ContentMeasureGroup) {
    throw new Error("ContentMeasureGroup not loaded — call flowAsync() or preload via setMeasureGroup()");
  }
  return _ContentMeasureGroup;
}

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
  /**
   * @param {Element} contentElement - The root content element to fragment
   * @param {object} [options]
   * @param {PageSizeResolver} [options.resolver] - Pre-configured resolver with @page rules
   * @param {{ inlineSize: number, blockSize: number }} [options.defaultSize] - Single default fragmentainer size
   * @param {HTMLElement} [options.measureContainer] - Container for off-screen measure elements
   *   (required when contentElement is a DocumentFragment)
   */
  constructor(contentElement, options = {}) {
    this._contentElement = contentElement;
    this._measureContainer = options.measureContainer || null;
    if (options.resolver) {
      this._resolver = options.resolver;
    } else {
      const size = options.defaultSize || DEFAULT_SIZE;
      this._resolver = new PageSizeResolver([], size);
    }
  }

  /**
   * Run fragmentation and return a FragmentedFlow.
   *
   * When contentElement is a DocumentFragment with multiple children,
   * creates a separate <content-measure> per child and fragments each
   * element independently, merging shared pages.
   *
   * @param {object} [options]
   * @param {'batch'|'sequential'} [options.mode='batch'] - Processing mode
   *   (only applies to multi-element DocumentFragment input)
   * @returns {FragmentedFlow} The fragmented content with rendering methods
   */
  flow({ mode = "batch" } = {}) {
    // Single element path (existing behavior)
    if (!(this._contentElement instanceof DocumentFragment) ||
        this._contentElement.children.length <= 1) {
      const element = this._contentElement instanceof DocumentFragment
        ? this._contentElement.firstElementChild
        : this._contentElement;
      const tree = buildLayoutTree(element);
      const fragments = createFragments(tree, this._resolver);
      const contentStyles = this._captureContentStyles(element);
      return new FragmentedFlow(fragments, contentStyles);
    }

    // Multi-element path: fragment each child independently
    return this._flowMultiElement();
  }

  /**
   * Async fragmentation with sequential measurement.
   * Measures and fragments one element at a time, yielding between each.
   *
   * @param {object} [options]
   * @param {function} [options.onProgress] - Called after each element: ({ index, total, fragmentCount })
   * @returns {Promise<FragmentedFlow>}
   */
  async flowAsync({ onProgress } = {}) {
    const content = this._contentElement;

    // Single element: just run synchronously
    if (!(content instanceof DocumentFragment) || content.children.length <= 1) {
      return this.flow();
    }

    return this._flowMultiElementAsync({ onProgress });
  }

  /** @private — synchronous multi-element fragmentation (batch mode) */
  _flowMultiElement() {
    const group = this._getOrCreateGroup();
    const contentRoots = group.getContentRoots();
    const contentStyles = group.getContentStyles();

    const { fragments, inputBreakTokens } = this._fragmentElements(contentRoots);

    return new FragmentedFlow(fragments, contentStyles, inputBreakTokens);
  }

  /** @private — async multi-element fragmentation (sequential mode) */
  async _flowMultiElementAsync({ onProgress } = {}) {
    if (!this._measureContainer) {
      throw new Error("measureContainer option is required for async multi-element flow");
    }

    // Ensure ContentMeasureGroup is loaded (browser-only dynamic import)
    if (!this._group) {
      const CMG = await getContentMeasureGroup();
      this._group = new CMG(this._measureContainer);
    }
    const group = this._group;
    const contentStyles = group.getContentStyles();
    const allFragments = [];
    const allInputBreakTokens = [];
    let continuation = { fragmentainerIndex: 0, blockOffset: 0 };

    const width = `${this._resolver.resolve(0, null, null).contentArea.inlineSize}px`;

    for await (const { index, contentRoot, total } of group.measureSequential(width)) {
      const tree = buildLayoutTree(contentRoot);
      const result = createFragments(tree, this._resolver, continuation);

      // Merge first fragment with previous last fragment if sharing a page
      if (continuation.blockOffset > 0 && result.fragments.length > 0 && allFragments.length > 0) {
        const prev = allFragments.pop();
        allInputBreakTokens.pop();
        const merged = PhysicalFragment.merge(prev, result.fragments[0]);
        allFragments.push(merged);
        allInputBreakTokens.push(allInputBreakTokens.length > 0
          ? allInputBreakTokens[allInputBreakTokens.length - 1] : null);

        // Add remaining fragments from this element
        for (let i = 1; i < result.fragments.length; i++) {
          const inputBT = result.fragments[i - 1].breakToken;
          allInputBreakTokens.push(inputBT);
          allFragments.push(result.fragments[i]);
        }
      } else {
        for (let i = 0; i < result.fragments.length; i++) {
          const inputBT = i === 0
            ? (allFragments.length > 0 ? allFragments[allFragments.length - 1].breakToken : null)
            : result.fragments[i - 1].breakToken;
          allInputBreakTokens.push(inputBT);
          allFragments.push(result.fragments[i]);
        }
      }

      continuation = result.continuation;

      // Allow disposing this measure element since we're done with it
      group.disposeMeasure(index);

      if (onProgress) {
        onProgress({ index, total, fragmentCount: allFragments.length });
      }
    }

    return new FragmentedFlow(allFragments, contentStyles, allInputBreakTokens);
  }

  /**
   * Fragment an array of content root elements, merging shared pages.
   * @private
   */
  _fragmentElements(contentRoots) {
    const allFragments = [];
    const allInputBreakTokens = [];
    let continuation = { fragmentainerIndex: 0, blockOffset: 0 };

    for (const root of contentRoots) {
      const tree = buildLayoutTree(root);
      const result = createFragments(tree, this._resolver, continuation);

      // Merge first fragment with previous last fragment if sharing a page
      if (continuation.blockOffset > 0 && result.fragments.length > 0 && allFragments.length > 0) {
        const prev = allFragments.pop();
        allInputBreakTokens.pop();
        const merged = PhysicalFragment.merge(prev, result.fragments[0]);
        allFragments.push(merged);
        allInputBreakTokens.push(allInputBreakTokens.length > 0
          ? allInputBreakTokens[allInputBreakTokens.length - 1] : null);

        for (let i = 1; i < result.fragments.length; i++) {
          const inputBT = result.fragments[i - 1].breakToken;
          allInputBreakTokens.push(inputBT);
          allFragments.push(result.fragments[i]);
        }
      } else {
        for (let i = 0; i < result.fragments.length; i++) {
          const inputBT = i === 0
            ? (allFragments.length > 0 ? allFragments[allFragments.length - 1].breakToken : null)
            : result.fragments[i - 1].breakToken;
          allInputBreakTokens.push(inputBT);
          allFragments.push(result.fragments[i]);
        }
      }

      continuation = result.continuation;
    }

    return { fragments: allFragments, inputBreakTokens: allInputBreakTokens };
  }

  /** @private — get or create the measure group (batch: already measured) */
  _getOrCreateGroup() {
    if (this._group) return this._group;
    this._group = this._ensureGroup();

    // Batch: all measures already created by the caller via injectContent
    // The group's content roots should already be available
    return this._group;
  }

  /** @private */
  _ensureGroup() {
    if (this._group) return this._group;
    if (!this._measureContainer) {
      throw new Error("measureContainer option is required for DocumentFragment input");
    }
    const CMG = getContentMeasureGroupSync();
    this._group = new CMG(this._measureContainer);
    return this._group;
  }

  /**
   * Set up a pre-configured ContentMeasureGroup.
   * Call this before flow() when using DocumentFragment input in batch mode.
   *
   * @param {ContentMeasureGroup} group
   */
  setMeasureGroup(group) {
    this._group = group;
  }

  /**
   * Capture content styles from the shadow host if available.
   * When the content element lives inside a <content-measure> shadow root,
   * the host exposes getContentStyles() for CSS isolation during rendering.
   */
  _captureContentStyles(element) {
    const el = element || this._contentElement;
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
  /**
   * @param {import('./fragment.js').PhysicalFragment[]} fragments
   * @param {{ sheets: CSSStyleSheet[], cssText: string }|null} contentStyles
   * @param {(import('./tokens.js').BreakToken|null)[]} [inputBreakTokens] — per-fragment input break tokens
   *   When omitted, uses the default chain (prev fragment's breakToken).
   */
  constructor(fragments, contentStyles, inputBreakTokens = null) {
    this._fragments = fragments;
    this._contentStyles = contentStyles;
    this._inputBreakTokens = inputBreakTokens;
  }

  /** @returns {import('./fragment.js').PhysicalFragment[]} */
  get fragments() { return this._fragments; }

  /** @returns {number} */
  get fragmentainerCount() { return this._fragments.length; }

  /**
   * Render a single fragmentainer as a <fragment-container> element.
   *
   * @param {number} index - Zero-based fragmentainer index
   * @returns {Element} A <fragment-container> element
   */
  renderFragmentainer(index) {
    const fragment = this._fragments[index];
    const { contentArea } = fragment.constraints;
    const prevBreakToken = this._inputBreakTokens
      ? this._inputBreakTokens[index]
      : (index > 0 ? this._fragments[index - 1].breakToken : null);

    const el = document.createElement("fragment-container");
    el.style.width = `${contentArea.inlineSize}px`;
    el.style.height = `${contentArea.blockSize}px`;
    el.style.overflow = "hidden";
    const wrapper = el.setupForRendering(this._contentStyles);
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
    for (let i = 0; i < this._fragments.length; i++) {
      elements.push(this.renderFragmentainer(i));
    }
    return elements;
  }
}
