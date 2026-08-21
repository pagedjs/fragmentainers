import { LayoutHandler } from "./handler.js";

/** Attributes managed by the compositor — never sync back to source. */
const COMPOSITOR_ATTRS = new Set([
	"data-ref",
	"data-split-from",
	"data-split-to",
	"data-justify-last",
	"data-align-last-split-element",
]);

/**
 * Layout handler that syncs mutations from composed <fragment-container>
 * clones back to the source DOM.
 *
 * Uses the flow's clone→source map (populated during composition) to
 * resolve clone elements.
 *
 *   Fragmenter.handlers.push(MutationSync);
 *   const layout = new Fragmenter(content, options);
 *   const pages = [...layout];
 *   const sync = layout.handlers.get(MutationSync);
 *
 *   pages[0].startObserving();
 *   pages[0].addEventListener("fragment-change", () => {
 *     const records = pages[0].takeMutationRecords();
 *     sync.applyMutations(records);
 *   });
 */
export class MutationSync extends LayoutHandler {
	#cloneMap = null;

	init(options, context) {
		this.#cloneMap = context.cloneMap;
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

	#syncAttribute(mutation) {
		const { attributeName, target } = mutation;
		if (COMPOSITOR_ATTRS.has(attributeName)) return false;

		const source = this.#cloneMap.get(target);
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
			const source = this.#cloneMap.get(node);
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
			if (this.#cloneMap.get(node)) continue;

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
			this.#cloneMap.track(node, sourceClone);
			const composedDescs = node.querySelectorAll("*");
			const sourceDescs = sourceClone.querySelectorAll("*");
			for (let i = 0; i < composedDescs.length && i < sourceDescs.length; i++) {
				this.#cloneMap.track(composedDescs[i], sourceDescs[i]);
			}

			changed = true;
		}
		return changed;
	}

	#findInsertionPoint(node, parent) {
		let prev = node.previousElementSibling;
		while (prev && !this.#cloneMap.get(prev)) {
			prev = prev.previousElementSibling;
		}
		if (prev) {
			const sourceRef = this.#cloneMap.get(prev);
			if (sourceRef) {
				return { parent: sourceRef.parentElement, before: sourceRef.nextElementSibling };
			}
		}

		let next = node.nextElementSibling;
		while (next && !this.#cloneMap.get(next)) {
			next = next.nextElementSibling;
		}
		if (next) {
			const sourceRef = this.#cloneMap.get(next);
			if (sourceRef) {
				return { parent: sourceRef.parentElement, before: sourceRef };
			}
		}

		const parentSource = this.#cloneMap.get(parent);
		if (parentSource) {
			return { parent: parentSource, before: null };
		}

		return null;
	}
}
