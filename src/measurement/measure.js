import { DOMLayoutNode } from "../layout/layout-node.js";
import { isForcedBreakValue } from "../fragmentation/tokens.js";
import { handlers } from "../handlers/registry.js";
import { splitSelectorList } from "../styles/selector-utils.js";
import { walkSheets, wrappersActive } from "../styles/walk-rules.js";
import "../components/content-measure.js";

export {
	measureElementBlockSize,
	measureElementInlineSize,
	measureCellIntrinsicBlockSize,
} from "./block-size.js";

function compareSpecificity(a, b) {
	if (a[0] !== b[0]) return a[0] - b[0];
	if (a[1] !== b[1]) return a[1] - b[1];
	return a[2] - b[2];
}

/**
 * Approximate CSS Selectors L4 §17 specificity as [a,b,c] for one complex
 * selector (no top-level comma). a = #id, b = .class/[attr]/:pseudo-class,
 * c = type/::pseudo-element. :where() contributes 0; :is()/:not()/:has()
 * contribute their most-specific argument. Used to order measure-time cascade
 * matches for detached elements where getComputedStyle is unavailable.
 */
function selectorSpecificity(selector) {
	const spec = [0, 0, 0];
	let s = selector;
	const fnRe = /:(is|where|not|has)\(/i;
	let m;
	while ((m = fnRe.exec(s)) !== null) {
		const name = m[1].toLowerCase();
		const open = m.index + m[0].length - 1;
		let depth = 1;
		let j = open + 1;
		for (; j < s.length && depth > 0; j++) {
			if (s[j] === "(") depth++;
			else if (s[j] === ")") depth--;
		}
		const inner = s.slice(open + 1, j - 1);
		if (name !== "where") {
			let best = [0, 0, 0];
			for (const arg of splitSelectorList(inner)) {
				const a = selectorSpecificity(arg);
				if (compareSpecificity(a, best) > 0) best = a;
			}
			spec[0] += best[0];
			spec[1] += best[1];
			spec[2] += best[2];
		}
		s = `${s.slice(0, m.index)} ${s.slice(j)}`;
	}
	s = s.replace(/\s*[>+~]\s*/g, " ");
	spec[0] += (s.match(/#[\w-]+/g) || []).length;
	s = s.replace(/#[\w-]+/g, " ");
	spec[1] += (s.match(/\.[\w-]+/g) || []).length;
	s = s.replace(/\.[\w-]+/g, " ");
	spec[1] += (s.match(/\[[^\]]*\]/g) || []).length;
	s = s.replace(/\[[^\]]*\]/g, " ");
	spec[2] += (s.match(/::[\w-]+/g) || []).length;
	s = s.replace(/::[\w-]+/g, " ");
	spec[1] += (s.match(/:[\w-]+(?:\([^)]*\))?/g) || []).length;
	s = s.replace(/:[\w-]+(?:\([^)]*\))?/g, " ");
	spec[2] += (s.match(/[a-zA-Z][\w-]*/g) || []).length;
	return spec;
}

// Ascending cascade order: higher specificity / later source wins (sorts last).
function cascadeLess(x, y) {
	const c = compareSpecificity(x.spec, y.spec);
	if (c !== 0) return c;
	return x.order - y.order;
}

/**
 * Resolve break-before, break-after, and page values for top-level
 * elements by walking CSSStyleSheet rules and matching selectors.
 * Works on elements in a DocumentFragment (no live DOM needed).
 *
 * @param {Element[]} elements — top-level child elements
 * @param {CSSStyleSheet[]} styles — adopted stylesheets
 * @returns {{ breakBefore: string, breakAfter: string, page: string|null }[]}
 */
