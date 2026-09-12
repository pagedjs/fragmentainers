import { findChildBreakToken } from "./tokens.js";
import { rendersNothing } from "./fragment.js";
import { ensureFlowContext } from "./flow-context.js";

const ROOT_SCOPE = Symbol("counter-root-scope");
const DOCUMENT_SCOPE = Symbol("counter-document-scope");

function isTrackedCounter(name) {
	return name !== "list-item" && !name.startsWith("--");
}

/**
 * Parse a CSS counter directive string (from getComputedStyle) into
 * an array of { name, value } entries.
 *
 * @param {string|null} value - CSS computed value
 * @param {number} [defaultValue=0] - Value used when an integer is omitted
 * @returns {{ name: string, value: number }[]}
 */
export function parseCounterDirective(value, defaultValue = 0) {
	if (!value || value === "none") return [];

	const tokens = value.trim().split(/\s+/);
	const entries = [];

	for (let i = 0; i < tokens.length; i++) {
		const name = tokens[i];
		const next = tokens[i + 1];
		const hasInteger = next !== undefined && /^[+-]?\d+$/.test(next);
		if (hasInteger) i++;
		if (isTrackedCounter(name)) {
			entries.push({ name, value: hasInteger ? Number(next) : defaultValue });
		}
	}

	return entries;
}

/**
 * Immutable scoped counter values captured at a fragmentainer boundary.
 * Produced by `CounterState.snapshot()` and stored on `Fragment.counterState`.
 *
 * `values` is the innermost scalar projection that seeds a fragmentainer's
 * `counter-set`; `frames` keeps the outer-to-inner stacks that make a restore
 * lossless. The scope identities in `frames` are object references, so a
 * structural copy (spread, structuredClone, serialization) cannot carry them:
 * `restore` rejects anything but an instance instead of silently flattening
 * every counter into the root scope.
 */
export class CounterSnapshot {
	/** @type {Readonly<Record<string, number>>} */
	values;

	/** @type {Map<string, ReadonlyArray<Readonly<{ value: number, scope: object|symbol }>>>} */
	frames;

	/**
	 * @param {Map<string, { value: number, scope: object|symbol }[]>} counters -
	 *   The accumulator's live stacks. Frames are copied and frozen so later
	 *   counter operations cannot reach an already-recorded snapshot.
	 */
	constructor(counters) {
		const values = {};
		const frames = new Map();
		for (const [name, stack] of counters) {
			const copied = Object.freeze(
				stack.map(({ value, scope }) => Object.freeze({ value, scope })),
			);
			frames.set(name, copied);
			values[name] = copied.at(-1).value;
		}
		this.values = Object.freeze(values);
		this.frames = frames;
		Object.freeze(this);
	}

	/**
	 * @param {string} name
	 * @returns {number} Innermost value, or zero when the counter does not exist.
	 */
	value(name) {
		return this.frames.get(name)?.at(-1)?.value ?? 0;
	}

	/**
	 * @param {string} name
	 * @returns {number[]} Outer-to-inner values, empty when the counter does not exist.
	 */
	stack(name) {
		return (this.frames.get(name) ?? []).map(({ value }) => value);
	}
}

/**
 * Scoped CSS counter accumulator.
 *
 * Each name owns an outer-to-inner stack. A stack frame is keyed by the
 * element whose child scope created it, so sibling resets replace one another
 * while descendant resets nest.
 */
export class CounterState {
	/** @type {Map<string, { value: number, scope: object|symbol }[]>} */
	#counters = new Map();

