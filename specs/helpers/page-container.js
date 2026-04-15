/**
 * <page-container> — lightweight page-box wrapper with Shadow DOM.
 *
 * Provides the structural CSS shared by all page representations
 * (debug viewer, spec tests, reference files). Content is projected
 * through a default <slot>, so callers can pass either a
 * <fragment-container> or plain HTML elements.
 *
 * When a <fragment-container> with constraints is slotted,
 * the element automatically sizes itself to the page box.
 *
 * Adopts the split-element override stylesheet on the document so
 * that light-DOM content in ref files gets the same overrides that
 * fragment-container applies inside its shadow DOM.
 */

import { OVERRIDES } from "../../src/styles/overrides.js";

const STYLES = `
  :host {
		display: block;
    box-sizing: border-box;
    overflow: hidden;
    width: round(down, var(--page-width), 1px);
    height: round(down, var(--page-height), 1px);
    padding-top: round(down, var(--page-margin-top, 0px), 1px);
    padding-right: round(down, var(--page-margin-right, 0px), 1px);
    padding-bottom: round(down, var(--page-margin-bottom, 0px), 1px);
    padding-left: round(down, var(--page-margin-left, 0px), 1px);
  }
	div.body {
    display: block;
    overflow: hidden;
    height: 100%;
  }
	div.body > slot {
    display: block;
    min-height: 100%;
		margin: 8px;
  }
	:host(:not(:first-of-type)) div.body > slot {
    margin-block-start: 0;
  }
	:host(:not(:last-of-type)) div.body > slot {
    margin-block-end: 0;
  }
`;

export class PageContainer extends HTMLElement {
	#slot = null;

	#shadow = null;

	#internals = null;

	constructor() {
		super();
		this.#shadow = this.attachShadow({ mode: "open" });
		this.#internals = this.attachInternals();
		const style = document.createElement("style");
		style.textContent = STYLES;
		this.#shadow.appendChild(style);

		this.#slot = document.createElement("slot");
		this.#slot.addEventListener("slotchange", () => this.#onSlotChange());
		this.#shadow.appendChild(this.#slot);
	}

	#setState(name, on) {
		if (on) this.#internals.states.add(name);
		else this.#internals.states.delete(name);
	}

	/**
	 * Set boolean page states exposed via `:state(...)` selectors.
	 * Keys left `undefined` are not touched.
	 *
	 * @param {{ isFirst?: boolean, isBlank?: boolean, isVerso?: boolean, isRecto?: boolean }} states
	 */
	setStates(states = {}) {
		if (states.isFirst !== undefined) this.#setState("isFirst", states.isFirst);
		if (states.isBlank !== undefined) this.#setState("isBlank", states.isBlank);
		if (states.isVerso !== undefined) this.#setState("isVerso", states.isVerso);
		if (states.isRecto !== undefined) this.#setState("isRecto", states.isRecto);
	}

	connectedCallback() {
		this.setAttribute("role", "none");
		if (!document.adoptedStyleSheets.includes(OVERRIDES)) {
			document.adoptedStyleSheets = [...document.adoptedStyleSheets, OVERRIDES];
		}
		this.#wrapSlotIfNeeded();
	}

	/**
	 * Wrap the slot in a div.body for ref pages (plain HTML content).
	 * Skip wrapping when a fragment-container is slotted.
	 */
	#wrapSlotIfNeeded() {
		const hasFragmentContainer = [...this.children].some((c) => c.tagName === "FRAGMENT-CONTAINER");
		if (hasFragmentContainer || this.#slot.parentElement?.classList.contains("body")) return;

		const body = document.createElement("div");
		body.classList.add("body");
		this.#slot.setAttribute("part", "body");
		this.#slot.remove();
		body.appendChild(this.#slot);
		this.#shadow.appendChild(body);
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
				const parts = margins.split(/\s+/);
				const [t, r = t, b = t, l = r] = parts;
				this.style.setProperty("--page-margin-top", t);
				this.style.setProperty("--page-margin-right", r);
				this.style.setProperty("--page-margin-bottom", b);
				this.style.setProperty("--page-margin-left", l);
			} else {
				this.style.setProperty("--page-margin-top", `${margins.top || 0}px`);
				this.style.setProperty("--page-margin-right", `${margins.right || 0}px`);
				this.style.setProperty("--page-margin-bottom", `${margins.bottom || 0}px`);
				this.style.setProperty("--page-margin-left", `${margins.left || 0}px`);
			}
		}
	}

	/**
	 * When a fragment-container is slotted, read its constraints
	 * and apply the page-box dimensions automatically.
	 */
	#onSlotChange() {
		const assigned = this.#slot.assignedElements();
		for (const node of assigned) {
			const constraints = node.constraints;
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

			this.setStates({
				isFirst: constraints.isFirst ?? node.hasAttribute("data-first"),
				isBlank: constraints.isBlank ?? node.hasAttribute("data-blank-page"),
				isVerso: constraints.isVerso,
				isRecto: constraints.isRecto,
			});
			break;
		}
	}
}

customElements.define("page-container", PageContainer);