function resolveBreakProperties(elements, styles) {
	const breakRules = [];
	let order = 0;
	walkSheets(styles, (rule, wrappers) => {
		if (!rule.style || !rule.selectorText) return;
		if (!wrappersActive(wrappers)) return;
		const st = rule.style;
		const bb = st.getPropertyValue("break-before").trim();
		const ba = st.getPropertyValue("break-after").trim();
		const pg = st.getPropertyValue("page").trim();
		if (!bb && !ba && !pg) return;
		for (const selector of splitSelectorList(rule.selectorText)) {
			breakRules.push({
				selector,
				spec: selectorSpecificity(selector),
				order: order++,
				breakBefore: bb,
				breakAfter: ba,
				page: pg,
				bbImp: st.getPropertyPriority("break-before") === "important",
				baImp: st.getPropertyPriority("break-after") === "important",
				pgImp: st.getPropertyPriority("page") === "important",
			});
		}
	});

	return elements.map((el) => {
		const matched = breakRules.filter((r) => {
			try {
				return el.matches(r.selector);
			} catch {
				return false;
			}
		});
		matched.sort(cascadeLess);

		const inlineBB = el.style.breakBefore;
		const inlineBA = el.style.breakAfter;
		const inlinePG = el.style.page;
		const inlineBBImp = el.style.getPropertyPriority("break-before") === "important";
		const inlineBAImp = el.style.getPropertyPriority("break-after") === "important";
		const inlinePGImp = el.style.getPropertyPriority("page") === "important";

		let breakBefore = "auto";
		let breakAfter = "auto";
		let page = null;
		// Normal-importance cascade (ascending → last wins), then inline normal,
		// then !important cascade, then inline !important — CSS Cascade L4 §6.3.
		for (const r of matched) {
			if (r.breakBefore && !r.bbImp) breakBefore = r.breakBefore;
			if (r.breakAfter && !r.baImp) breakAfter = r.breakAfter;
			if (r.page && !r.pgImp) page = r.page;
		}
		if (inlineBB && !inlineBBImp) breakBefore = inlineBB;
		if (inlineBA && !inlineBAImp) breakAfter = inlineBA;
		if (inlinePG && !inlinePGImp) page = inlinePG;
		for (const r of matched) {
			if (r.breakBefore && r.bbImp) breakBefore = r.breakBefore;
			if (r.breakAfter && r.baImp) breakAfter = r.breakAfter;
			if (r.page && r.pgImp) page = r.page;
		}
		if (inlineBB && inlineBBImp) breakBefore = inlineBB;
		if (inlineBA && inlineBAImp) breakAfter = inlineBA;
		if (inlinePG && inlinePGImp) page = inlinePG;

		if (page === "auto" || !page) page = null;
		return { breakBefore: breakBefore || "auto", breakAfter: breakAfter || "auto", page };
	});
}

/**
 * Resolve effective `display` for elements in a DocumentFragment.
 * getComputedStyle is unreliable off-document, so match rules manually.
 */
function resolveDisplayValues(elements, styles) {
	const displayRules = [];
	let order = 0;
	walkSheets(styles, (rule, wrappers) => {
		if (!rule.style || !rule.selectorText) return;
		if (!wrappersActive(wrappers)) return;
		const d = rule.style.getPropertyValue("display").trim();
		if (!d) return;
		const imp = rule.style.getPropertyPriority("display") === "important";
		for (const selector of splitSelectorList(rule.selectorText)) {
			displayRules.push({ selector, spec: selectorSpecificity(selector), order: order++, display: d, imp });
		}
	});

	return elements.map((el) => {
		const matched = displayRules.filter((r) => {
			try {
				return el.matches(r.selector);
			} catch {
				return false;
			}
		});
		matched.sort(cascadeLess);
		const inlineD = el.style.display;
		const inlineImp = el.style.getPropertyPriority("display") === "important";
		let display = null;
		for (const r of matched) if (!r.imp) display = r.display;
		if (inlineD && !inlineImp) display = inlineD;
		for (const r of matched) if (r.imp) display = r.display;
		if (inlineD && inlineImp) display = inlineD;
		return display;
	});
}

/**
 * Find segment boundaries among top-level children.
 * A segment boundary starts at index i (i > 0) when:
 * - child[i] has forced break-before
 * - child[i-1] has forced break-after
 * - child[i].page !== child[i-1].page (named page change)
 *
 * @param {{ breakBefore: string, breakAfter: string, page: string|null }[]} props
 * @returns {number[]} — start indices of each segment (always starts with 0)
 */
