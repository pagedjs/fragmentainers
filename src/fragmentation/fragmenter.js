import { DOMLayoutNode } from "../layout/layout-node.js";
import { runLayoutGenerator, getLayoutAlgorithm } from "../layout/layout-driver.js";
import { FragmentationContext } from "./fragmentation-context.js";
import {
	PageResolver,
	resolveForcedBreakValue,
	resolveNextPageBreakBefore,
	requiredPageSide,
	isSideSpecificBreak,
} from "../resolvers/page-resolver.js";
import { CounterState, parseCounterDirective, walkFragmentTree } from "./counter-state.js";
import { ConstraintSpace, FRAGMENTATION_COLUMN } from "./constraint-space.js";
import { Fragment } from "./fragment.js";
import "../components/content-measure.js";
import "../components/fragment-container.js";
import { Measurer } from "../measurement/measure.js";
import { NullMeasurer } from "../measurement/null-measurer.js";
import { setTargetDevicePixelRatio } from "../measurement/line-box.js";
import { FlowContext } from "./flow-context.js";
import { defaultHandlers } from "../handlers/catalog.js";
import { UA_DEFAULTS } from "../styles/ua-defaults.js";
import { buildCompositeText } from "../styles/composite-sheet.js";

const MAX_ZERO_PROGRESS = 5;

function hasPlacedContent(fragment) {
	return fragment.blockSize > 0 || fragment.childFragments.some(hasPlacedContent);
}

const DEFAULT_PRELOAD_TIMEOUT = 10000;

// Combine a caller-supplied AbortSignal with a default timeout signal so
// font/image preloads can't hang indefinitely if a resource never loads.
function preloadSignal({ signal, timeout = DEFAULT_PRELOAD_TIMEOUT } = {}) {
	const signals = [];
	if (signal) signals.push(signal);
	if (timeout > 0) signals.push(AbortSignal.timeout(timeout));
	if (signals.length === 0) return null;
	if (signals.length === 1) return signals[0];
	return AbortSignal.any(signals);
}

// Race a promise against an abort signal. The underlying load isn't
// cancellable; this just lets the caller stop waiting.
function abortable(promise, signal) {
	if (!signal) return promise;
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			(v) => {
				signal.removeEventListener("abort", onAbort);
				resolve(v);
			},
			(e) => {
				signal.removeEventListener("abort", onAbort);
				reject(e);
			},
		);
	});
}

