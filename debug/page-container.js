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
    box-sizing: border-box;
    overflow: hidden;
    flex-shrink: 0;
    width: var(--page-width);
    height: var(--page-height);
    padding: var(--page-padding, 0px);
  }
  slot.body {
    display: block;
    flex-grow: 1;
  }
`;

export class PageContainer extends HTMLElement {
  #slot = null;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLES;
    shadow.appendChild(style);
    this.#slot = document.createElement("slot");
    this.#slot.classList.add("body");
    this.#slot.setAttribute("part", "body");
    this.#slot.addEventListener("slotchange", () => this.#onSlotChange());
    shadow.appendChild(this.#slot);
  }

  connectedCallback() {
    if (!document.adoptedStyleSheets.includes(OVERRIDES)) {
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, OVERRIDES];
    }
  }

  /**
   * Set page-box dimensions and margins from numeric values.
   *
   * @param {number} width  — page box inline size in px
   * @param {number} height — page box block size in px
   * @param {{ top?: number, right?: number, bottom?: number, left?: number }} [margins]
   */
  setPageBox(width, height, margins) {
    this.style.setProperty("--page-width", `${width}px`);
    this.style.setProperty("--page-height", `${height}px`);
    if (margins) {
      this.style.setProperty(
        "--page-padding",
        `${margins.top || 0}px ${margins.right || 0}px ${margins.bottom || 0}px ${margins.left || 0}px`,
      );
    }
  }

  /**
   * When a fragment-container is slotted, read its pageConstraints
   * and apply the page-box dimensions automatically.
   */
  #onSlotChange() {
    for (const node of this.#slot.assignedElements()) {
      const constraints = node.pageConstraints;
      if (!constraints) continue;
      if (constraints.pageBoxSize) {
        this.setPageBox(
          constraints.pageBoxSize.inlineSize,
          constraints.pageBoxSize.blockSize,
          constraints.margins,
        );
      } else if (constraints.contentArea) {
        this.setPageBox(
          constraints.contentArea.inlineSize,
          constraints.contentArea.blockSize,
        );
      }
      break;
    }
  }
}

customElements.define("page-container", PageContainer);
