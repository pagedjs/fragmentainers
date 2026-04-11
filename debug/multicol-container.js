/**
 * <multicol-container> — lightweight column-box wrapper with Shadow DOM.
 *
 * Renders fragmented columns as a flex row. Each column is projected
 * through a default <slot>. Callers set column dimensions and gap
 * via setColumns() or CSS custom properties.
 */

const STYLES = `
  :host {
    display: flex;
    flex-wrap: nowrap;
    align-items: flex-start;
    box-sizing: border-box;
    gap: var(--column-gap, 0px);
  }
  ::slotted(*) {
    width: var(--column-width);
    height: var(--column-height);
    overflow: hidden;
    flex-shrink: 0;
  }
`;

export class MulticolContainer extends HTMLElement {
	constructor() {
		super();
		const shadow = this.attachShadow({ mode: "open" });
		const style = document.createElement("style");
		style.textContent = STYLES;
		shadow.appendChild(style);
		const slot = document.createElement("slot");
		shadow.appendChild(slot);
	}

	connectedCallback() {
		this.setAttribute("role", "none");
	}

	/**
	 * Set column dimensions and gap from numeric values.
	 *
	 * @param {number} width  — column inline size in px
	 * @param {number} height — column block size in px
	 * @param {number} [gap=0] — gap between columns in px
	 */
	setColumns(width, height, gap = 0) {
		this.style.setProperty("--column-width", `${width}px`);
		this.style.setProperty("--column-height", `${height}px`);
		this.style.setProperty("--column-gap", `${gap}px`);
	}
}

customElements.define("multicol-container", MulticolContainer);
