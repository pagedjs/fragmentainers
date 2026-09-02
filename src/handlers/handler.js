export class LayoutHandler {
	/**
	 * Called on the fresh instance a flow creates at layout
	 * initialization. Handlers use this for feature detection and for
	 * reading options that affect their behavior.
	 *
	 * @param {Object} [options] - Options from Fragmenter
	 * @param {import('../fragmentation/flow-context.js').FlowContext} [context] -
	 *   The owning flow's context: `handlers` (this registry), `cloneMap`
	 *   (composed clone → source), `flow`. Handlers that create layout
	 *   nodes or parallel flows must hand it on to them.
	 */
	init() {}

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
	 * Handlers override this to inspect CSS rules and accumulate state
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
	appendRules() {}

	layout() {
		return { reservedBlockStart: 0, reservedBlockEnd: 0, afterRender: null };
	}

	beforeChildren() {
		return null;
	}

	/**
	 * Called before measurement begins, after CSS rules have been processed
	 * and before the measurer segments top-level content. Handlers can mutate
	 * the source content or mark elements for measurement-specific behavior.
	 *
	 * @param {DocumentFragment|Element} content — the full content root
	 */
	prepareContent() {}

	/**
	 * Called whenever the engine sizes the measurement container: at setup,
	 * before the reflow the arrangement's writes ride, and at the start of
	 * every fragmentainer, before its geometry reads. A handler that keeps an
	 * auxiliary measurer sizes it here so the write shares that flush; a
	 * `<content-measure>` ignores an unchanged inline size, so the steady
	 * state costs nothing. Region and custom resolvers give setup no space,
	 * so the first call may be the first fragmentainer's.
	 *
	 * @param {import('../fragmentation/constraint-space.js').ConstraintSpace} constraintSpace
	 */
	applyConstraintSpace() {}

	/**
	 * Called after the active content has been injected into the measurement
	 * container, before the one reflow that layout's geometry reads depend on.
	 * This is the arrangement's write phase: handlers mutate the DOM here
	 * (materialize synthetic elements, stamp attributes, attach an auxiliary
	 * measurer) and every write rides that reflow. A geometry read here —
	 * offsetHeight, getBoundingClientRect() — forces a layout of its own in
	 * the middle of the batch. The flow's inline size arrives through
	 * applyConstraintSpace, which fires before this hook.
	 *
	 * @param {Element} contentRoot — the measurement slot element
	 */
	beforeMeasurement() {}

	/**
	 * Called after the measurement container is fully set up (content
	 * injected, pseudo-elements materialized, styles resolved). The
	 * live DOM is available for getComputedStyle() queries.
	 *
	 * Handlers can probe the DOM and build internal state such as
	 * generated stylesheets. Must not modify the DOM or adopted
	 * stylesheets (to avoid measurer reflow).
	 *
	 * @param {Element} contentRoot — the measurement slot element
	 * @param {{ pass: number, segment: number }} context
	 */
	afterMeasurementSetup() {}

	/**
	 * Called before a deferred layout pass re-lays fragmentainers.
	 *
	 * @param {{ pass: number, fromIndex: number }} context
	 */
	beforeLayoutPass() {}

	/**
	 * Called after layout reaches the end of the flow.
	 *
	 * @param {{ pass: number, fromIndex: number, fragments: readonly import('../fragmentation/fragment.js').Fragment[], locate: Function }} context
	 * @returns {{ invalidate?: Element[], rebuild?: boolean }|null}
	 */
	afterLayoutPass() {
		return null;
	}

	/**
	 * Called when the registered pass budget is exhausted.
	 *
	 * @param {{ pass: number, fromIndex: number, fragments: readonly import('../fragmentation/fragment.js').Fragment[], locate: Function }} context
	 * @returns {{ accept: true, reason?: string }|null}
	 */
	onPassLimit() {
		return null;
	}

	/**
	 * Return CSSStyleSheets to be adopted on each fragment-container's
	 * shadow DOM. Called when creating a FragmentationContext.
	 *
	 * @returns {CSSStyleSheet[]}
	 */
	getAdoptedSheets() {
		return [];
	}

	/**
	 * Called after content layout completes for a fragmentainer.
	 * Handlers can inspect the resulting fragment and request additional
	 * block-end space (e.g., for footnotes). Returning a different
	 * reservedBlockEnd than what was used triggers a re-layout.
	 *
	 * @param {import('../fragmentation/fragment.js').Fragment} fragment
	 * @param {import('../fragmentation/constraint-space.js').ConstraintSpace} constraintSpace
	 * @param {import('../fragmentation/tokens.js').BreakToken|null} inputBreakToken
	 * @returns {{ reservedBlockEnd: number, afterRender: Function|null }|null}
	 */
	afterContentLayout() {
		return null;
	}

	/**
	 * Return a FragmentFlow instance if this handler runs a parallel flow
	 * (footnotes, sidenotes, etc.). Return null for handlers without a flow.
	 *
	 * @returns {import('../fragmentation/fragment-flow.js').FragmentFlow|null}
	 */
	getFlow() {
		return null;
	}

	/**
	 * Per-fragmentainer hook: return the LayoutNodes to enqueue into this
	 * handler's flow for the page just laid out by the main flow, plus any
	 * elements whose containing block should be pushed to the next page.
	 *
	 * @param {import('../fragmentation/fragment.js').Fragment} mainFragment
	 * @param {import('../fragmentation/tokens.js').BreakToken|null} mainInputBreakToken
	 * @param {number} cap — resolved block-size cap for the flow
	 * @returns {{ children: import('../layout/layout-node-base.js').LayoutNode[], pushForward: Element[] }}
	 */
	extractFlowChildren() {
		return { children: [], pushForward: [] };
	}

	/**
	 * Cap on the flow's block-size contribution to the fragmentainer.
	 * Returning Infinity (default) lets the flow take whatever it needs.
	 *
	 * @param {import('../fragmentation/constraint-space.js').ConstraintSpace} constraintSpace
	 * @returns {number}
	 */
	getFlowCap() {
		return Infinity;
	}

	/**
	 * Compose the flow's Fragment into the fragmentainer wrapper. Called
	 * once per page after the main fragment is composed.
	 *
	 * @param {Element} wrapper
	 * @param {import('../fragmentation/fragment.js').Fragment} flowFragment
	 * @param {import('../fragmentation/tokens.js').BreakToken|null} flowInputBreakToken
	 */
	composeFlowFragment() {}

	/**
	 * Called after a fragment-container has been fully composed. Engine-owned
	 * properties, fragment content, and afterRender callbacks are complete.
	 *
	 * @param {Element} element
	 * @param {import('../fragmentation/fragment.js').Fragment} fragment
	 */
	afterCompose() {}

	/**
	 * Clean up any resources held by this handler instance.
	 * Called by the registry before replacing instances on re-init.
	 */
	destroy() {}
}
