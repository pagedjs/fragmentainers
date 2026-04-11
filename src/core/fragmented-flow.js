import { DOMLayoutNode } from "../dom/layout-node.js";
import { runLayoutGenerator, getLayoutAlgorithm } from "./layout-request.js";
import { FragmentationContext } from "./fragmentation-context.js";
import { PageResolver } from "../atpage/page-resolver.js";
import { CounterState, walkFragmentTree } from "./counter-state.js";
import { ConstraintSpace } from "./constraint-space.js";
import { Fragment } from "./fragment.js";
import { FRAGMENTATION_COLUMN } from "./constants.js";
import {
	resolveForcedBreakValue,
	resolveNextPageBreakBefore,
	requiredPageSide,
	isSideSpecificBreak,
} from "../atpage/page-resolver.js";
import "../dom/content-measure.js";
import "../dom/fragment-container.js";
import { Measurer } from "../dom/measure.js";
import { modules } from "../modules/registry.js";
import { UA_DEFAULTS } from "../styles/ua-defaults.js";
import "../modules/index.js";

function buildLayoutTree(rootElement) {
	return new DOMLayoutNode(rootElement);
}

const MAX_ZERO_PROGRESS = 5;

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
	 * Register a layout module class globally.
	 * @param {typeof import('../modules/module.js').LayoutModule} ModuleClass
	 */
	static register(ModuleClass) {
		modules.register(ModuleClass);
	}

	/**
	 * Unregister a layout module class.
	 * @param {typeof import('../modules/module.js').LayoutModule} ModuleClass
	 */
	static remove(ModuleClass) {
		modules.remove(ModuleClass);
	}

	/**
	 * Return the current instance of a registered module class.
	 * @param {typeof import('../modules/module.js').LayoutModule} ModuleClass
	 * @returns {import('../modules/module.js').LayoutModule|null}
	 */
	static getModule(ModuleClass) {
		return modules.get(ModuleClass);
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
	#fragmentainerIndex = 0;
	#counterState = null;
	#contentStyles = null;
	#prevFragment = null;
	#fragments = [];

	// Iterator state
	#context = null;
	#done = false;
	#zeroProgressCount = 0;

	/**
	 * @param {DocumentFragment|Element|object} content - Content to fragment
	 * @param {object} [options]
	 * @param {CSSStyleSheet[]} [options.styles] - Stylesheets (copies document.styleSheets if omitted)
	 * @param {ConstraintSpace} [options.constraintSpace] - Direct constraint space (bypasses @page rules)
	 * @param {PageResolver|RegionResolver} [options.resolver] - Pre-configured resolver
	 * @param {number} [options.width] - Container width in CSS px (column fragmentation)
	 * @param {number} [options.height] - Container height in CSS px (column fragmentation)
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
		} else {
			this.#styles = [...document.adoptedStyleSheets];
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
			this.#context = new FragmentationContext(this.#fragments, this.#contentStyles, {
				adoptedSheets: modules.getAdoptedSheets(),
			});
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

		// Check if this is the last fragment
		if (fragment.breakToken === null && !fragment.isBlank) {
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
		} while (fragment.breakToken !== null || fragment.isBlank);

		fragment.isLast = true;

		// Layout is done — release the measurer. Composition only needs
		// cloneNode/getAttribute/tagName, which work on detached elements.
		this.releaseMeasurer();

		return new FragmentationContext([...this.#fragments], this.#contentStyles, {
			start,
			stop,
			adoptedSheets: modules.getAdoptedSheets(),
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
		} while (fragment.breakToken !== null || fragment.isBlank);

		fragment.isLast = true;

		// Layout is done — release the measurer before composition.
		this.releaseMeasurer();

		return new FragmentationContext(newFragments, this.#contentStyles, {
			adoptedSheets: modules.getAdoptedSheets(),
		});
	}

	/**
	 * Lay out one fragmentainer with two-pass earlyBreak support
	 * and iterative post-layout adjustment.
	 *
	 * After content layout, modules.afterContentLayout() is called.
	 * If any module requests a different block-end reservation than
	 * what was used, layout is re-run with the updated constraint
	 * space. This repeats until the reservation stabilises or the
	 * iteration limit is reached.
	 */
	#layoutFragmentainer(rootNode, constraintSpace, breakToken) {
		const rootAlgorithm = getLayoutAlgorithm(rootNode);

		const layoutChildFn = (child, cs) => {
			const algo = getLayoutAlgorithm(child);
			return runLayoutGenerator(algo, child, cs, null);
		};
		const { reservedBlockStart, reservedBlockEnd, afterRenderCallbacks } = modules.layout(
			rootNode,
			constraintSpace,
			breakToken,
			layoutChildFn,
		);

		const MAX_POST_LAYOUT_ITERATIONS = 3;
		let postLayoutReserved = 0;
		let postLayoutCallbacks = [];
		let result;

		for (let iter = 0; iter <= MAX_POST_LAYOUT_ITERATIONS; iter++) {
			const totalReservedEnd = reservedBlockEnd + postLayoutReserved;
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

			result = runLayoutGenerator(rootAlgorithm, rootNode, adjustedSpace, breakToken);
			if (result.earlyBreak) {
				result = runLayoutGenerator(
					rootAlgorithm,
					rootNode,
					adjustedSpace,
					breakToken,
					result.earlyBreak,
				);
			}

			const adjustment = modules.afterContentLayout(result.fragment, constraintSpace, breakToken);
			if (!adjustment || adjustment.reservedBlockEnd === postLayoutReserved) {
				if (adjustment?.afterRenderCallbacks.length > 0) {
					postLayoutCallbacks = adjustment.afterRenderCallbacks;
				}
				break;
			}
			postLayoutReserved = adjustment.reservedBlockEnd;
			postLayoutCallbacks = adjustment.afterRenderCallbacks;
		}

		const allCallbacks = [...afterRenderCallbacks, ...postLayoutCallbacks];
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
				const isLeft = this.#resolver.isLeftPage(this.#fragmentainerIndex);
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
				this.#tree = buildLayoutTree(measurer.contentRoot);
			}
			return;
		}

		if (this.#measureElement) {
			// Rebuild layout tree from existing measurer (content already injected)
			this.#tree = buildLayoutTree(this.#measureElement.contentRoot);
		} else if (typeof DocumentFragment !== "undefined" && content instanceof DocumentFragment) {
			// Delegate to the Measurer class, which handles segmented
			// measurement when top-level children have forced breaks.
			// For page-based flows, prepend UA defaults (body margin)
			// so the slot matches the browser's body element.
			const isPageBased =
				this.#resolver instanceof PageResolver || (!this.#resolver && !this.#constraintSpace);
			const layoutStyles = isPageBased ? [UA_DEFAULTS, ...styles] : styles;
			modules.init(this.#options);
			this.#measurer = new Measurer(content, layoutStyles);
			const contentRoot = this.#measurer.setup();

			this.#tree = buildLayoutTree(contentRoot);
			this.#measureElement = { applyConstraintSpace: () => {} };
			this.#contentStyles = this.#measurer.getContentStyles();

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
		this.#measureElement?.remove();
		this.#measureElement = null;
	}
}
