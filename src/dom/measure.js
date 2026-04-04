import { computedStyleMap } from "./computed-style-map.js";
import { DOMLayoutNode } from "./layout-node.js";
import { isForcedBreakValue } from "../core/helpers.js";
import { modules } from "../modules/registry.js";
import "../dom/content-measure.js";

/**
 * Create a text measurer backed by the DOM Range API.
 *
 * Uses getClientRects() on the live DOM text to read the browser's
 * actual line layout, avoiding re-implementation of line breaking.
 */
export function createRangeMeasurer() {
  const range = document.createRange();

  return {
    /**
     * Measure the width of a substring within a text node.
     */
    measureRange(textNode, startOffset, endOffset) {
      range.setStart(textNode, startOffset);
      range.setEnd(textNode, endOffset);
      return range.getBoundingClientRect().width;
    },

    /**
     * Get the top position of a character at a given offset in a text node.
     * Returns the vertical position from getBoundingClientRect().
     */
    charTop(textNode, offset) {
      const safeEnd = Math.min(offset + 1, textNode.textContent.length);
      if (offset >= safeEnd) return Infinity;
      range.setStart(textNode, offset);
      range.setEnd(textNode, safeEnd);
      const rects = range.getClientRects();
      return rects.length > 0 ? rects[0].top : Infinity;
    },
  };
}

/**
 * Measure the rendered block size (height) of a DOM element.
 */
export function measureElementBlockSize(element) {
  return element.getBoundingClientRect().height;
}

/**
 * Count the number of rendered line boxes in an element using getClientRects().
 *
 * Creates a Range spanning the element's contents and counts distinct
 * vertical positions in the returned rects (one rect per line box).
 *
 * @param {Element} element
 * @returns {number}
 */
export function countLines(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const rects = range.getClientRects();
  if (rects.length === 0) return 0;

  let count = 1;
  let prevTop = rects[0].top;
  for (let i = 1; i < rects.length; i++) {
    if (rects[i].top > prevTop + 0.5) {
      count++;
      prevTop = rects[i].top;
    }
  }
  return count;
}

/**
 * Get the computed line height of an element in pixels.
 */
export function getLineHeight(element) {
  const map = computedStyleMap(element);
  const lh = map.get("line-height");

  // "normal" returns a keyword (no .unit property)
  if (!lh || !lh.unit) {
    const fs = map.get("font-size");
    return ((fs && fs.unit) ? fs.value : 16) * 1.2;
  }

  return lh.value;
}

/**
 * Parse a CSS length value to pixels.
 */
export function parseLength(value, parentSize, fontSize) {
  if (!value || value === "auto" || value === "none") return null;
  if (value.endsWith("px")) return parseFloat(value);
  if (value.endsWith("%")) return (parseFloat(value) / 100) * parentSize;
  if (value.endsWith("rem")) {
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return parseFloat(value) * rootFontSize;
  }
  if (value.endsWith("em")) return parseFloat(value) * fontSize;
  return parseFloat(value) || null;
}

/**
 * Resolve break-before, break-after, and page values for top-level
 * elements by walking CSSStyleSheet rules and matching selectors.
 * Works on elements in a DocumentFragment (no live DOM needed).
 *
 * @param {Element[]} elements — top-level child elements
 * @param {CSSStyleSheet[]} styles — adopted stylesheets
 * @returns {{ breakBefore: string, breakAfter: string, page: string|null }[]}
 */
function resolveBreakProperties(elements, styles) {
  const breakRules = [];
  for (const sheet of styles) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (!rule.style) continue;
      const bb = rule.style.getPropertyValue("break-before").trim();
      const ba = rule.style.getPropertyValue("break-after").trim();
      const pg = rule.style.getPropertyValue("page").trim();
      if (bb || ba || pg) {
        breakRules.push({ selector: rule.selectorText, breakBefore: bb, breakAfter: ba, page: pg });
      }
    }
  }

  return elements.map((el) => {
    let breakBefore = el.style.breakBefore || "auto";
    let breakAfter = el.style.breakAfter || "auto";
    let page = el.style.page || null;
    for (const rule of breakRules) {
      try {
        if (!el.matches(rule.selector)) continue;
      } catch {
        continue;
      }
      if (rule.breakBefore) breakBefore = rule.breakBefore;
      if (rule.breakAfter) breakAfter = rule.breakAfter;
      if (rule.page && rule.page !== "auto") page = rule.page;
    }
    if (page === "auto") page = null;
    return { breakBefore, breakAfter, page };
  });
}

