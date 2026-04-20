import { DOMLayoutNode } from "../layout/layout-node.js";
import { runLayoutGenerator, getLayoutAlgorithm } from "../layout/layout-driver.js";
import { FragmentationContext } from "./fragmentation-context.js";
import { PageResolver } from "../resolvers/page-resolver.js";
import { CounterState, walkFragmentTree } from "./counter-state.js";
import { ConstraintSpace } from "./constraint-space.js";
import { Fragment } from "./fragment.js";
import { FRAGMENTATION_COLUMN } from "./constraint-space.js";
import {
	resolveForcedBreakValue,
	resolveNextPageBreakBefore,
	requiredPageSide,
	isSideSpecificBreak,
} from "../resolvers/page-resolver.js";
import "../components/content-measure.js";
import "../components/fragment-container.js";
import { Measurer } from "../measurement/measure.js";
import { setTargetDevicePixelRatio } from "../measurement/line-box.js";
import { handlers } from "../handlers/registry.js";
import { UA_DEFAULTS } from "../styles/ua-defaults.js";
import { buildCompositeSheet } from "../styles/composite-sheet.js";
import "../handlers/index.js";

const MAX_ZERO_PROGRESS = 5;

/**
 * Walk the layout tree for the deepest DOMLayoutNode whose element
 * contains `target`. Sets `breakBefore = "page"` on it so the next
 * main-flow iteration pushes that block to the next page. Returns
 * true when a push was actually applied.
 *
 * `target` may be a LayoutNode (with `.element`) or an Element.
 */
