/**
 * Sync mutations from rendered <fragment-container> clones back to
 * the source DOM in <content-measure>.
 *
 * Uses data-ref attributes (assigned during injection) to map cloned
 * elements back to their source. Handles attribute changes and
 * block-level structural mutations (add/remove elements).
 */

/** Attributes managed by the compositor — never sync back to source. */
const COMPOSITOR_ATTRS = new Set([
  "data-ref",
  "data-split-from",
  "data-split-to",
  "data-justify-last",
]);

export class MutationSync {
  #refMap;
  #assignRef;
  #removeRef;

  /**
   * @param {Map<string, Element>} refMap — from ContentMeasureElement.refMap
   * @param {Element} sourceRoot — from ContentMeasureElement.contentRoot
   * @param {function} assignRef — ContentMeasureElement.assignRef bound method
   * @param {function} removeRef — ContentMeasureElement.removeRef bound method
   */
  constructor(refMap, _sourceRoot, assignRef, removeRef) {
    this.#refMap = refMap;
    this.#assignRef = assignRef;
    this.#removeRef = removeRef;
  }

  /**
   * Process an array of MutationRecords from a fragment-container.
   * Applies each mutation back to the source DOM.
   *
   * @param {MutationRecord[]} mutations
   * @returns {{ changed: boolean, structural: boolean }}
   */
  applyMutations(mutations) {
    let changed = false;
    let structural = false;
    for (const m of mutations) {
      if (m.type === "attributes") {
        if (this.#syncAttribute(m)) changed = true;
      } else if (m.type === "childList") {
        if (m.removedNodes.length > 0) {
          if (this.#syncRemovals(m)) {
            changed = true;
            structural = true;
          }
        }
        if (m.addedNodes.length > 0) {
          if (this.#syncAdditions(m)) {
            changed = true;
            structural = true;
          }
        }
      }
    }
    return { changed, structural };
  }

  /**
   * Sync an attribute change from a clone to its source element.
   * @returns {boolean} true if the source was modified
   */
  #syncAttribute(mutation) {
    const { attributeName, target } = mutation;
    if (COMPOSITOR_ATTRS.has(attributeName)) return false;

    const ref = target.getAttribute("data-ref");
    if (!ref) return false;

    const source = this.#refMap.get(ref);
    if (!source) return false;

    const newValue = target.getAttribute(attributeName);
    if (newValue === null) {
      source.removeAttribute(attributeName);
    } else {
      source.setAttribute(attributeName, newValue);
    }
    return true;
  }

  /**
   * Sync element removals from a clone's childList mutation.
   * @returns {boolean} true if any source elements were removed
   */
  #syncRemovals(mutation) {
    let changed = false;
    for (const node of mutation.removedNodes) {
      if (node.nodeType !== 1) continue; // skip text nodes
      const ref = node.getAttribute("data-ref");
      if (!ref) continue;

      const source = this.#refMap.get(ref);
      if (!source) continue;

      source.remove();
      this.#removeRef(ref);
      // Clean up refs for all descendants
      for (const desc of node.querySelectorAll("[data-ref]")) {
        this.#removeRef(desc.getAttribute("data-ref"));
      }
      changed = true;
    }
    return changed;
  }

  /**
   * Sync element additions from a clone's childList mutation.
   * New elements (without data-ref) are positioned in the source
   * relative to sibling elements that have data-ref.
   * @returns {boolean} true if any elements were added to source
   */
  #syncAdditions(mutation) {
    let changed = false;
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1) continue; // skip text nodes
      if (node.hasAttribute("data-ref")) continue; // already tracked

      // Find insertion position via siblings
      const insertionPoint = this.#findInsertionPoint(node, mutation.target);
      if (!insertionPoint) continue;

      // Deep clone into source
      const sourceClone = node.cloneNode(true);
      const { parent, before } = insertionPoint;
      if (before) {
        parent.insertBefore(sourceClone, before);
      } else {
        parent.appendChild(sourceClone);
      }

      // Assign refs to the source clone and all its descendants
      const ref = this.#assignRef(sourceClone);
      for (const desc of sourceClone.querySelectorAll("*")) {
        this.#assignRef(desc);
      }

      // Set data-ref on the rendered clone so future mutations can be tracked
      node.setAttribute("data-ref", ref);

      changed = true;
    }
    return changed;
  }

  /**
   * Find where a new element should be inserted in the source DOM,
   * based on its position relative to ref'd siblings in the clone.
   *
   * @param {Element} node — the newly added element (in the clone)
   * @param {Element} parent — the parent element in the clone
   * @returns {{ parent: Element, before: Element|null }|null}
   */
  #findInsertionPoint(node, parent) {
    // Try previous sibling with a ref
    let prev = node.previousElementSibling;
    while (prev && !prev.hasAttribute("data-ref")) {
      prev = prev.previousElementSibling;
    }
    if (prev) {
      const sourceRef = this.#refMap.get(prev.getAttribute("data-ref"));
      if (sourceRef) {
        return { parent: sourceRef.parentElement, before: sourceRef.nextElementSibling };
      }
    }

    // Try next sibling with a ref
    let next = node.nextElementSibling;
    while (next && !next.hasAttribute("data-ref")) {
      next = next.nextElementSibling;
    }
    if (next) {
      const sourceRef = this.#refMap.get(next.getAttribute("data-ref"));
      if (sourceRef) {
        return { parent: sourceRef.parentElement, before: sourceRef };
      }
    }

    // Fall back to parent's ref
    const parentRef = parent.getAttribute("data-ref");
    if (parentRef) {
      const sourceParent = this.#refMap.get(parentRef);
      if (sourceParent) {
        return { parent: sourceParent, before: null };
      }
    }

    return null;
  }
}
