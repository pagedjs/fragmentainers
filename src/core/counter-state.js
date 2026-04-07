import { findChildBreakToken } from "./helpers.js";

/**
 * Parse a CSS counter directive string (from getComputedStyle) into
 * an array of { name, value } entries.
 *
 * Handles formats like:
 *   "none"                    → []
 *   "paragraph 0"             → [{ name: "paragraph", value: 0 }]
 *   "paragraph 0 section 0"  → [{ name: "paragraph", value: 0 }, { name: "section", value: 0 }]
 *
 * Filters out the implicit "list-item" counter (handled by <ol start>).
 *
 * @param {string|null} value - CSS computed value
 * @returns {{ name: string, value: number }[]}
 */
export function parseCounterDirective(value) {
	if (!value || value === "none") return [];

	const tokens = value.split(/\s+/);
	const entries = [];

	for (let i = 0; i < tokens.length; i++) {
		const name = tokens[i];
		const next = parseInt(tokens[i + 1], 10);
		if (!isNaN(next)) {
			i++;
			if (name !== "list-item") entries.push({ name, value: next });
		} else {
			if (name !== "list-item") entries.push({ name, value: 0 });
		}
	}

	return entries;
}

/**
 * Flat counter state accumulator.
 *
 * Tracks counter values as a Map<string, number>. Designed to accumulate
 * across multiple fragmentainers in the createFragments driver loop.
 *
 * For the MVP, this uses a flat map (no nested scoping). This handles
 * the common case of sequential counter-increment across pages. Nested
 * same-name counter scopes can be added later by upgrading to a scope stack.
 */
export class CounterState {
	/** @type {Map<string, number>} */
	#counters = new Map();

	constructor() {}

	/**
	 * Apply counter-reset directives. Sets each counter to its specified value.
	 * @param {{ name: string, value: number }[]} entries
	 */
	applyReset(entries) {
		for (const { name, value } of entries) {
			this.#counters.set(name, value);
		}
	}

	/**
	 * Apply counter-increment directives. Adds to each counter value.
	 * Counters that don't exist yet are initialized to 0 before incrementing.
	 * @param {{ name: string, value: number }[]} entries
	 */
	applyIncrement(entries) {
		for (const { name, value } of entries) {
			const current = this.#counters.get(name) || 0;
			this.#counters.set(name, current + value);
		}
	}

	/**
	 * Return a frozen snapshot of current counter values.
	 * The snapshot is a plain object suitable for storage on Fragment.
	 * @returns {Object<string, number>}
	 */
	snapshot() {
		const result = {};
		for (const [name, value] of this.#counters) {
			result[name] = value;
		}
		return Object.freeze(result);
	}

	/**
	 * Restore counter state from a snapshot (from Fragment.counterState).
	 * Clears existing state and populates from the snapshot.
	 * @param {Object<string, number>|null} snapshot
	 */
	restore(snapshot) {
		this.#counters.clear();
		if (snapshot) {
			for (const [name, value] of Object.entries(snapshot)) {
				this.#counters.set(name, value);
			}
		}
	}

	/**
	 * @returns {boolean} True if no counters have been tracked.
	 */
	isEmpty() {
		return this.#counters.size === 0;
	}
}

/**
 * Walk a fragment tree in document order, applying counter operations
 * to the given CounterState. Skips operations on continuation elements
 * (where inputBreakToken is non-null) since those were already counted
 * in a previous fragmentainer.
 *
 * @param {import("./fragment.js").Fragment} fragment
 * @param {import("./tokens.js").BreakToken|null} inputBreakToken
 * @param {CounterState} counterState
 */
export function walkFragmentTree(fragment, inputBreakToken, counterState) {
	const node = fragment.node;
	if (!node) return;

	const isContinuation = inputBreakToken !== null;

	if (!isContinuation) {
		const resets = parseCounterDirective(node.counterReset);
		if (resets.length > 0) counterState.applyReset(resets);

		const increments = parseCounterDirective(node.counterIncrement);
		if (increments.length > 0) counterState.applyIncrement(increments);
	}

	for (const child of fragment.childFragments) {
		if (!child.node) continue;
		const childBT = findChildBreakToken(inputBreakToken, child.node);
		walkFragmentTree(child, childBT, counterState);
	}
}