function pushBlockAncestorToNextPage(rootNode, target) {
	const targetEl = target instanceof Element ? target : (target?.element ?? null);
	if (!targetEl) return false;
	const ancestor = findBlockAncestor(rootNode, targetEl);
	if (!ancestor || ancestor.breakBefore === "page") return false;
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
 * A fragmented flow — iterates over content, producing one
 * <fragment-container> element per fragmentainer.
 *
 * Extends Iterator so instances are directly usable in for-of:
 *
 *   const flow = new FragmentedFlow(content, { width: 400, height: 600 });
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
export class FragmentedFlow extends Iterator {
	/**
	 * Register a layout handler class globally.
	 * @param {typeof import('../handlers/handler.js').LayoutHandler} HandlerClass
	 */
	static register(HandlerClass) {
		handlers.register(HandlerClass);
	}

	/**
	 * Unregister a layout handler class.
	 * @param {typeof import('../handlers/handler.js').LayoutHandler} HandlerClass
	 */
	static remove(HandlerClass) {
		handlers.remove(HandlerClass);
	}

	/**
	 * Return the current instance of a registered handler class.
	 * @param {typeof import('../handlers/handler.js').LayoutHandler} HandlerClass
	 * @returns {import('../handlers/handler.js').LayoutHandler|null}
	 */
	static getHandler(HandlerClass) {
		return handlers.get(HandlerClass);
	}

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
	#contentStyles = null;
	#prevFragment = null;
	#fragments = [];
	#docSheet = null;

	// Iterator state
	#context = null;
	#done = false;
	#zeroProgressCount = 0;

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
	 */
	constructor(content, options = {}) {
		super();
		this.#options = options;

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
		for (const img of this.#content.querySelectorAll("img[width][height]")) {
			img.setAttribute("loading", "lazy");
		}

		if (options.styles) {
			this.#styles = Array.isArray(options.styles) ? options.styles : [options.styles];
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
		// Page resolver auto-created in layout() from styles if neither set
	}

	/**
	 * Lay out the next fragmentainer and return an iterator result.
	 *
	 * Returns `{ value: <fragment-container>, done: false }` for each
	 * fragmentainer, and `{ value: undefined, done: true }` when all
	 * content has been placed.
	 *
	 * @returns {{ value: Element|undefined, done: boolean }}
	 */
	next() {
		// Lazy initialization
		if (!this.#tree) this.#layout();

		// Already exhausted
		if (this.#done) return { value: undefined, done: true };

		// Initialize context on first call
		if (!this.#context) {
			this.#context = new FragmentationContext(this.#fragments, this.#contentStyles);
		}

		const fragment = this.#nextFragment();

		if (this.#fragments.length === 1) {
			fragment.isFirst = true;
		}

		// Segment advancement (sync)
		if (this.#measurer) {
			this.#measurer.advance(fragment.breakToken, this.#tree);
		}

		// Zero-progress guard
		if (fragment.breakToken && fragment.blockSize === 0 && !fragment.isBlank) {
			this.#zeroProgressCount++;
			if (this.#zeroProgressCount >= MAX_ZERO_PROGRESS) {
				console.warn(
					`FragmentedFlow: stopped after ${MAX_ZERO_PROGRESS} consecutive zero-progress fragmentainers`,
				);
				this.#done = true;
			}
		} else {
			this.#zeroProgressCount = 0;
		}

		// Check if this is the last fragment. Main-flow completion is tracked
		// separately from overall completion because parallel flows may
		// emit additional pages to drain their carryover.
		if (fragment.breakToken === null) this.#mainDone = true;
		const pendingFlow = handlers.getFlows().some(({ flow }) => flow.breakToken !== null);
		if (fragment.breakToken === null && !pendingFlow && !fragment.isBlank) {
			this.#done = true;
			fragment.isLast = true;
		}

		// Create element and push to internal context (if contentStyles available)
		let el;
		if (this.#contentStyles) {
			el = this.#context.createFragmentainer(this.#fragments.length - 1);
			this.#context.push(el);
		}

		if (this.#done) this.releaseMeasurer();

		return { value: el ?? fragment, done: false };
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

		let zeroProgressCount = 0;
		let fragment;

		do {
			fragment = this.#nextFragment();

			if (this.#fragments.length === 1) {
				fragment.isFirst = true;
			}

			if (fragment.breakToken && fragment.blockSize === 0 && !fragment.isBlank) {
				zeroProgressCount++;
				if (zeroProgressCount >= MAX_ZERO_PROGRESS) {
					console.warn(
						`FragmentedFlow: stopped after ${MAX_ZERO_PROGRESS} consecutive zero-progress fragmentainers`,
					);
					break;
				}
			} else {
				zeroProgressCount = 0;
			}

			// Let the measurer swap to the next segment if at a boundary
			if (this.#measurer) {
				this.#measurer.advance(fragment.breakToken, this.#tree);
			}
		} while (
			fragment.breakToken !== null ||
			fragment.isBlank ||
			handlers.getFlows().some(({ flow }) => flow.breakToken !== null)
		);

		fragment.isLast = true;

		// Layout is done — release the measurer. Composition only needs
		// cloneNode/getAttribute/tagName, which work on detached elements.
		this.releaseMeasurer();

		return new FragmentationContext([...this.#fragments], this.#contentStyles, {
			start,
			stop,
		});
	}

	/**
	 * Re-layout from a specific fragmentainer and return a new FragmentationContext.
	 *
	 * Resets the layout stepper to the break token before `fromIndex`,
	 * re-runs layout to completion with live measurements, and returns
	 * a new FragmentationContext containing the new fragments and elements.
	 *
	 * @param {number} [fromIndex=0] - Fragmentainer index to restart from
	 * @param {Object} [options]
	 * @param {boolean} [options.rebuild=false] - Rebuild the layout tree from source DOM
	 * @returns {FragmentationContext}
	 */
	reflow(fromIndex = 0, { rebuild = false } = {}) {
		if (rebuild) {
			this.#tree = null;
			this.#layout(true);
		} else {
			this.#layout();
		}
		const prev = fromIndex > 0 ? this.#fragments[fromIndex - 1] : null;
		this.#breakToken = prev?.breakToken ?? null;
		this.#fragmentainerIndex = fromIndex;
		this.#prevFragment = null;
		this.#counterState = new CounterState();
		if (prev?.counterState) {
			this.#counterState.restore(prev.counterState);
		}
		this.#fragments.length = fromIndex;

		// Re-run layout to completion
		const newFragments = [];
		let zeroProgressCount = 0;
		let fragment;
		do {
			fragment = this.#nextFragment();
			newFragments.push(fragment);

			if (this.#fragments.length === 1) {
				fragment.isFirst = true;
			}

			if (fragment.breakToken && fragment.blockSize === 0 && !fragment.isBlank) {
				if (++zeroProgressCount >= MAX_ZERO_PROGRESS) break;
			} else {
				zeroProgressCount = 0;
			}

			if (this.#measurer) {
				this.#measurer.advance(fragment.breakToken, this.#tree);
			}
		} while (
			fragment.breakToken !== null ||
			fragment.isBlank ||
			handlers.getFlows().some(({ flow }) => flow.breakToken !== null)
		);

		fragment.isLast = true;

		// Layout is done — release the measurer before composition.
		this.releaseMeasurer();

		return new FragmentationContext(newFragments, this.#contentStyles);
	}

	/**
	 * Lay out one fragmentainer with two-pass earlyBreak support
	 * and iterative post-layout adjustment.
	 *
	 * After content layout, handlers.afterContentLayout() is called.
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
			: handlers.layout(rootNode, constraintSpace, breakToken, layoutChildFn);

		const MAX_POST_LAYOUT_ITERATIONS = 3;
		const flowEntries = handlers.getFlows();
		const flowReservations = flowEntries.map(() => 0);
		let flowFragments = flowEntries.map(() => null);
		let flowInputTokens = flowEntries.map(() => null);
		let postLayoutReserved = 0;
		let postLayoutCallbacks = [];
		let result;

		for (let iter = 0; iter <= MAX_POST_LAYOUT_ITERATIONS; iter++) {
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

			const adjustment = handlers.afterContentLayout(result.fragment, constraintSpace, breakToken);
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
						if (pushBlockAncestorToNextPage(rootNode, el)) pushedForward = true;
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
					const pushed = pushBlockAncestorToNextPage(rootNode, flowResult.rejectedNode);
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

			const settled =
				flowsSettled && !pushedForward && legacyReserved === postLayoutReserved;
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
		if (this.#resolver) {
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

		// First page: carry body margin for collapsing with first child
		if (!this.#breakToken && this.#tree.marginBlockStart) {
			constraintSpace.bodyMarginBlockStart = this.#tree.marginBlockStart;
		}

		// Sync DOM measurement container
		if (this.#measurer) {
			this.#measurer.applyConstraintSpace(constraintSpace);
		} else if (this.#measureElement) {
			this.#measureElement.applyConstraintSpace(constraintSpace);
		}

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

		// Counter state accumulation
		const prevBT = this.#prevFragment?.breakToken ?? null;
		walkFragmentTree(result.fragment, prevBT, this.#counterState);
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

	/**
	 * Internal sync initialization.
	 */
	#layout(forceUpdate = false) {
		if (this.#tree && this.#measureElement && !forceUpdate) return;
		const content = this.#content;
		const styles = this.#styles;
		if (
			this.#tree &&
			!this.#measureElement &&
			typeof DocumentFragment !== "undefined" &&
			content instanceof DocumentFragment
		) {
			// Measurer was released — recreate it without rebuilding tree.
			// The tree's DOMLayoutNode wrappers still reference the same
			// element objects; moving them back into the measurer restores
			// live measurement capability.
			const isPageBased =
				this.#resolver instanceof PageResolver || (!this.#resolver && !this.#constraintSpace);
			const layoutStyles = isPageBased ? [UA_DEFAULTS, ...styles] : styles;
			const measurer = document.createElement("content-measure");
			measurer.injectFragment(content, layoutStyles);
			document.body.appendChild(measurer);
			void measurer.offsetHeight;
			this.#measureElement = measurer;
			this.#contentStyles = measurer.getContentStyles();
			if (forceUpdate) {
				this.#tree = new DOMLayoutNode(measurer.contentRoot);
			}
			return;
		}

		if (this.#measureElement) {
			// Rebuild layout tree from existing measurer (content already injected)
			this.#tree = new DOMLayoutNode(this.#measureElement.contentRoot);
		} else if (typeof DocumentFragment !== "undefined" && content instanceof DocumentFragment) {
			// Delegate to the Measurer class, which handles segmented
			// measurement when top-level children have forced breaks.
			// For page-based flows, prepend UA defaults (body margin)
			// so the slot matches the browser's body element.
			const isPageBased =
				this.#resolver instanceof PageResolver || (!this.#resolver && !this.#constraintSpace);
			const layoutStyles = isPageBased ? [UA_DEFAULTS, ...styles] : styles;
			// Set target devicePixelRatio before handlers init and measurement.
			// Explicit option overrides window.devicePixelRatio.
			if (this.#options.devicePixelRatio != null) {
				setTargetDevicePixelRatio(this.#options.devicePixelRatio);
			}
			handlers.init({ ...this.#options, isPageBased });
			this.#measurer = new Measurer(content, layoutStyles);
			const contentRoot = this.#measurer.setup();

			this.#tree = new DOMLayoutNode(contentRoot);
			this.#measureElement = { applyConstraintSpace: () => {} };
			this.#contentStyles = this.#measurer.getContentStyles();
			this.#installDocSheet();

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
			// Mock node (unit tests)
			this.#tree = content;
		}

		this.#counterState = new CounterState();
	}

	/**
	 * Preload fonts and images before layout.
	 *
	 * Optional — call before iterating if you need fonts and images
	 * to be fully loaded for accurate measurement.
	 *
	 * @returns {Promise<void>}
	 */
	async preload() {
		await Promise.all([this.preloadFonts(), this.preloadImages()]);
	}

	/**
	 * Preload fonts declared in the content stylesheets.
	 * Registers @font-face rules from this.#styles into document.fonts
	 * so they load without needing the measurer in the DOM.
	 * @returns {Promise<string[]>}
	 */
	preloadFonts() {
		const styles = this.#styles;
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
					try {
						const face = new FontFace(family, src, {
							style: rule.style.getPropertyValue("font-style") || undefined,
							weight: rule.style.getPropertyValue("font-weight") || undefined,
							display: "block",
						});
						rule.style.setProperty("font-display", "block");
						document.fonts.add(face);
					} catch {
						// Invalid src or already registered
					}
				}
			}
		}

		const promises = [];
		document.fonts.forEach((fontFace) => {
			if (fontFace.status !== "loaded") {
				promises.push(
					fontFace.load().then(
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
	 * @returns {Promise<void[]>}
	 */
	preloadImages() {
		const images = this.#content.querySelectorAll("img:not([width][height])");
		const promises = [];
		for (const img of images) {
			if (img.complete && img.naturalWidth > 0) continue;
			promises.push(
				new Promise((resolve) => {
					const probe = new Image();
					probe.onload = () => {
						img.width = probe.naturalWidth;
						img.height = probe.naturalHeight;
						resolve();
					};
					probe.onerror = () => {
						img.remove();
						resolve();
					};
					probe.src = img.src;
				}),
			);
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
		if (this.#measurer) {
			const result = this.#measurer.release();
			this.#content = result.content;
			this.#measureElement = null;
			return;
		}

		if (!this.#measureElement) return;

		// Move content from slot back to a DocumentFragment.
		// The tree is preserved — DOMLayoutNode wrappers still reference
		// the same element objects, and break tokens remain valid.
		const frag = document.createDocumentFragment();
		const slot = this.#measureElement.contentRoot;
		while (slot.firstChild) {
			frag.appendChild(slot.firstChild);
		}
		this.#content = frag;

		this.#measureElement.remove();
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
		if (this.#measureElement) {
			return this.#measureElement.contentRoot;
		}
		return this.#content;
	}

	/**
	 * Clean up the internal measurement container.
	 * Call when the layout is no longer needed.
	 */
	destroy() {
		if (this.#measurer?.isActive) {
			this.#measurer.release();
			this.#measurer = null;
		}
		// Mock-node path stubs #measureElement with a plain object, so guard remove().
		if (typeof this.#measureElement?.remove === "function") {
			this.#measureElement.remove();
		}
		this.#measureElement = null;
		this.#removeDocSheet();
	}

	/**
	 * Build the document-level scoped stylesheet from contentStyles +
	 * per-flow handler sheets, and adopt it on `document.adoptedStyleSheets`.
	 * Idempotent — replaces any previously installed sheet.
	 */
	#installDocSheet() {
		this.#removeDocSheet();
		this.#docSheet = buildCompositeSheet(
			this.#contentStyles,
			handlers.getAdoptedSheets(),
			handlers.getInjectedSheet(),
		);
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.#docSheet];
	}

	#removeDocSheet() {
		if (!this.#docSheet) return;
		document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
			(s) => s !== this.#docSheet,
		);
		this.#docSheet = null;
	}
}
