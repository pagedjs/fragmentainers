import { parseContentValue } from "../styles/css-values.js";
import { defineElement } from "./define.js";

/**
 * A materialized ::before or ::after.
 *
 * The engine turns pseudo elements into real elements so layout can see them
 * (see PseudoElements). It stores their content one of two ways: fixed text
 * becomes this element's own text, while content that has to keep re-resolving
 * — `var()`, `counter()` — is relocated onto the pseudo this element generates
 * in turn. `text` reads whichever applies, so nothing outside has to know which
 * strategy a given pseudo took.
 *
 * @element frag-pseudo
 */
export class FragPseudoElement extends HTMLElement {
	/**
	 * Which pseudo element this materializes.
	 *
	 * @returns {"before"|"after"|null}
	 */
	get pseudo() {
		return this.dataset.pseudo ?? null;
	}

	/**
	 * The text this pseudo renders.
	 *
	 * Content still holding an unresolved function — a `counter()` outside a
	 * live layout — is not text, and reads as empty.
	 *
	 * @returns {string}
	 */
	get text() {
		if (this.textContent) return this.textContent;
		const which = this.pseudo;
		if (!which) return "";
		const parsed = parseContentValue(getComputedStyle(this, `::${which}`).content);
		return parsed.isStringOnly ? parsed.text : "";
	}
}

/**
 * The materialized pseudo of an element, if it has one.
 *
 * @param {Element} element
 * @param {"before"|"after"} which
 * @returns {FragPseudoElement|null}
 */
export function pseudoFor(element, which) {
	return (
		element?.querySelector?.(`:scope > frag-pseudo[data-pseudo="${which}"]`) ?? null
	);
}

defineElement("frag-pseudo", FragPseudoElement);
