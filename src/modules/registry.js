import { LayoutModule } from "./module.js";

class ModuleRegistry {
	#modules = [];
	#cloneMap = new WeakMap();

	register(module) {
		if (!(module instanceof LayoutModule)) {
			throw new TypeError("Module must extend the LayoutModule base class");
		}
		if (!this.#modules.includes(module)) {
			this.#modules.push(module);
		}
	}

	remove(module) {
		const idx = this.#modules.indexOf(module);
		if (idx !== -1) {
			this.#modules.splice(idx, 1);
		}
	}

	matches(node) {
		return this.#modules.some((m) => m.matches(node));
	}

	layout(rootNode, constraintSpace, breakToken, layoutChild) {
		let reservedBlockStart = 0;
		let reservedBlockEnd = 0;
		const afterRenderCallbacks = [];
		for (const mod of this.#modules) {
			const result = mod.layout(rootNode, constraintSpace, breakToken, layoutChild);
			reservedBlockStart += result.reservedBlockStart;
			reservedBlockEnd += result.reservedBlockEnd;
			if (result.afterRender) {
				afterRenderCallbacks.push(result.afterRender);
			}
		}
		return { reservedBlockStart, reservedBlockEnd, afterRenderCallbacks };
	}

	beforeChildren(node, constraintSpace, breakToken) {
		for (const mod of this.#modules) {
			const result = mod.beforeChildren(node, constraintSpace, breakToken);
			if (result) return result;
		}
		return null;
	}

	/**
	 * Collect elements that modules want persisted across all measurement
	 * segments. Called once before segmentation with the full content.
	 *
	 * @param {DocumentFragment|Element} content — the full content root
	 * @param {CSSStyleSheet[]} styles — adopted stylesheets
	 * @returns {Element[]} elements to include in every segment's measurer
	 */
	claimPersistent(content, styles) {
		const elements = [];
		for (const mod of this.#modules) {
			const claimed = mod.claimPersistent(content, styles);
			if (claimed.length > 0) elements.push(...claimed);
		}
		return elements;
	}

	/**
	 * Called after content layout for a fragmentainer. Aggregates
	 * reservedBlockEnd and afterRender callbacks across all modules.
	 *
	 * @param {import('../core/fragment.js').PhysicalFragment} fragment
	 * @param {import('../core/constraint-space.js').ConstraintSpace} constraintSpace
	 * @param {import('../core/tokens.js').BreakToken|null} inputBreakToken
	 * @returns {{ reservedBlockEnd: number, afterRenderCallbacks: Function[] }|null}
	 */
	trackClone(clone, source) {
		this.#cloneMap.set(clone, source);
	}

	getSource(clone) {
		return this.#cloneMap.get(clone);
	}

	afterContentLayout(fragment, constraintSpace, inputBreakToken) {
		let reservedBlockEnd = 0;
		const afterRenderCallbacks = [];
		let hasResult = false;
		for (const mod of this.#modules) {
			const result = mod.afterContentLayout(fragment, constraintSpace, inputBreakToken);
			if (result) {
				hasResult = true;
				reservedBlockEnd += result.reservedBlockEnd;
				if (result.afterRender) {
					afterRenderCallbacks.push(result.afterRender);
				}
			}
		}
		return hasResult ? { reservedBlockEnd, afterRenderCallbacks } : null;
	}
}

export const modules = new ModuleRegistry();