function findSegmentBoundaries(props) {
	const boundaries = [0];
	for (let i = 1; i < props.length; i++) {
		if (
			isForcedBreakValue(props[i].breakBefore) ||
			isForcedBreakValue(props[i - 1].breakAfter) ||
			props[i].page !== props[i - 1].page
		) {
			boundaries.push(i);
		}
	}
	return boundaries;
}

const SKIP_TAGS = new Set(["script", "style", "template"]);
const SKIP_DISPLAYS = new Set(["table-column", "table-column-group", "none"]);

/**
 * Measurer — owns the <content-measure> lifecycle for layout.
 *
 * Handles creating, populating, and destroying measurement containers.
 * When top-level children have forced breaks, splits measurement into
 * segments so the browser only lays out one segment at a time.
 */
export class Measurer {
	#content;
	#styles;

	#measureElement = null;
	#contentStyles = null;
	#segments = null;
	#currentSegment = 0;
	#allElements = null;
	#nodeMap = new Map();
	#allNodes = null;
	#flowElements = null;
	#breakProps = null;
	#persistent = [];
	#finished = null;
	#pending = null;

	/**
	 * @param {DocumentFragment} content
	 * @param {CSSStyleSheet[]} styles
	 */
	constructor(content, styles) {
		this.#content = content;
		this.#styles = styles;
	}