/**
 * Find segment boundaries among top-level children.
 * A segment boundary starts at index i (i > 0) when:
 * - child[i] has forced break-before
 * - child[i-1] has forced break-after
 * - child[i].page !== child[i-1].page (named page change)
 *
 * @param {{ breakBefore: string, breakAfter: string, page: string|null }[]} props
 * @returns {number[]} — start indices of each segment (always starts with 0)
 */
function findSegmentBoundaries(props) {
  const boundaries = [0];
  for (let i = 1; i < props.length; i++) {
    if (
      isForcedBreakValue(props[i].breakBefore) ||
      isForcedBreakValue(props[i - 1].breakAfter) ||
      props[i].page !== props[i - 1].page
    ) {
      boundaries.push(i);
    }
  }
  return boundaries;
}

const SKIP_TAGS = new Set(["script", "style", "template"]);
const SKIP_DISPLAYS = new Set(["table-column", "table-column-group", "none"]);

/**
 * Measurer — owns the <content-measure> lifecycle for layout.
 *
 * Handles creating, populating, and destroying measurement containers.
 * When top-level children have forced breaks, splits measurement into
 * segments so the browser only lays out one segment at a time.
 */
export class Measurer {
  #content;
  #styles;

  #measureElement = null;
  #contentStyles = null;
  #segments = null;
  #currentSegment = 0;
  #allElements = null;
  #nodeMap = new Map();
  #allNodes = null;
  #flowElements = null;
  #breakProps = null;
  #persistent = [];
  #finished = null;
  #pending = null;

  /**
   * @param {DocumentFragment} content
   * @param {CSSStyleSheet[]} styles
   */
  constructor(content, styles) {
    this.#content = content;
    this.#styles = styles;
  }

