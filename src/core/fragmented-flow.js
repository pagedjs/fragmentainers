import { composeFragment } from "../compositor/compositor.js";
import { buildPerFragmentNthSheet } from "../styles/nth-selectors.js";
import { DEFAULT_OVERFLOW_THRESHOLD } from "./constants.js";

/**
 * The result of running fragmentation — a "fragmented flow" in CSS spec terms.
 *
 * Extends Array so it is directly iterable as the array of
 * <fragment-container> elements. Also exposes the underlying
 * PhysicalFragment data via .fragments.
 */
export class FragmentedFlow extends Array {
  #fragments;
  #contentStyles;

  static get [Symbol.species]() { return Array; }

  /**
   * @param {import("./fragment.js").PhysicalFragment[]} fragments
   * @param {{ sheets: CSSStyleSheet[], nthDescriptors: NthDescriptor[],
   *           sourceRefs: WeakMap, refMap: Map }|null} contentStyles
   * @param {{ start?: number, stop?: number }} [range]
   */
  constructor(fragments, contentStyles, { start = 0, stop } = {}) {
    super();
    this.#fragments = fragments;
    this.#contentStyles = contentStyles;
    if (contentStyles) {
      const end = stop ?? fragments.length;
      for (let i = start; i < end; i++) {
        this.push(this.createFragmentainer(i));
      }
    }
  }

  /** @returns {import("./fragment.js").PhysicalFragment[]} */
  get fragments() {
    return this.#fragments;
  }

  /** @returns {number} */
  get fragmentainerCount() {
    return this.#fragments.length;
  }

  /**
   * Create a single <fragment-container> element for the given index.
   *
   * @param {number} index - Zero-based fragmentainer index
   * @returns {Element} A <fragment-container> element
   */
  createFragmentainer(index) {
    const fragment = this.#fragments[index];
    const { contentArea } = fragment.constraints;

    const el = document.createElement("fragment-container");
    el.fragmentIndex = index;
    el.pageConstraints = fragment.constraints;
    el.namedPage = fragment.constraints?.namedPage ?? null;
    el.style.width = `${contentArea.inlineSize}px`;
    el.style.height = `${contentArea.blockSize}px`;
    el.style.overflow = "hidden";

    if (fragment.isBlank) {
      const counterSnapshot =
        index > 0 ? this.#fragments[index - 1].counterState : null;
      el.setupForRendering(this.#contentStyles, counterSnapshot);
      el.setAttribute("data-blank-page", "");
      el.expectedBlockSize = contentArea.blockSize;
      el.overflowThreshold = 0;
      return el;
    }

    const prevBreakToken =
      index > 0 ? this.#fragments[index - 1].breakToken : null;
    const counterSnapshot =
      index > 0 ? this.#fragments[index - 1].counterState : null;
    const wrapper = el.setupForRendering(this.#contentStyles, counterSnapshot);
    wrapper.appendChild(
      composeFragment(
        fragment,
        prevBreakToken,
        null,
        this.#contentStyles?.sourceRefs,
      ),
    );

    if (fragment.afterRender) {
      for (const callback of fragment.afterRender) {
        callback(wrapper, this.#contentStyles);
      }
    }

    // Build and adopt a per-fragment nth-selector override stylesheet
    const nthDescriptors = this.#contentStyles?.nthDescriptors;
    const refMap = this.#contentStyles?.refMap;
    if (nthDescriptors?.length > 0 && refMap) {
      const nthSheet = buildPerFragmentNthSheet(wrapper, nthDescriptors, refMap);
      if (nthSheet) el.adoptNthSheet(nthSheet);
    }

    el.expectedBlockSize = contentArea.blockSize;
    el.overflowThreshold =
      fragment.node?.lineHeight || DEFAULT_OVERFLOW_THRESHOLD;
    return el;
  }
}
