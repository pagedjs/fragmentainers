/**
 * <page-container> — lightweight page-box wrapper with Shadow DOM.
 *
 * Provides the structural CSS shared by all page representations
 * (debug viewer, spec tests, reference files). Content is projected
 * through a default <slot>, so callers can pass either a
 * <fragment-container> or plain HTML elements.
 *
 * When a <fragment-container> with pageConstraints is slotted,
 * the element automatically sizes itself to the page box.
 *
 * Adopts the split-element override stylesheet on the document so
 * that light-DOM content in ref files gets the same overrides that
 * fragment-container applies inside its shadow DOM.
 */

import { OVERRIDES } from "../src/styles/overrides.js";

const STYLES = `
  :host {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    overflow: hidden;
    flex-shrink: 0;
    width: var(--page-width);
    height: var(--page-height);
    padding: var(--page-margin, 0px);
  }
	slot[name="direct"] {
    display: block;
    flex-grow: 1;
  }
  div.body {
    display: flow-root;
    flex-grow: 1;
  }
`;

export class PageContainer extends HTMLElement {
	#slot = null;

	#directSlot = null;

	#shadow = null;

	constructor() {
		super();
		this.#shadow = this.attachShadow({ mode: "open" });
		const style = document.createElement("style");
		style.textContent = STYLES;
		this.#shadow.appendChild(style);

		// Named "direct" slot — no body wrapper, for fragment-containers
		// that handle body margin via their own adopted stylesheets
		this.#directSlot = document.createElement("slot");
		this.#directSlot.name = "direct";
		this.#directSlot.addEventListener("slotchange", () => this.#onSlotChange());
		this.#shadow.appendChild(this.#directSlot);
	}

	/**
	 * Lazily create the default slot wrapped in a div.body with UA body
	 * margin. Only built when content uses the default slot (ref pages).
	 */
	#ensureDefaultSlot() {
		if (this.#slot) return;
		const body = document.createElement("div");
		body.classList.add("body");
		body.setAttribute("part", "body");
		this.#slot = document.createElement("slot");
		this.#slot.addEventListener("slotchange", () => this.#onSlotChange());
		body.appendChild(this.#slot);
		this.#shadow.appendChild(body);
	}

	connectedCallback() {
		if (!document.adoptedStyleSheets.includes(OVERRIDES)) {
			document.adoptedStyleSheets = [...document.adoptedStyleSheets, OVERRIDES];
		}
		// Create the default slot if any child doesn't use slot="direct"
		for (const child of this.children) {
			if (child.slot !== "direct") {
				this.#ensureDefaultSlot();
				break;
			}
		}
	}

	/**
	 * Set page-box dimensions and margins.
	 * Accepts CSS strings (e.g. "105mm") or numbers (px fallback).
	 *
	 * @param {string|number} width  — page box inline size
	 * @param {string|number} height — page box block size
	 * @param {string|object} [margins] — CSS string or { top, right, bottom, left } in px
	 */
	setPageBox(width, height, margins) {
		this.style.setProperty("--page-width", typeof width === "string" ? width : `${width}px`);
		this.style.setProperty("--page-height", typeof height === "string" ? height : `${height}px`);
		if (margins) {
			if (typeof margins === "string") {
				this.style.setProperty("--page-margin", margins);
			} else {
				this.style.setProperty(
					"--page-margin",
					`${margins.top || 0}px ${margins.right || 0}px ${margins.bottom || 0}px ${margins.left || 0}px`,
				);
			}
		}
	}

	/**
	 * When a fragment-container is slotted, read its pageConstraints
	 * and apply the page-box dimensions automatically.
	 */
	#onSlotChange() {
		const assigned = [
			...(this.#slot?.assignedElements() ?? []),
			...this.#directSlot.assignedElements(),
		];
		for (const node of assigned) {
			const constraints = node.pageConstraints;
			if (!constraints) continue;

			const css = constraints.cssText;
			if (css?.pageBoxSize) {
				const marginStr = css.margin
					? `${css.margin.top} ${css.margin.right} ${css.margin.bottom} ${css.margin.left}`
					: undefined;
				this.setPageBox(
					css.pageBoxSize.inline.toString(),
					css.pageBoxSize.block.toString(),
					marginStr,
				);
			} else if (constraints.pageBoxSize) {
				this.setPageBox(
					constraints.pageBoxSize.inlineSize,
					constraints.pageBoxSize.blockSize,
					constraints.margins,
				);
			} else if (constraints.contentArea) {
				this.setPageBox(constraints.contentArea.inlineSize, constraints.contentArea.blockSize);
			}
			break;
		}
	}
}

customElements.define("page-container", PageContainer);