	/**
	 * Initialize measurement. Creates the <content-measure> and prepares
	 * the content for layout. If multiple segments are detected, only the
	 * first segment's content is measured.
	 *
	 * @returns {Element} the content root (slot element)
	 */
	setup(constraintSpace = null) {
		// Walk CSS rules and let handlers accumulate state, then claim elements.
		// The PseudoElements handler contributes ::before/::after companion,
		// relocation, and suppression rules via matchRule/appendRules.
		handlers.processRules(this.#styles);

		this.#persistent = handlers.claimPersistent(this.#content);
		const persistentSet = new Set(this.#persistent);

		// Resolve break properties only for non-persistent elements
		const elements = Array.from(this.#content.children);
		this.#allElements = elements;
		const displays = resolveDisplayValues(elements, this.#styles);
		const flowElements = elements.filter(
			(el, i) => !persistentSet.has(el) && displays[i] !== "none",
		);
		this.#breakProps = resolveBreakProperties(flowElements, this.#styles);
		const boundaries = findSegmentBoundaries(this.#breakProps);

		if (boundaries.length <= 1) {
			return this.#setupSingle(constraintSpace);
		}
		return this.#setupSegmented(boundaries, flowElements, constraintSpace);
	}

	// Apply the target width before the measurement reflow (when known) so the
	// browser lays out once at the real width instead of once at the contained
	// 0px host size and again when the per-fragment width is applied.
	// applyConstraintSpace forces its own reflow, so it replaces the bare one.
	#reflowAtWidth(measurer, constraintSpace) {
		if (constraintSpace) measurer.applyConstraintSpace(constraintSpace);
		else void measurer.offsetHeight;
	}

	#setupSingle(constraintSpace) {
		const measurer = this.#createMeasurer();
		measurer.injectFragment(this.#content, this.#styles);
		document.body.appendChild(measurer);

		// Let handlers mutate the DOM (pseudo-element materialization
		// happens here). Reflow so the changes are reflected in styles.
		handlers.beforeMeasurement(measurer.contentRoot);
		this.#reflowAtWidth(measurer, constraintSpace);

		this.#measureElement = measurer;
		this.#contentStyles = measurer.getContentStyles();

		handlers.afterMeasurementSetup(measurer.contentRoot);

		return measurer.contentRoot;
	}

	#setupSegmented(boundaries, flowElements, constraintSpace) {
		this.#segments = [];
		for (let i = 0; i < boundaries.length; i++) {
			const start = boundaries[i];
			const end = i + 1 < boundaries.length ? boundaries[i + 1] : flowElements.length;
			this.#segments.push({ start, end });
		}

		this.#finished = document.createDocumentFragment();
		this.#pending = document.createDocumentFragment();

		// Build DOMLayoutNode wrappers for all top-level children
		// (both flow and persistent)
		this.#allNodes = [];
		for (const el of this.#allElements) {
			const node = new DOMLayoutNode(el);
			this.#nodeMap.set(el, node);
			this.#allNodes.push(node);
		}

		// #segments indices are into flowElements, not #allElements.
		// Store the flow elements list for segment operations.
		this.#flowElements = flowElements;

		// Set override break/page on all boundary children (lookahead nodes)
		for (let i = 1; i < this.#segments.length; i++) {
			const boundaryIdx = this.#segments[i].start;
			const el = flowElements[boundaryIdx];
			const node = this.#nodeMap.get(el);
			node.breakBefore = this.#breakProps[boundaryIdx].breakBefore;
			node.page = this.#breakProps[boundaryIdx].page;
		}

		// Move non-first-segment flow elements to pending
		const firstEnd = this.#segments[0].end;
		for (let i = flowElements.length - 1; i >= firstEnd; i--) {
			this.#pending.insertBefore(flowElements[i], this.#pending.firstChild);
		}

		// Create measurer with first segment's content (remaining flow
		// elements + persistent elements stay in #content)
		const measurer = this.#createMeasurer();
		measurer.injectFragment(this.#content, this.#styles);

		document.body.appendChild(measurer);

		handlers.beforeMeasurement(measurer.contentRoot);
		this.#reflowAtWidth(measurer, constraintSpace);

		this.#measureElement = measurer;
		this.#contentStyles = measurer.getContentStyles();
		this.#currentSegment = 0;

		handlers.afterMeasurementSetup(measurer.contentRoot);

		return measurer.contentRoot;
	}

	/**
	 * Called after each next() call. If segmented, checks whether the
	 * break token indicates we've reached the segment boundary and
	 * swaps to the next segment's measurer.
	 *
	 * @param {import('../fragmentation/tokens.js').BlockBreakToken|null} breakToken
	 * @param {DOMLayoutNode} tree — root layout node
	 */
	advance(breakToken, tree) {
		if (!this.#segments || this.#currentSegment >= this.#segments.length - 1) return false;
		if (!this.#isAtBoundary(breakToken)) return false;

		this.#currentSegment++;
		const seg = this.#segments[this.#currentSegment];

		// Move completed flow elements from the current measurer to finished.
		// Persistent elements stay — they'll be moved to the new measurer.
		const slot = this.#measureElement.contentRoot;
		const persistentSet = new Set(this.#persistent);
		const toKeep = [];
		while (slot.firstChild) {
			if (persistentSet.has(slot.firstChild)) {
				toKeep.push(slot.firstChild);
				slot.removeChild(slot.firstChild);
			} else {
				this.#finished.appendChild(slot.firstChild);
			}
		}

		// Remove old measurer
		this.#measureElement.remove();

		// Create new measurer with next segment's flow elements + persistent
		const frag = document.createDocumentFragment();
		for (const el of toKeep) {
			frag.appendChild(el);
		}
		for (let i = seg.start; i < seg.end; i++) {
			frag.appendChild(this.#flowElements[i]);
		}

		const measurer = this.#createMeasurer();
		const newSlot = measurer.setupEmpty(this.#styles);
		newSlot.appendChild(frag);

		document.body.appendChild(measurer);

		handlers.beforeMeasurement(newSlot);
		void measurer.offsetHeight;

		this.#measureElement = measurer;

		handlers.afterMeasurementSetup(newSlot);

		// Rebuild root's children from the nodeMap
		tree.setChildren(this.#buildSegmentChildren(this.#currentSegment));
		return true;
	}

	/**
	 * Build the DOMLayoutNode children array for a segment.
	 * Includes persistent elements, the segment's flow children, and a
	 * lookahead boundary child from the next segment (if any).
	 */
	#buildSegmentChildren(segIndex) {
		const children = [];
		const slot = this.#measureElement.contentRoot;

		// Build children from the slot's current DOM order — this includes
		// persistent elements and the segment's flow elements.
		for (const el of slot.children) {
			const tag = el.tagName.toLowerCase();
			if (SKIP_TAGS.has(tag)) continue;
			const display = getComputedStyle(el).display;
			if (display === "none" || SKIP_DISPLAYS.has(display)) continue;
			let node = this.#nodeMap.get(el);
			if (!node) {
				node = new DOMLayoutNode(el);
				this.#nodeMap.set(el, node);
			}
			children.push(node);
		}

		// Add lookahead boundary child from next segment (if exists).
		// This node is NOT in the DOM — its breakBefore/page are overrides.
		if (segIndex + 1 < this.#segments.length) {
			const nextStart = this.#segments[segIndex + 1].start;
			const boundaryEl = this.#flowElements[nextStart];
			const boundaryNode = this.#nodeMap.get(boundaryEl);
			children.push(boundaryNode);
		}

		return children;
	}

	/**
	 * Get the initial children array for the root node after setup.
	 * Only meaningful when segmented.
	 * @returns {DOMLayoutNode[]|null}
	 */
	get initialChildren() {
		if (!this.#segments) return null;
		return this.#buildSegmentChildren(0);
	}

	/**
	 * Check if a break token indicates we've reached the current
	 * segment's boundary (forced break at the lookahead child).
	 */
	#isAtBoundary(breakToken) {
		if (!breakToken) return false;
		const childTokens = breakToken.childBreakTokens;
		if (!childTokens || childTokens.length === 0) return false;
		const lastChild = childTokens[childTokens.length - 1];
		if (!lastChild.isBreakBefore) return false;
		const nextSegStart = this.#segments[this.#currentSegment + 1]?.start;
		if (nextSegStart === undefined) return false;
		const boundaryEl = this.#flowElements[nextSegStart];
		return lastChild.node === this.#nodeMap.get(boundaryEl);
	}

	/**
	 * Release measurement, returning all content as a DocumentFragment.
	 * Removes the measurer from the DOM. Idempotent — calling again
	 * returns the already-released content.
	 *
	 * @returns {{ content: DocumentFragment }}
	 */
	release() {
		if (!this.#measureElement) return { content: this.#content };

		const frag = document.createDocumentFragment();

		if (this.#segments) {
			if (this.#finished.childNodes.length > 0) {
				frag.appendChild(this.#finished);
			}
			const slot = this.#measureElement.contentRoot;
			while (slot.firstChild) {
				frag.appendChild(slot.firstChild);
			}
			if (this.#pending.childNodes.length > 0) {
				frag.appendChild(this.#pending);
			}
		} else {
			const slot = this.#measureElement.contentRoot;
			while (slot.firstChild) {
				frag.appendChild(slot.firstChild);
			}
		}

		this.#measureElement.remove();
		this.#measureElement = null;
		this.#content = frag;

		return { content: frag };
	}

	/**
	 * Recreate the measurement container from released content and move
	 * the content back in. Node identity is preserved — existing
	 * DOMLayoutNode wrappers and break tokens remain valid. Segmented
	 * flows restart at the first segment.
	 *
	 * @returns {Element} the content root (slot element)
	 */
	reattach() {
		if (this.#measureElement) return this.#measureElement.contentRoot;

		if (this.#segments) {
			this.#finished = document.createDocumentFragment();
			this.#pending = document.createDocumentFragment();
			const firstEnd = this.#segments[0].end;
			for (let i = this.#flowElements.length - 1; i >= firstEnd; i--) {
				this.#pending.insertBefore(this.#flowElements[i], this.#pending.firstChild);
			}
			this.#currentSegment = 0;
		}

		const measurer = this.#createMeasurer();
		measurer.injectFragment(this.#content, this.#styles);
		document.body.appendChild(measurer);
		void measurer.offsetHeight;

		this.#measureElement = measurer;
		return measurer.contentRoot;
	}

	/** Sync the measurement container's inline size with the constraint space. */
	applyConstraintSpace(constraintSpace) {
		this.#measureElement?.applyConstraintSpace(constraintSpace);
	}

	/** The current measurement container's content root (slot element). */
	get contentRoot() {
		return this.#measureElement?.contentRoot ?? null;
	}

	/** Content styles for rendering. */
	getContentStyles() {
		return this.#contentStyles;
	}

	/** Whether segmented mode is active. */
	get isSegmented() {
		return this.#segments !== null && this.#segments.length > 1;
	}

	/** Whether a measurement element is currently live. */
	get isActive() {
		return this.#measureElement !== null;
	}

	#createMeasurer() {
		return document.createElement("content-measure");
	}
}