  /**
   * Initialize measurement. Creates the <content-measure> and prepares
   * the content for layout. If multiple segments are detected, only the
   * first segment's content is measured.
   *
   * @returns {Promise<Element>} the content root (slot element)
   */
  async setup() {
    // Let modules claim elements that persist across all segments
    this.#persistent = modules.claimPersistent(this.#content, this.#styles);
    const persistentSet = new Set(this.#persistent);

    // Resolve break properties only for non-persistent elements
    const elements = Array.from(this.#content.children);
    this.#allElements = elements;
    const flowElements = elements.filter((el) => !persistentSet.has(el));
    this.#breakProps = resolveBreakProperties(flowElements, this.#styles);
    const boundaries = findSegmentBoundaries(this.#breakProps);

    if (boundaries.length <= 1) {
      return this.#setupSingle();
    }
    return this.#setupSegmented(boundaries, flowElements);
  }

  async #setupSingle() {
    const measurer = this.#createMeasurer();
    measurer.injectFragment(this.#content, this.#styles);
    document.body.appendChild(measurer);
    void measurer.offsetHeight;
    if (document.fonts?.ready) await document.fonts.ready;
    await this.#waitForImages(measurer.contentRoot);
    this.#measureElement = measurer;
    this.#contentStyles = measurer.getContentStyles();
    return measurer.contentRoot;
  }

  async #setupSegmented(boundaries, flowElements) {
    this.#segments = [];
    for (let i = 0; i < boundaries.length; i++) {
      const start = boundaries[i];
      const end = i + 1 < boundaries.length ? boundaries[i + 1] : flowElements.length;
      this.#segments.push({ start, end });
    }

    this.#finished = document.createDocumentFragment();
    this.#pending = document.createDocumentFragment();

    // Build DOMLayoutNode wrappers for all top-level children
    // (both flow and persistent)
    this.#allNodes = [];
    for (const el of this.#allElements) {
      const node = new DOMLayoutNode(el);
      this.#nodeMap.set(el, node);
      this.#allNodes.push(node);
    }

    // #segments indices are into flowElements, not #allElements.
    // Store the flow elements list for segment operations.
    this.#flowElements = flowElements;

    // Set override break/page on all boundary children (lookahead nodes)
    for (let i = 1; i < this.#segments.length; i++) {
      const boundaryIdx = this.#segments[i].start;
      const el = flowElements[boundaryIdx];
      const node = this.#nodeMap.get(el);
      node.breakBefore = this.#breakProps[boundaryIdx].breakBefore;
      node.page = this.#breakProps[boundaryIdx].page;
    }

    // Move non-first-segment flow elements to pending
    const firstEnd = this.#segments[0].end;
    for (let i = flowElements.length - 1; i >= firstEnd; i--) {
      this.#pending.insertBefore(flowElements[i], this.#pending.firstChild);
    }

    // Create measurer with first segment's content (remaining flow
    // elements + persistent elements stay in #content)
    const measurer = this.#createMeasurer();
    measurer.injectFragment(this.#content, this.#styles);

    document.body.appendChild(measurer);
    void measurer.offsetHeight;
    if (document.fonts?.ready) await document.fonts.ready;
    await this.#waitForImages(measurer.contentRoot);

    this.#measureElement = measurer;
    this.#contentStyles = measurer.getContentStyles();
    this.#currentSegment = 0;

    return measurer.contentRoot;
  }

  /**
   * Called after each next() call. If segmented, checks whether the
   * break token indicates we've reached the segment boundary and
   * swaps to the next segment's measurer.
   *
   * @param {import('../core/tokens.js').BlockBreakToken|null} breakToken
   * @param {DOMLayoutNode} tree — root layout node
   * @returns {Promise<void>}
   */
  async advance(breakToken, tree) {
    if (!this.#segments || this.#currentSegment >= this.#segments.length - 1) return;
    if (!this.#isAtBoundary(breakToken)) return;

    this.#currentSegment++;
    const seg = this.#segments[this.#currentSegment];

    // Move completed flow elements from the current measurer to finished.
    // Persistent elements stay — they'll be moved to the new measurer.
    const slot = this.#measureElement.contentRoot;
    const persistentSet = new Set(this.#persistent);
    const toKeep = [];
    while (slot.firstChild) {
      if (persistentSet.has(slot.firstChild)) {
        toKeep.push(slot.firstChild);
        slot.removeChild(slot.firstChild);
      } else {
        this.#finished.appendChild(slot.firstChild);
      }
    }

    // Remove old measurer
    this.#measureElement.remove();

    // Create new measurer with next segment's flow elements + persistent
    const frag = document.createDocumentFragment();
    for (const el of toKeep) {
      frag.appendChild(el);
    }
    for (let i = seg.start; i < seg.end; i++) {
      frag.appendChild(this.#flowElements[i]);
    }

    const measurer = this.#createMeasurer();
    const newSlot = measurer.setupEmpty(this.#styles);
    newSlot.appendChild(frag);

    document.body.appendChild(measurer);
    void measurer.offsetHeight;
    if (document.fonts?.ready) await document.fonts.ready;
    await this.#waitForImages(newSlot);

    this.#measureElement = measurer;

    // Rebuild root's children from the nodeMap
    tree.setChildren(this.#buildSegmentChildren(this.#currentSegment));
  }

  /**
   * Build the DOMLayoutNode children array for a segment.
   * Includes persistent elements, the segment's flow children, and a
   * lookahead boundary child from the next segment (if any).
   */
  #buildSegmentChildren(segIndex) {
    const seg = this.#segments[segIndex];
    const children = [];
    const slot = this.#measureElement.contentRoot;
    const persistentSet = new Set(this.#persistent);

    // Build children from the slot's current DOM order — this includes
    // persistent elements and the segment's flow elements.
    for (const el of slot.children) {
      const tag = el.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      const display = getComputedStyle(el).display;
      if (display === "none" || SKIP_DISPLAYS.has(display)) continue;
      let node = this.#nodeMap.get(el);
      if (!node) {
        node = new DOMLayoutNode(el);
        this.#nodeMap.set(el, node);
      }
      children.push(node);
    }

    // Add lookahead boundary child from next segment (if exists).
    // This node is NOT in the DOM — its breakBefore/page are overrides.
    if (segIndex + 1 < this.#segments.length) {
      const nextStart = this.#segments[segIndex + 1].start;
      const boundaryEl = this.#flowElements[nextStart];
      const boundaryNode = this.#nodeMap.get(boundaryEl);
      children.push(boundaryNode);
    }

    return children;
  }

  /**
   * Get the initial children array for the root node after setup.
   * Only meaningful when segmented.
   * @returns {DOMLayoutNode[]|null}
   */
  get initialChildren() {
    if (!this.#segments) return null;
    return this.#buildSegmentChildren(0);
  }

  /**
   * Check if a break token indicates we've reached the current
   * segment's boundary (forced break at the lookahead child).
   */
  #isAtBoundary(breakToken) {
    if (!breakToken) return false;
    const childTokens = breakToken.childBreakTokens;
    if (!childTokens || childTokens.length === 0) return false;
    const lastChild = childTokens[childTokens.length - 1];
    if (!lastChild.isBreakBefore) return false;
    const nextSegStart = this.#segments[this.#currentSegment + 1]?.start;
    if (nextSegStart === undefined) return false;
    const boundaryEl = this.#flowElements[nextSegStart];
    return lastChild.node === this.#nodeMap.get(boundaryEl);
  }

  /**
   * Release measurement, returning all content as a DocumentFragment.
   * Removes the measurer from the DOM.
   *
   * @returns {{ content: DocumentFragment }}
   */
  release() {
    if (!this.#measureElement) return { content: this.#content };

    const frag = document.createDocumentFragment();

    if (this.#segments) {
      if (this.#finished.childNodes.length > 0) {
        frag.appendChild(this.#finished);
      }
      const slot = this.#measureElement.contentRoot;
      while (slot.firstChild) {
        frag.appendChild(slot.firstChild);
      }
      if (this.#pending.childNodes.length > 0) {
        frag.appendChild(this.#pending);
      }
    } else {
      const slot = this.#measureElement.contentRoot;
      while (slot.firstChild) {
        frag.appendChild(slot.firstChild);
      }
    }

    this.#measureElement.remove();
    this.#measureElement = null;

    return { content: frag };
  }

  /** Sync the measurement container's inline size with the constraint space. */
  applyConstraintSpace(constraintSpace) {
    this.#measureElement?.applyConstraintSpace(constraintSpace);
  }

  /** The current measurement container's content root (slot element). */
  get contentRoot() {
    return this.#measureElement?.contentRoot ?? null;
  }

  /** Content styles for rendering. */
  getContentStyles() {
    return this.#contentStyles;
  }

  /** Whether segmented mode is active. */
  get isSegmented() {
    return this.#segments !== null && this.#segments.length > 1;
  }

  /** Whether a measurement element is currently live. */
  get isActive() {
    return this.#measureElement !== null;
  }

  #createMeasurer() {
    return document.createElement("content-measure");
  }

  #waitForImages(root) {
    if (!root) return Promise.resolve();
    const pending = [];
    for (const img of root.querySelectorAll("img:not([loading=lazy])")) {
      if (!img.complete) {
        pending.push(
          new Promise((r) => {
            img.addEventListener("load", r, { once: true });
            img.addEventListener("error", r, { once: true });
          }),
        );
      }
    }
    return pending.length > 0 ? Promise.all(pending) : Promise.resolve();
  }
}
