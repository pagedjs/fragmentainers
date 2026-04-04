import { LayoutModule } from "./module.js";
import { modules } from "./registry.js";

/** Attributes managed by the compositor — never sync back to source. */
const COMPOSITOR_ATTRS = new Set([
  "data-ref",
  "data-split-from",
  "data-split-to",
  "data-justify-last",
]);

/**
 * Layout module that syncs mutations from composed <fragment-container>
 * clones back to the source DOM.
 *
 * Uses the shared clone→source map on the module registry (populated
 * by mapFragment after composition) to resolve clone elements.
 *
 *   const sync = new MutationSync();
 *   FragmentainerLayout.register(sync);
 *   const flow = await layout.flow();
 *
 *   flow[0].startObserving();
 *   flow[0].addEventListener("fragment-change", () => {
 *     const records = flow[0].takeMutationRecords();
 *     sync.applyMutations(records);
 *   });
 */
export class MutationSync extends LayoutModule {
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

  #syncAttribute(mutation) {
    const { attributeName, target } = mutation;
    if (COMPOSITOR_ATTRS.has(attributeName)) return false;

    const source = modules.getSource(target);
    if (!source) return false;

    const newValue = target.getAttribute(attributeName);
    if (newValue === null) {
      source.removeAttribute(attributeName);
    } else {
      source.setAttribute(attributeName, newValue);
    }
    return true;
  }

  #syncRemovals(mutation) {
    let changed = false;
    for (const node of mutation.removedNodes) {
      if (node.nodeType !== 1) continue;
      const source = modules.getSource(node);
      if (!source) continue;
      source.remove();
      changed = true;
    }
    return changed;
  }

  #syncAdditions(mutation) {
    let changed = false;
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (modules.getSource(node)) continue;

      const insertionPoint = this.#findInsertionPoint(node, mutation.target);
      if (!insertionPoint) continue;

      const sourceClone = node.cloneNode(true);
      const { parent, before } = insertionPoint;
      if (before) {
        parent.insertBefore(sourceClone, before);
      } else {
        parent.appendChild(sourceClone);
      }

      // Register the new clone→source pairs in the shared map
      modules.trackClone(node, sourceClone);
      const composedDescs = node.querySelectorAll("*");
      const sourceDescs = sourceClone.querySelectorAll("*");
      for (let i = 0; i < composedDescs.length && i < sourceDescs.length; i++) {
        modules.trackClone(composedDescs[i], sourceDescs[i]);
      }

      changed = true;
    }
    return changed;
  }

  #findInsertionPoint(node, parent) {
    let prev = node.previousElementSibling;
    while (prev && !modules.getSource(prev)) {
      prev = prev.previousElementSibling;
    }
    if (prev) {
      const sourceRef = modules.getSource(prev);
      if (sourceRef) {
        return { parent: sourceRef.parentElement, before: sourceRef.nextElementSibling };
      }
    }

    let next = node.nextElementSibling;
    while (next && !modules.getSource(next)) {
      next = next.nextElementSibling;
    }
    if (next) {
      const sourceRef = modules.getSource(next);
      if (sourceRef) {
        return { parent: sourceRef.parentElement, before: sourceRef };
      }
    }

    const parentSource = modules.getSource(parent);
    if (parentSource) {
      return { parent: parentSource, before: null };
    }

    return null;
  }
}
