export class LayoutModule {
	claim() {
		return false;
	}

	/**
	 * Reset state accumulated from a previous matchRule pass.
	 * Called by processRules() before the walk begins.
	 */
	resetRules() {}

	/**
	 * Called once per leaf CSSStyleRule during the centralized rule walk.
	 * Modules override this to inspect CSS rules and accumulate state
	 * (e.g. selectors for elements they need to claim).
	 *
	 * @param {CSSStyleRule} rule — a style rule with .selectorText and .style
	 * @param {{ wrappers: string[] }} context — grouping rule preambles (e.g. ["@media screen"])
	 */
	matchRule() {}

	/**
	 * Push CSS rule strings to be inserted into a shared stylesheet.
	 * Called once after the rule walk completes. The registry calls
	 * sheet.insertRule() for each string in the array.
	 *
	 * @param {string[]} rules — push CSS rule text strings to this array
	 */
	insertRules() {}

	layout() {
		return { reservedBlockStart: 0, reservedBlockEnd: 0, afterRender: null };
	}

	beforeChildren() {
		return null;
	}

	/**
	 * Called before measurement begins, with the full content fragment.
	 * Modules can claim elements that should persist across all measurement
	 * segments (e.g., position: fixed elements that repeat on every page).
	 *
	 * @param {DocumentFragment|Element} content — the full content root
	 * @returns {Element[]} elements to include in every measurement segment
	 */
	claimPersistent() {
		return [];
	}

	/**
	 * Called after content layout completes for a fragmentainer.
	 * Modules can inspect the resulting fragment and request additional
	 * block-end space (e.g., for footnotes). Returning a different
	 * reservedBlockEnd than what was used triggers a re-layout.
	 *
	 * @param {import('../core/fragment.js').PhysicalFragment} fragment
	 * @param {import('../core/constraint-space.js').ConstraintSpace} constraintSpace
	 * @param {import('../core/tokens.js').BreakToken|null} inputBreakToken
	 * @returns {{ reservedBlockEnd: number, afterRender: Function|null }|null}
	 */
	afterContentLayout() {
		return null;
	}
}