	/**
	 * Drop counter instances whose DOM scope does not contain `element`.
	 * This covers box-tree flattening such as display: contents, where the
	 * element that owns a counter scope has no LayoutNode to close it.
	 *
	 * @param {Element} element
	 */
	prepareForElement(element) {
		if (!element || this.#counters.size === 0) return;
		for (const [name, frames] of this.#counters) {
			const kept = frames.filter(({ scope }) => {
				if (scope === ROOT_SCOPE || typeof scope?.contains !== "function") return true;
				return scope === element || scope.contains(element);
			});
			if (kept.length === frames.length) continue;
			if (kept.length > 0) this.#counters.set(name, kept);
			else this.#counters.delete(name);
		}
	}

	/** Remove counter instances created for children of a completed scope. */
	closeScope(scope) {
		if (!scope) return;
		for (const [name, frames] of this.#counters) {
			const kept = frames.filter((frame) => frame.scope !== scope);
			if (kept.length > 0) this.#counters.set(name, kept);
			else this.#counters.delete(name);
		}
	}

	/**
	 * Create counters in the current scope. A later sibling reset at the same
	 * scope replaces that counter instance; a descendant reset pushes one.
	 */
	applyReset(entries, scope = ROOT_SCOPE) {
		for (const { name, value } of entries) {
			if (!isTrackedCounter(name)) continue;
			const frames = this.#counters.get(name) ?? [];
			const existing = frames.findIndex((frame) => frame.scope === scope);
			if (existing !== -1) frames.splice(existing);
			frames.push({ value, scope });
			this.#counters.set(name, frames);
		}
	}

	/** Set the innermost counter, creating it in the current scope when absent. */
	applySet(entries, scope = ROOT_SCOPE) {
		for (const { name, value } of entries) {
			if (!isTrackedCounter(name)) continue;
			const frames = this.#counters.get(name);
			if (frames?.length) frames[frames.length - 1].value = value;
			else this.#counters.set(name, [{ value, scope }]);
		}
	}

	/** Increment the innermost counter, creating it from zero when absent. */
	applyIncrement(entries, scope = ROOT_SCOPE) {
		for (const { name, value } of entries) {
			if (!isTrackedCounter(name)) continue;
			const frames = this.#counters.get(name);
			if (frames?.length) frames[frames.length - 1].value += value;
			else this.#counters.set(name, [{ value, scope }]);
		}
	}

	/** Return the innermost value, or zero when the counter does not exist. */
	value(name) {
		return this.#counters.get(name)?.at(-1)?.value ?? 0;
	}

	/** Return a frozen outer-to-inner value stack. */
	values(name) {
		return Object.freeze((this.#counters.get(name) ?? []).map(({ value }) => value));
	}

	/**
	 * Capture the scoped stacks for a fragmentainer boundary.
	 *
	 * @returns {CounterSnapshot}
	 */
	snapshot() {
		return new CounterSnapshot(this.#counters);
	}

	/**
	 * Replace all state with the frames a snapshot recorded.
	 *
	 * @param {CounterSnapshot|null} snapshot
	 * @throws {TypeError} Anything else has lost the scope identities a lossless
	 *   restore needs, so it is refused rather than restored flat.
	 */
	restore(snapshot) {
		this.#counters.clear();
		if (!snapshot) return;
		if (!(snapshot instanceof CounterSnapshot)) {
			throw new TypeError("CounterState.restore expects a CounterSnapshot");
		}

		for (const [name, frames] of snapshot.frames) {
			this.#counters.set(
				name,
				frames.map(({ value, scope }) => ({ value, scope })),
			);
		}
	}

	/** @returns {boolean} True if no counters have been tracked. */
	isEmpty() {
		return this.#counters.size === 0;
	}
}

function childScope(node, parentScope) {
	return node.element ?? node ?? parentScope;
}

// Keyed to the DOM parent, not the parent node, so a counter owned by a
// box-less element (display: contents) closes with the element that boxes it.
function operationScope(node, parentScope) {
	return node.element?.parentElement ?? parentScope ?? ROOT_SCOPE;
}

// The measurer replaces its content slot on reattach, so operations on the
// document's own children key to a sentinel instead of that element. Children
// promoted out of a top-level display: contents box also sit at depth 1, but
// their DOM parent is real content: keying them to it is what lets the walk
// close them when it reaches the contents box's next sibling.
function scopeFor(node, parentScope, depth, contentRoot) {
	if (depth === 0) return ROOT_SCOPE;
	const parent = node.element?.parentElement ?? null;
	if (depth === 1 && (parent === null || parent === contentRoot)) return DOCUMENT_SCOPE;
	return operationScope(node, parentScope);
}

/**
 * Walk a fragment tree in document order, applying counter operations.
 * Continuations do not repeat their operations. Completed fragments close
 * counter instances created by their descendants; continuing fragments retain
 * them for the next fragmentainer snapshot.
 *
 * @param {import("./fragment.js").Fragment} fragment - Root fragment of the tree
 * @param {import("./tokens.js").BreakToken|null} inputBreakToken
 * @param {CounterState} counterState
 * @param {Element|null} [contentRoot] - The element whose children are the
 *   document's top-level content; operations on those children key to a scope
 *   that survives measurer reattachment.
 * @param {Function|null} [applyPageCounter] Apply source page operations to the canonical page counter.
 * @returns {void}
 */
export function walkFragmentTree(fragment, inputBreakToken, counterState, contentRoot = null, applyPageCounter = null) {
	walkFragment(fragment, inputBreakToken, counterState, ROOT_SCOPE, 0, contentRoot, applyPageCounter);
}

/**
 * @param {import("./fragment.js").Fragment} fragment
 * @param {import("./tokens.js").BreakToken|null} inputBreakToken
 * @param {CounterState} counterState
 * @param {object|symbol} parentScope
 * @param {number} depth - Distance from the root fragment
 * @param {Element|null} contentRoot
 */
function walkFragment(fragment, inputBreakToken, counterState, parentScope, depth, contentRoot, applyPageCounter) {
	const node = fragment.node;
	if (!node || rendersNothing(fragment, inputBreakToken)) return;

	// A break-before token means the node produced no fragment on the previous
	// fragmentainer, so its operations have not run yet.
	const isContinuation = inputBreakToken !== null && !inputBreakToken.isBreakBefore &&
		(inputBreakToken.consumedBlockSize > 0 || inputBreakToken.textOffset > 0 || inputBreakToken.isAtBlockEnd);
	const scope = scopeFor(node, parentScope, depth, contentRoot);

	if (!isContinuation) {
		if (node.element) counterState.prepareForElement(node.element);

		const operations = {
			reset: parseCounterDirective(node.counterReset),
			set: parseCounterDirective(node.counterSet),
			increment: parseCounterDirective(node.counterIncrement, 1),
		};
		if (applyPageCounter) {
			applyPageCounter(Object.fromEntries(Object.entries(operations).map(([kind, entries]) =>
				[kind, entries.filter(({ name }) => name === "page")])));
			for (const kind of Object.keys(operations)) operations[kind] = operations[kind].filter(({ name }) => name !== "page");
		}
		const resets = operations.reset;
		if (resets.length > 0) counterState.applyReset(resets, scope);

		// CSS Lists 3 §4: reset creates instances, increment changes their
		// values, and set supplies the final value used on this element.
		const increments = operations.increment;
		if (increments.length > 0) counterState.applyIncrement(increments, scope);

		const sets = operations.set;
		if (sets.length > 0) counterState.applySet(sets, scope);
	}

	const ownScope = depth === 0 ? DOCUMENT_SCOPE : childScope(node, parentScope);
	for (const child of fragment.childFragments) {
		if (!child.node) continue;
		const childBT = findChildBreakToken(inputBreakToken, child.node);
		walkFragment(child, childBT, counterState, ownScope, depth + 1, contentRoot, applyPageCounter);
	}

	// A counter created by an element also covers that element's following
	// siblings, so a completed fragment closes only what its children created.
	// Document-level counters have no such end: the root never closes them.
	if (depth > 0 && fragment.breakToken === null) counterState.closeScope(ownScope);
}

/**
 * Restore counters inside the publication tree's continuation scopes.
 * Counter operations on a shadow host do not seed its slotted content.
 * @param {DocumentFragment} content Composed publication content.
 * @param {import("./fragment.js").Fragment} fragment Current fragment.
 * @param {CounterSnapshot|null} snapshot Previous committed counter state.
 * @returns {void}
 */
export function restoreComposedCounters(content, fragment, snapshot) {
	if (!snapshot || !fragment.node) return;
	const cloneMap = ensureFlowContext(fragment.node).cloneMap;
	const clones = new Map();
	for (const clone of content.querySelectorAll("*")) {
		const source = cloneMap.get(clone);
		if (source && !clones.has(source)) clones.set(source, clone);
	}
	const nodes = new Map();
	const visit = (current) => {
		if (current.node?.element) nodes.set(current.node.element, current.node);
		for (const child of current.childFragments) visit(child);
	};
	visit(fragment);
	const seeds = new Map();
	for (const [name, frames] of snapshot.frames) {
		if (name === "page") continue;
		for (const { scope, value } of frames) {
			// Operation scopes are DOM parents: seeding their clone keeps the
			// restored counter active across every continued child in that scope.
			const target = scope === ROOT_SCOPE || scope === DOCUMENT_SCOPE
				? content.firstElementChild : clones.get(scope);
			if (!target) continue;
			const entries = seeds.get(target) ?? new Map();
			entries.set(name, value);
			seeds.set(target, entries);
		}
	}
	for (const [target, entries] of seeds) {
		const sourceNode = nodes.get(cloneMap.get(target));
		const reset = target.hasAttribute("data-split-from") ? "none" : sourceNode?.counterReset ?? "none";
		for (const { name } of parseCounterDirective(reset)) entries.delete(name);
		const values = [...entries].map(([name, value]) => `${name} ${value}`);
		if (reset !== "none") values.push(reset);
		if (values.length) target.style.setProperty("counter-reset", values.join(" "), "important");
	}
}