function normalizeFontFamily(family) {
	return family.trim().replace(/^["']|["']$/g, "").toLowerCase();
}

function loadImageProbe(img, signal) {
	return new Promise((resolve) => {
		const probe = new Image();
		const cleanup = () => {
			probe.onload = null;
			probe.onerror = null;
			signal?.removeEventListener("abort", onAbort);
		};
		const onAbort = () => {
			probe.src = "";
			cleanup();
			resolve();
		};
		if (signal?.aborted) {
			onAbort();
			return;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		probe.onload = () => {
			img.width = probe.naturalWidth;
			img.height = probe.naturalHeight;
			cleanup();
			resolve();
		};
		probe.onerror = () => {
			img.remove();
			cleanup();
			resolve();
		};
		probe.src = img.src;
	});
}

/**
 * Walk the layout tree for the deepest DOMLayoutNode whose element
 * contains `target`. Sets `breakBefore = "page"` on it so the next
 * main-flow iteration pushes that block to the next page. Returns
 * true when a push was actually applied.
 *
 * The prior value is recorded in `pushedBreaks` so reflow() can undo
 * pushes that may no longer apply.
 *
 * `target` may be a LayoutNode (with `.element`) or an Element.
 */
function pushBlockAncestorToNextPage(rootNode, target, pushedBreaks) {
	const targetEl = target instanceof Element ? target : (target?.element ?? null);
	if (!targetEl) return false;
	const ancestor = findBlockAncestor(rootNode, targetEl);
	if (!ancestor || ancestor.breakBefore === "page") return false;
	pushedBreaks.push({ node: ancestor, breakBefore: ancestor.breakBefore });
	ancestor.breakBefore = "page";
	return true;
}

function findBlockAncestor(node, targetEl) {
	if (!node) return null;
	for (const child of node.children) {
		const el = child.element;
		if (el && (el === targetEl || el.contains(targetEl))) {
			return findBlockAncestor(child, targetEl) ?? child;
		}
	}
	return null;
}

/**
 * Fragments content across bounded containers — iterates over content,
 * producing one <fragment-container> element per fragmentainer.
 *
 * The result it produces is the spec's "fragmented flow"; this is the
 * machinery that produces it.
 *
 * Extends Iterator so instances are directly usable in for-of:
 *
 *   const flow = new Fragmenter(content, { width: 400, height: 600 });
 *   for (const el of flow) {
 *     document.body.appendChild(el);
 *   }
 *
 * Accepts options in priority order:
 * - `constraintSpace` — full control, bypasses @page rules entirely
 * - `resolver` — pre-configured PageResolver or RegionResolver
 * - `width` / `height` — sugar for column fragmentation at a fixed size
 * - (none) — auto-collects @page rules from document.styleSheets,
 *   defaults to US Letter
 */
export class Fragmenter extends Iterator {
	/**
	 * The ordered catalog of handler classes every flow instantiates.
	 * Append to it once at package load to add a handler; append a
	 * subclass of a listed handler to override it in place. Changes
	 * apply to flows constructed afterwards.
	 *
	 * @type {Array<typeof import('../handlers/handler.js').LayoutHandler>}
	 */
	static handlers = defaultHandlers;

	#flowContext;
	#content;
	#styles;
	#resolver;
	#constraintSpace;
	#options;
	// Stepper state (initialized lazily on first next() call)
	#tree = null;
	#measurer = null;
	#measureElement = null;
	#breakToken = null;
	#mainDone = false;
	#fragmentainerIndex = 0;
	#counterState = null;
	#pageCounter = 0;
	#contentStyles = null;
	#isPageBased = false;
	#startIndex = 0;
	#startOffset = 0;
	#prevFragment = null;
	#fragments = [];
	#styleSheet = null;
	#ownsStyleSheet = false;
	#compositeRuleIndex = null;
	#adoptedSheets = [];
	#preloadedFonts = [];
	#fontDisplayEdits = [];

	// Iterator state
	#context = null;
	#done = false;
	#zeroProgressCount = 0;
	#pushedBreaks = [];
	#initialFlowSnapshots = null;

	/**
	 * @param {DocumentFragment|Element|object} content - Content to fragment
	 * @param {object} [options]
	 * @param {CSSStyleSheet[]} [options.styles] - Stylesheets. If omitted,
	 *   uses document.adoptedStyleSheets when non-empty, else document.styleSheets.
	 * @param {ConstraintSpace} [options.constraintSpace] - Direct constraint space (bypasses @page rules)
	 * @param {PageResolver|RegionResolver} [options.resolver] - Pre-configured resolver
	 * @param {number} [options.width] - Container width in CSS px (column fragmentation)
	 * @param {number} [options.height] - Container height in CSS px (column fragmentation)
	 * @param {number} [options.devicePixelRatio] - Target device pixel ratio for line-height rounding.
	 *   At 1, line-height: normal is floored to integers (matching print/PDF).
	 *   Defaults to window.devicePixelRatio.
	 * @param {boolean} [options.emulatePrintPixelRatio=true] - Whether to normalize
	 *   line-height for screen rendering to match DPR 1 layout.
	 * @param {{ fragmentainerIndex: number, blockOffset: number }} [options.continuation] -
	 *   Resume point handed over by a previous flow: the fragmentainer index to
	 *   number from, and the block offset already consumed within it. Read back
	 *   after layout via the `continuation` getter.
	 * @param {CSSStyleSheet} [options.styleSheet] - Sheet to write the composite
	 *   scoped rules into. The caller adopts it where needed (`document` or any
	 *   `ShadowRoot`). When omitted, the flow creates its own sheet and adopts
	 *   it on `document.adoptedStyleSheets`.
	 */
	constructor(content, options = {}) {
		super();
		this.#options = options;
		this.#flowContext = new FlowContext({ handlerClasses: Fragmenter.handlers, flow: this });

		this.#startIndex = options.continuation?.fragmentainerIndex ?? 0;
		this.#startOffset = options.continuation?.blockOffset ?? 0;
		this.#fragmentainerIndex = this.#startIndex;
		this.#pageCounter = this.#startIndex;

		if (options.styleSheet) {
			this.#styleSheet = options.styleSheet;
		}

		// Normalize Element → DocumentFragment (clone into fragment)
		if (content.nodeType === 1 /* ELEMENT_NODE */) {
			const frag = document.createDocumentFragment();
			frag.appendChild(content.cloneNode(true));
			this.#content = frag;
		} else {
			this.#content = content;
		}

		// Add lazy loading to images with explicit dimensions so the browser
		// doesn't fetch them eagerly before they're needed for layout.
		// Mock nodes (unit tests) may not implement querySelectorAll.
		if (typeof this.#content.querySelectorAll === "function") {
			for (const img of this.#content.querySelectorAll("img[width][height]")) {
				img.setAttribute("loading", "lazy");
			}
		}

		if (options.styles) {
			this.#styles = this.#adoptStyles(options.styles);
		} else if (document.adoptedStyleSheets.length > 0) {
			this.#styles = [...document.adoptedStyleSheets];
		} else {
			this.#styles = [...document.styleSheets];
		}

		if (options.constraintSpace) {
			this.#constraintSpace = options.constraintSpace;
			this.#resolver = null;
		} else if (options.resolver) {
			this.#resolver = options.resolver;
		} else if (options.width || options.height) {
			const w = options.width || options.height;
			const h = options.height || options.width;
			this.#constraintSpace = new ConstraintSpace({
				availableInlineSize: w,
				availableBlockSize: h,
				fragmentainerBlockSize: h,
				fragmentationType: options.type || FRAGMENTATION_COLUMN,
			});
			this.#resolver = null;
		}
		this.#isPageBased = this.#resolver instanceof PageResolver;
		// Page resolver auto-created in layout() from styles if neither set
	}

	/**
	 * This flow's handler instances. `flow.handlers.get(Cls)` returns the
	 * instance of a catalog class (or of the subclass overriding it).
	 *
	 * @returns {import('../handlers/registry.js').HandlerRegistry}
	 */
	get handlers() {
		return this.#flowContext.handlers;
	}

	/**
	 * Lay out the next fragmentainer and return an iterator result.
	 *
	 * Returns `{ value: <fragment-container>, done: false }` for each
	 * fragmentainer, and `{ value: undefined, done: true }` when all
	 * content has been placed.
	 *
	 * A flow over a pre-built layout tree has no measured content styles
	 * to compose against, so it produces no elements; read its Fragments
	 * off the FragmentationContext that `flow()` returns instead.
	 *
	 * @returns {{ value: Element|undefined, done: boolean }}
	 */
	next() {
		// Lazy initialization
		if (!this.#done && (!this.#tree || !this.#measureElement)) this.#layout();

		// Already exhausted
		if (this.#done) return { value: undefined, done: true };

		// Initialize context on first call
		if (!this.#context) {
			this.#context = new FragmentationContext(this.#fragments, this.#contentStyles, {
				handlers: this.#flowContext.handlers,
			});
		}

		this.#step();

		// Create element and push to internal context (if contentStyles available)
		let el;
		if (this.#contentStyles) {
			el = this.#context.createFragmentainer(this.#fragments.length - 1);
			this.#context.push(el);
		}

		if (this.#done) this.releaseMeasurer();

		return { value: el, done: false };
	}

	/**
	 * Iterator protocol cleanup — called when iteration stops early
	 * (breaking out of for...of, Iterator helpers, etc.). Releases the
	 * measurement container without marking the flow done, so iteration
	 * can resume later; destroy() remains the full-teardown path.
	 *
	 * @param {*} [value]
	 * @returns {{ value: *, done: true }}
	 */
	return(value) {
		this.releaseMeasurer();
		return { value, done: true };
	}

	/**
	 * Run fragmentation to completion and return a FragmentationContext.
	 *
	 * Use flow() when you need a specific range of elements, or when
	 * you want the full FragmentationContext result. For simple iteration,
	 * use `for (const el of flow)` instead.
	 *
	 * @param {{ start?: number, stop?: number }} [range] - Controls which
	 *   <fragment-container> elements are created. Layout always runs to
	 *   completion; start/stop only limits element creation.
	 * @returns {FragmentationContext}
	 */
	flow({ start, stop } = {}) {
		this.#layout();

		while (!this.#done) {
			this.#step();
		}

		// Layout is done — release the measurer. Composition only needs
		// cloneNode/getAttribute/tagName, which work on detached elements.
		this.releaseMeasurer();

		return new FragmentationContext([...this.#fragments], this.#contentStyles, {
			start,
			stop,
			handlers: this.#flowContext.handlers,
		});
	}

	/**
	 * Re-layout from a specific fragmentainer and return a new FragmentationContext.
	 *
	 * Resets the layout stepper to the break token before `fromIndex`,
	 * re-runs layout to completion with live measurements, and returns
	 * a new FragmentationContext containing the new fragments and elements.
	 *
	 * @param {number} [fromIndex=0] - Fragmentainer index to restart from. Absolute,
	 *   so on a flow started from a continuation it is offset by the start index.
	 *   Ignored when the layout tree has been rebuilt since those fragments were
	 *   produced: the flow then restarts from the beginning.
	 * @param {Object} [options]
	 * @param {boolean} [options.rebuild=false] - Rebuild the layout tree from source DOM
	 * @returns {FragmentationContext}
	 */
	reflow(fromIndex = 0, { rebuild = false } = {}) {
		if (rebuild) {
			// A rebuild re-derives the tree from source content, which lives in
			// the measurer until it is released. Releasing first reassembles
			// #content whole; without it #layout() rebuilds from a stub that has
			// no contentRoot.
			this.releaseMeasurer();
			this.#tree = null;
			this.#initialFlowSnapshots = null;
			this.#layout(true);
		} else {
			this.#layout();
		}
		// #fragments is indexed from the start of this run, which is only the
		// same as the fragmentainer index when the run started at zero.
		const requested = Math.min(
			Math.max(fromIndex - this.#startIndex, 0),
			this.#fragments.length,
		);
		// Rebuilding replaces every layout node, so fragments produced before
		// it — and the break tokens they carry — name nodes that no longer
		// exist. Nothing can be resumed from them and the flow restarts.
		const position =
			requested === 0 || this.#fragments[requested - 1]?.node === this.#tree ? requested : 0;
		const prev = position > 0 ? this.#fragments[position - 1] : null;
		this.#breakToken = prev?.breakToken ?? null;
		// Segmented measurement holds its own cursor over the source DOM.
		// Hand it the token being resumed from — the same call #step() makes
		// after every fragment — so it arranges itself for that segment.
		if (this.#measurer.arrange(this.#breakToken, this.#tree)) this.#installStyleSheet();
		this.#fragmentainerIndex = this.#startIndex + position;
		this.#prevFragment = prev;
		this.#counterState = new CounterState();
		if (prev?.counterState) {
			this.#counterState.restore(prev.counterState);
		}
		this.#pageCounter = prev?.page ?? this.#startIndex;

		// Fragment checkpoints describe their output state, so the fragment
		// before the restart supplies its flows. The initial checkpoint also
		// preserves queues populated by a handler before the first page.
		const flowSnapshots = prev?.flowSnapshots ?? this.#initialFlowSnapshots;
		if (flowSnapshots) {
			const flowEntries = this.#flowContext.handlers.getFlows();
			for (let i = 0; i < flowEntries.length; i++) {
				flowEntries[i].flow.restore(flowSnapshots[i]);
			}
		}

		// Break pushes before the restart remain part of the retained prefix.
		// Later pushes are unwound in reverse mutation order and re-derived.
		const pushedBreakMark = prev?.pushedBreakMark ?? 0;
		for (let i = this.#pushedBreaks.length - 1; i >= pushedBreakMark; i--) {
			const { node, breakBefore } = this.#pushedBreaks[i];
			node.breakBefore = breakBefore;
		}
		this.#pushedBreaks.length = pushedBreakMark;

		this.#fragments.length = position;
		// A null token on a non-blank retained fragment means the main flow
		// ended there; later fragmentainers may only be draining parallel flows.
		this.#mainDone = this.#fragments.some(
			(fragment) => !fragment.isBlank && fragment.breakToken === null,
		);
		const pendingFlow = this.#flowContext.handlers
			.getFlows()
			.some(({ flow }) => flow.breakToken !== null);
		this.#done = this.#mainDone && !pendingFlow;
		this.#context = null;
		this.#zeroProgressCount = 0;

		// Re-run layout to completion
		const newFragments = [];
		while (!this.#done) {
			newFragments.push(this.#step());
		}
		this.#setTotalPages();

		// Layout is done — release the measurer before composition.
		this.releaseMeasurer();

		return new FragmentationContext(newFragments, this.#contentStyles, {
			previous: prev,
			handlers: this.#flowContext.handlers,
		});
	}

	/**
	 * The resume point for a flow picking up where this one stopped:
	 * the fragmentainer index to continue numbering from and the block
	 * offset already consumed within it. Rolls to the next index when
	 * the last fragment filled the fragmentainer.
	 *
	 * Meaningful once layout has run; before that it echoes the incoming
	 * continuation.
	 *
	 * @returns {{ fragmentainerIndex: number, blockOffset: number }}
	 */
	get continuation() {
		const fragments = this.#fragments;
		if (fragments.length === 0) {
			return { fragmentainerIndex: this.#startIndex, blockOffset: this.#startOffset };
		}

		const last = fragments[fragments.length - 1];
		const lastIndex = this.#startIndex + fragments.length - 1;
		const lastOffset = last.blockSize + (fragments.length === 1 ? this.#startOffset : 0);
		// A resolver reports the fragmentainer's own size through the
		// fragment's constraints. Without one, the per-fragment constraints
		// are synthesized from the available size, which the start offset
		// has already reduced — so read the fragmentainer size directly.
		const fragmentainerBlockSize =
			(this.#resolver
				? last.constraints?.contentArea?.blockSize
				: this.#constraintSpace?.fragmentainerBlockSize) ?? 0;

		const filled = lastOffset >= fragmentainerBlockSize;
		return {
			fragmentainerIndex: filled ? lastIndex + 1 : lastIndex,
			blockOffset: filled ? 0 : lastOffset,
		};
	}

	/**
	 * Shared iteration step for next()/flow()/reflow(): lay out the next
	 * fragment, track completion state, apply the zero-progress guard,
	 * and advance the measurer's segment.
	 *
	 * Main-flow completion (#mainDone) is tracked separately from overall
	 * completion (#done) because parallel flows may emit additional pages
	 * to drain their carryover.
	 *
	 * @returns {import('./fragment.js').Fragment}
	 */
	#step() {
		const fragment = this.#nextFragment();
		// Store the settled output state used to resume the following fragment.
		fragment.flowSnapshots = this.#flowContext.handlers
			.getFlows()
			.map(({ flow }) => flow.snapshot());
		fragment.pushedBreakMark = this.#pushedBreaks.length;

		if (this.#startIndex === 0 && this.#fragments.length === 1) {
			fragment.isFirst = true;
		}

		// Blank pages skip layout, so their break token says nothing
		// about main-flow progress.
		if (fragment.breakToken === null && !fragment.isBlank) {
			this.#mainDone = true;
		}

		// Arrange measurement for the fragment this token resumes into; a null
		// token has nothing to resume, so the last segment stays put. A new
		// segment re-stamps handler data-refs (StyleResolver) and rebuilds
		// normalization sheets, so reinstall the composite sheet to keep those
		// rules matching the new refs.
		if (fragment.breakToken && this.#measurer.arrange(fragment.breakToken, this.#tree)) {
			this.#installStyleSheet();
		}

		// Zero-progress guard. Overflow continuing past a box's block-end
		// (CSS Fragmentation §2.1) is progress that adds no extent to the box.
		if (fragment.breakToken && !fragment.isBlank && !hasPlacedContent(fragment)) {
			this.#zeroProgressCount++;
			if (this.#zeroProgressCount >= MAX_ZERO_PROGRESS) {
				console.warn(
					`Fragmenter: stopped after ${MAX_ZERO_PROGRESS} consecutive zero-progress fragmentainers`,
				);
				this.#done = true;
				fragment.isLast = true;
				this.#setTotalPages();
				return fragment;
			}
		} else {
			this.#zeroProgressCount = 0;
		}

		const pendingFlow = this.#flowContext.handlers.getFlows().some(({ flow }) => flow.breakToken !== null);
		if (fragment.breakToken === null && !pendingFlow && !fragment.isBlank) {
			this.#done = true;
			fragment.isLast = true;
		}
		this.#setTotalPages();

		return fragment;
	}

	#advancePageCounter(fragment, constraints) {
		if (!this.#isPageBased || !(this.#resolver instanceof PageResolver)) return;

		for (const entry of parseCounterDirective(constraints.counterReset, 0)) {
			if (entry.name === "page") this.#pageCounter = entry.value;
		}

		if (constraints.counterIncrement === null) {
			this.#pageCounter++;
		} else {
			for (const entry of parseCounterDirective(constraints.counterIncrement, 1)) {
				if (entry.name === "page") this.#pageCounter += entry.value;
			}
		}

		fragment.page = this.#pageCounter;
	}

	#setTotalPages() {
		if (!this.#done || !this.#isPageBased) return;
		const total = this.#startIndex + this.#fragments.length;
		for (const fragment of this.#fragments) fragment.pages = total;
	}

	/**
	 * Lay out one fragmentainer with two-pass earlyBreak support
	 * and iterative post-layout adjustment.
	 *
	 * After content layout, this.#flowContext.handlers.afterContentLayout() is called.
	 * If any handler requests a different block-end reservation than
	 * what was used, layout is re-run with the updated constraint
	 * space. This repeats until the reservation stabilises or the
	 * iteration limit is reached.
	 */
	#layoutFragmentainer(rootNode, constraintSpace, breakToken) {
		const RootAlgoClass = getLayoutAlgorithm(rootNode);

		const layoutChildFn = (child, cs) => {
			const ChildAlgoClass = getLayoutAlgorithm(child);
			return runLayoutGenerator(new ChildAlgoClass(child, cs, null));
		};
		const { reservedBlockStart, reservedBlockEnd, afterRenderCallbacks } = this.#mainDone
			? { reservedBlockStart: 0, reservedBlockEnd: 0, afterRenderCallbacks: [] }
			: this.#flowContext.handlers.layout(rootNode, constraintSpace, breakToken, layoutChildFn);

		const MAX_POST_LAYOUT_ITERATIONS = 3;
		const flowEntries = this.#flowContext.handlers.getFlows();
		const flowSnapshots = flowEntries.map(({ flow }) => flow.snapshot());
		const flowReservations = flowEntries.map(() => 0);
		const flowFragments = flowEntries.map(() => null);
		const flowInputTokens = flowEntries.map(() => null);
		let postLayoutReserved = 0;
		let postLayoutCallbacks = [];
		let result;

		for (let iter = 0; iter <= MAX_POST_LAYOUT_ITERATIONS; iter++) {
			// Roll every flow back to its page-start state so repeated passes
			// don't re-lay settled flows against already-advanced queues and tokens.
			if (iter > 0) {
				for (let i = 0; i < flowEntries.length; i++) {
					flowEntries[i].flow.restore(flowSnapshots[i]);
					flowFragments[i] = null;
					flowInputTokens[i] = null;
				}
			}
			const flowTotal = flowReservations.reduce((s, n) => s + n, 0);
			const totalReservedEnd = reservedBlockEnd + postLayoutReserved + flowTotal;
			let adjustedSpace = constraintSpace;
			if (reservedBlockStart > 0 || totalReservedEnd > 0) {
				adjustedSpace = new ConstraintSpace({
					availableInlineSize: constraintSpace.availableInlineSize,
					availableBlockSize:
						constraintSpace.availableBlockSize - reservedBlockStart - totalReservedEnd,
					fragmentainerBlockSize: constraintSpace.fragmentainerBlockSize - totalReservedEnd,
					blockOffsetInFragmentainer:
						constraintSpace.blockOffsetInFragmentainer + reservedBlockStart,
					fragmentationType: constraintSpace.fragmentationType,
				});
			}

			if (this.#mainDone) {
				const emptyFragment = new Fragment(rootNode, 0);
				emptyFragment.inlineSize = adjustedSpace.availableInlineSize;
				result = { fragment: emptyFragment, breakToken: null };
			} else {
				result = runLayoutGenerator(new RootAlgoClass(rootNode, adjustedSpace, breakToken));
				if (result.earlyBreak) {
					result = runLayoutGenerator(
						new RootAlgoClass(rootNode, adjustedSpace, breakToken, result.earlyBreak),
					);
				}
			}

			const adjustment = this.#flowContext.handlers.afterContentLayout(result.fragment, constraintSpace, breakToken);
			const legacyReserved = adjustment?.reservedBlockEnd ?? 0;
			const legacyCallbacks = adjustment?.afterRenderCallbacks ?? [];

			let flowsSettled = true;
			let pushedForward = false;
			for (let i = 0; i < flowEntries.length; i++) {
				const { handler, flow } = flowEntries[i];
				const cap = handler.getFlowCap(constraintSpace);
				const save = flow.snapshot();
				// On drainage pages (main done, flow has carry-over) we don't
				// re-extract bodies — the flow queue already holds the in-progress
				// item, and re-extracting would re-enqueue completed bodies from
				// earlier pages.
				if (!this.#mainDone) {
					const { children, pushForward } = handler.extractFlowChildren(
						result.fragment,
						breakToken,
						cap,
					);
					for (const el of pushForward) {
						if (pushBlockAncestorToNextPage(rootNode, el, this.#pushedBreaks)) {
							pushedForward = true;
						}
					}
					if (pushedForward) {
						flowsSettled = false;
						break;
					}
					flow.enqueue(children);
				}
				const flowResult = flow.layoutFragmentainer({
					availableInlineSize: constraintSpace.availableInlineSize,
					availableBlockSize: cap,
				});

				if (flowResult.rejectedNode) {
					flow.restore(save);
					const pushed = pushBlockAncestorToNextPage(
						rootNode,
						flowResult.rejectedNode,
						this.#pushedBreaks,
					);
					if (pushed) pushedForward = true;
					flowsSettled = false;
					continue;
				}

				const needed = flowResult.fragment.blockSize;
				if (needed !== flowReservations[i]) {
					flow.restore(save);
					flowReservations[i] = needed;
					flowsSettled = false;
					continue;
				}
				flowFragments[i] = flowResult.fragment;
				flowInputTokens[i] = flowResult.inputBreakToken;
			}

			const settled = flowsSettled && !pushedForward && legacyReserved === postLayoutReserved;
			postLayoutReserved = legacyReserved;
			postLayoutCallbacks = legacyCallbacks;
			if (settled) break;
		}

		const flowCallbacks = [];
		for (let i = 0; i < flowEntries.length; i++) {
			const fragment = flowFragments[i];
			if (!fragment) continue;
			const { handler } = flowEntries[i];
			const inputBT = flowInputTokens[i];
			flowCallbacks.push((wrapper) => handler.composeFlowFragment(wrapper, fragment, inputBT));
		}

		const allCallbacks = [...afterRenderCallbacks, ...postLayoutCallbacks, ...flowCallbacks];
		if (allCallbacks.length > 0) {
			result.fragment.afterRender = allCallbacks;
		}

		return result;
	}

	/**
	 * Lay out the next fragmentainer and return its Fragment.
	 * Handles blank page insertion, constraint resolution, and counter state.
	 *
	 * @returns {import('./fragment.js').Fragment}
	 */
	#nextFragment() {
		// Check if a side-specific break requires a blank page before layout.
		// Only resolvers that number page sides can answer this; a region
		// resolver has no recto/verso.
		if (this.#resolver?.isVerso) {
			let sideValue = resolveForcedBreakValue(this.#breakToken);
			if (!isSideSpecificBreak(sideValue)) {
				const nextBreakBefore = resolveNextPageBreakBefore(this.#tree, this.#breakToken);
				if (isSideSpecificBreak(nextBreakBefore)) {
					sideValue = nextBreakBefore;
				} else {
					sideValue = null;
				}
			}
			const side = requiredPageSide(sideValue);
			if (side !== null) {
				const isLeft = this.#resolver.isVerso(this.#fragmentainerIndex);
				const currentSide = isLeft ? "left" : "right";
				if (currentSide !== side) {
					// Wrong side — emit a blank page without running layout
					const blankConstraints = this.#resolver.resolve(
						this.#fragmentainerIndex,
						this.#tree,
						this.#breakToken,
						true,
					);
					const blankFragment = new Fragment(this.#tree, 0);
					blankFragment.isBlank = true;
					blankFragment.constraints = blankConstraints;
					blankFragment.breakToken = this.#breakToken;
					this.#advancePageCounter(blankFragment, blankConstraints);
					if (!this.#counterState.isEmpty()) {
						blankFragment.counterState = this.#counterState.snapshot();
					}
					this.#prevFragment = blankFragment;
					this.#fragmentainerIndex++;
					this.#fragments.push(blankFragment);
					return blankFragment;
				}
			}
		}

		// Resolve constraint space for this fragmentainer
		let constraintSpace;
		let constraints = null;

		if (this.#resolver) {
			constraints = this.#resolver.resolve(this.#fragmentainerIndex, this.#tree, this.#breakToken);
			constraintSpace = constraints.toConstraintSpace();
		} else {
			constraintSpace = this.#constraintSpace;
		}

		// Resuming mid-fragmentainer: the first one this flow produces starts
		// where the handover left off, and has that much less room.
		if (this.#fragmentainerIndex === this.#startIndex && this.#startOffset > 0) {
			constraintSpace = new ConstraintSpace({
				availableInlineSize: constraintSpace.availableInlineSize,
				availableBlockSize: constraintSpace.fragmentainerBlockSize - this.#startOffset,
				fragmentainerBlockSize: constraintSpace.fragmentainerBlockSize,
				blockOffsetInFragmentainer: this.#startOffset,
				fragmentationType: constraintSpace.fragmentationType,
				isNewFormattingContext: constraintSpace.isNewFormattingContext,
			});
		}

		// First page: carry body margin for collapsing with first child. Copy
		// first — a caller-supplied space may be reused for another run.
		if (!this.#breakToken && this.#tree.marginBlockStart) {
			constraintSpace = Object.assign(new ConstraintSpace(), constraintSpace);
			constraintSpace.bodyMarginBlockStart = this.#tree.marginBlockStart;
			constraintSpace.fragmentainerContentStart = this.#tree.marginBlockStart;
		}

		// Sync DOM measurement container
		this.#measurer.applyConstraintSpace(constraintSpace);

		// Layout this fragmentainer (with two-pass earlyBreak support)
		const result = this.#layoutFragmentainer(this.#tree, constraintSpace, this.#breakToken);
		if (constraints) {
			result.fragment.constraints = constraints;
		} else {
			result.fragment.constraints = {
				contentArea: {
					inlineSize: constraintSpace.availableInlineSize,
					blockSize: constraintSpace.availableBlockSize,
				},
			};
		}
		this.#advancePageCounter(result.fragment, result.fragment.constraints);

		// Counter state accumulation
		const prevBT = this.#prevFragment?.breakToken ?? null;
		walkFragmentTree(result.fragment, prevBT, this.#counterState, this.#measurer?.contentRoot ?? null);
		if (!this.#counterState.isEmpty()) {
			result.fragment.counterState = this.#counterState.snapshot();
		}

		// Advance state
		this.#breakToken = result.breakToken;
		this.#prevFragment = result.fragment;
		this.#fragmentainerIndex++;
		this.#fragments.push(result.fragment);

		return result.fragment;
	}

	/**
	 * Initialize layout tree and measurement state.
	 * Called lazily on first next() call. Can also be called explicitly
	 * to force re-initialization (e.g. after structural DOM changes).
	 *
	 * @param {boolean} [forceUpdate=false] - Force re-initialization
	 */
	layout(forceUpdate = false) {
		this.#layout(forceUpdate);
	}

	#rootNode(element) {
		const node = new DOMLayoutNode(element);
		node.context = this.#flowContext;
		return node;
	}

	/**
	 * Internal sync initialization.
	 */
	#layout(forceUpdate = false) {
		if (this.#tree && this.#measureElement && !forceUpdate) return;
		const content = this.#content;
		const styles = this.#styles;

		if (this.#measurer instanceof NullMeasurer) {
			// A pre-built tree has no source DOM to re-derive itself from, so
			// there is nothing to rebuild — just restore the stepper's state.
			this.#tree = content;
			this.#measureElement = { applyConstraintSpace: () => {} };
			return;
		}
		if (this.#tree && !this.#measureElement && this.#measurer) {
			// Measurer was released — reattach it without rebuilding the tree.
			// The tree's DOMLayoutNode wrappers still reference the same
			// element objects; moving them back into the measurer restores
			// live measurement capability.
			const contentRoot = this.#measurer.reattach();
			this.#measureElement = { applyConstraintSpace: () => {} };
			this.#contentStyles = this.#measurer.getContentStyles();
			if (forceUpdate) {
				this.#tree = this.#rootNode(contentRoot);
			}
			const initialChildren = this.#measurer.initialChildren;
			if (initialChildren) {
				this.#tree.setChildren(initialChildren);
			}
			return;
		}

		if (this.#measureElement) {
			// Rebuild layout tree from existing measurer (content already injected)
			this.#tree = this.#rootNode(this.#measureElement.contentRoot);
		} else if (typeof DocumentFragment !== "undefined" && content instanceof DocumentFragment) {
			// Delegate to the Measurer class, which handles segmented
			// measurement when top-level children have forced breaks.
			// For page-based flows, prepend UA defaults (body margin)
			// so the slot matches the browser's body element.
			this.#isPageBased =
				this.#resolver instanceof PageResolver || (!this.#resolver && !this.#constraintSpace);
			const layoutStyles = this.#isPageBased ? [UA_DEFAULTS, ...styles] : styles;
			// Set target devicePixelRatio before handlers init and measurement.
			// Explicit option overrides window.devicePixelRatio.
			if (this.#options.devicePixelRatio != null) {
				setTargetDevicePixelRatio(this.#options.devicePixelRatio);
			}
			this.#flowContext.handlers.init({ ...this.#options, isPageBased: this.#isPageBased });
			this.#flowContext.cloneMap.clear();
			this.#measurer = new Measurer(content, layoutStyles, this.#flowContext);
			// Pass the known constraint (set for explicit-size / constraintSpace
			// flows) so measurement reflows at the real width, not 0px.
			// Resolver-based @page flows resolve width per fragment, so it stays null.
			const contentRoot = this.#measurer.setup(this.#constraintSpace);

			this.#tree = this.#rootNode(contentRoot);
			this.#measureElement = { applyConstraintSpace: () => {} };
			this.#contentStyles = this.#measurer.getContentStyles();
			this.#installStyleSheet();

			// If segmented, override root's children with the first segment
			const initialChildren = this.#measurer.initialChildren;
			if (initialChildren) {
				this.#tree.setChildren(initialChildren);
			}

			// Auto-create resolver from @page rules in styles if neither set
			if (!this.#resolver && !this.#constraintSpace) {
				this.#resolver = PageResolver.fromStyleSheets(styles);
			}
		} else {
			// A pre-built layout tree (createFragments, unit tests). Nothing to
			// measure, so the flow drives a NullMeasurer and composes nothing.
			this.#tree = content;
			this.#tree.context = this.#flowContext;
			this.#measurer = new NullMeasurer(content);
			this.#measureElement = { applyConstraintSpace: () => {} };
		}

		this.#counterState = new CounterState();
	}

	/**
	 * Preload fonts and images before layout.
	 *
	 * Optional — call before iterating if you need fonts and images
	 * to be fully loaded for accurate measurement.
	 *
	 * @param {{ signal?: AbortSignal, timeout?: number }} [options]
	 * @returns {Promise<void>}
	 */
	async preload(options = {}) {
		await Promise.all([this.preloadFonts(options), this.preloadImages(options)]);
	}

	/**
	 * Preload fonts declared in the content stylesheets.
	 * Registers @font-face rules from this.#styles into document.fonts
	 * so they load without needing the measurer in the DOM.
	 *
	 * @param {{ signal?: AbortSignal, timeout?: number }} [options]
	 * @returns {Promise<string[]>}
	 */
	preloadFonts(options = {}) {
		const styles = this.#styles;
		const families = new Set();
		const addFamilies = (value) => {
			if (!value) return;
			for (const part of value.split(",")) {
				const family = normalizeFontFamily(part);
				if (family) families.add(family);
			}
		};
		for (const sheet of styles) {
			let rules;
			try {
				rules = sheet.cssRules;
			} catch {
				continue;
			}
			for (const rule of rules) {
				if (rule instanceof CSSFontFaceRule) {
					const family = rule.style.getPropertyValue("font-family");
					const src = rule.style.getPropertyValue("src");
					if (!family || !src) continue;
					addFamilies(family);
					try {
						const face = new FontFace(family, src, {
							style: rule.style.getPropertyValue("font-style") || undefined,
							weight: rule.style.getPropertyValue("font-weight") || undefined,
							display: "block",
						});
						this.#fontDisplayEdits.push({
							style: rule.style,
							fontDisplay: rule.style.getPropertyValue("font-display"),
						});
						rule.style.setProperty("font-display", "block");
						document.fonts.add(face);
						this.#preloadedFonts.push(face);
					} catch {
						// Invalid src or already registered
					}
				} else if (rule.style) {
					addFamilies(rule.style.getPropertyValue("font-family"));
				}
			}
		}

		const signal = preloadSignal(options);
		const promises = [];
		document.fonts.forEach((fontFace) => {
			if (fontFace.status !== "loaded" && families.has(normalizeFontFamily(fontFace.family))) {
				promises.push(
					abortable(fontFace.load(), signal).then(
						() => fontFace.family,
						() => fontFace.family,
					),
				);
			}
		});
		return Promise.all(promises);
	}

	/**
	 * Preload images in the content that don't have explicit dimensions.
	 * Works on a detached DocumentFragment — uses Image() objects to
	 * trigger loading. Removes images that fail to load.
	 *
	 * @param {{ signal?: AbortSignal, timeout?: number }} [options]
	 * @returns {Promise<void[]>}
	 */
	preloadImages(options = {}) {
		const images = this.#content.querySelectorAll("img:not([width][height])");
		const signal = preloadSignal(options);
		const promises = [];
		for (const img of images) {
			if (img.complete && img.naturalWidth > 0) continue;
			promises.push(loadImageProbe(img, signal));
		}
		return Promise.all(promises);
	}

	/**
	 * Release the measurement container, moving content back to a
	 * detached DocumentFragment. The measurer is removed from the DOM
	 * but the source elements remain accessible (for MutationSync).
	 *
	 * Call after composition is complete. If reflow() is called later,
	 * layout() recreates the measurer from the saved fragment.
	 */
	releaseMeasurer() {
		if (!this.#measurer) return;
		const result = this.#measurer.release();
		this.#content = result.content;
		this.#measureElement = null;
	}

	/**
	 * The content root for source DOM access.
	 * Returns the measurer's contentRoot if alive, or the detached
	 * DocumentFragment if the measurer has been released.
	 */
	get contentRoot() {
		if (this.#measurer?.contentRoot) {
			return this.#measurer.contentRoot;
		}
		return this.#content;
	}

	/**
	 * Clean up the internal measurement container.
	 * Call when the layout is no longer needed.
	 */
	destroy() {
		if (this.#measurer) {
			const result = this.#measurer.release();
			this.#content = result.content;
			this.#measurer = null;
		}
		this.#measureElement = null;
		this.#flowContext.handlers.destroy();
		this.#teardownStyleSheet();

		for (const face of this.#preloadedFonts) {
			document.fonts.delete(face);
		}
		this.#preloadedFonts.length = 0;

		// Restore in reverse so repeated preloads unwind to the original value
		for (let i = this.#fontDisplayEdits.length - 1; i >= 0; i--) {
			const { style, fontDisplay } = this.#fontDisplayEdits[i];
			if (fontDisplay) {
				style.setProperty("font-display", fontDisplay);
			} else {
				style.removeProperty("font-display");
			}
		}
		this.#fontDisplayEdits.length = 0;

		if (this.#adoptedSheets.length > 0) {
			document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
				(sheet) => !this.#adoptedSheets.includes(sheet),
			);
			this.#adoptedSheets.length = 0;
		}

		// Release retained layout state so a destroyed flow doesn't pin fragment
		// trees and the layout node graph in memory.
		this.#fragments = [];
		this.#tree = null;
		this.#prevFragment = null;
		this.#context = null;
	}

	/**
	 * Normalize styles into an array, and adopt any CSSStyleSheet entries that
	 * aren't already on adopted.
	 *
	 * @param {CSSStyleSheet|CSSStyleSheet[]} styles
	 * @returns {CSSStyleSheet[]}
	 */
	#adoptStyles(styles) {
		const sheets = Array.isArray(styles) ? styles : [styles];
		for (const sheet of sheets) {
			if (sheet instanceof CSSStyleSheet) {
				if (!document.adoptedStyleSheets.includes(sheet)) {
					document.adoptedStyleSheets.push(sheet);
					this.#adoptedSheets.push(sheet);
				}
			} else if (sheet instanceof CSSRule) {
				const parent = sheet.parentStyleSheet;
				if (parent && !document.adoptedStyleSheets.includes(parent)) {
					document.adoptedStyleSheets.push(parent);
					this.#adoptedSheets.push(parent);
				}
			}
		}
		return sheets;
	}

	/**
	 * Append the composite scoped CSS as a rule on the output sheet. When the
	 * caller supplied a sheet via `options.styleSheet`, the engine coexists
	 * with whatever other rules are there. Otherwise the flow creates a sheet
	 * and adopts it on `document.adoptedStyleSheets`. Reflow replaces the
	 * previously-installed composite rule.
	 */
	#installStyleSheet() {
		const text = buildCompositeText(
			this.#contentStyles,
			this.#flowContext.handlers.getAdoptedSheets(),
			this.#flowContext.handlers.getInjectedSheet(),
			{ isPageBased: this.#isPageBased },
		);
		if (!this.#styleSheet) {
			this.#styleSheet = new CSSStyleSheet();
			this.#ownsStyleSheet = true;
			document.adoptedStyleSheets.push(this.#styleSheet);
		}
		// Replace the previously-installed composite rule rather than appending,
		// so segment re-installs refresh the data-refs without duplicating rules
		// (also bounds the rule count across segments rather than growing it).
		if (
			this.#compositeRuleIndex != null &&
			this.#compositeRuleIndex < this.#styleSheet.cssRules.length
		) {
			this.#styleSheet.deleteRule(this.#compositeRuleIndex);
		}
		this.#compositeRuleIndex = this.#styleSheet.cssRules.length;
		this.#styleSheet.insertRule(text, this.#compositeRuleIndex);
	}

	#teardownStyleSheet() {
		this.#compositeRuleIndex = null;
		if (!this.#styleSheet || !this.#ownsStyleSheet) return;
		document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== this.#styleSheet);
		this.#styleSheet = null;
		this.#ownsStyleSheet = false;
	}
}
