/**
 * Per-flow map from composed clone elements back to their source
 * elements. Populated during Fragment composition; read by handlers
 * that need to resolve output DOM to input DOM (e.g. MutationSync).
 */
export class CloneMap {
	#map = new WeakMap();

	track(clone, source) {
		this.#map.set(clone, source);
	}

	/**
	 * Register a deep clone and all its descendants, pairing children
	 * positionally with the source's children.
	 */
	trackDeep(clone, source) {
		this.track(clone, source);
		const sourceChildren = source.children;
		const cloneChildren = clone.children;
		for (let i = 0; i < sourceChildren.length && i < cloneChildren.length; i++) {
			this.trackDeep(cloneChildren[i], sourceChildren[i]);
		}
	}

	get(clone) {
		return this.#map.get(clone);
	}

	clear() {
		this.#map = new WeakMap();
	}
}
