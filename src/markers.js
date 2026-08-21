/**
 * DOM attribute markers that let features cooperate with the engine
 * without calling into each other. Any code that can touch the content
 * before layout (a LayoutHandler's prepareContent(), or the caller
 * before constructing a Fragmenter) can set them.
 *
 * - data-frag-persistent: a top-level element that must be present in
 *   every measurement segment (e.g. position: fixed elements that repeat
 *   on every page). The value names the owner that set it; handlers
 *   clear only their own value on re-runs, caller-set markers ("") are
 *   never cleared.
 * - data-frag-native-pseudo-{before,after}: leave this element's native
 *   ::before/::after alone; the PseudoElements handler will not
 *   materialize it as a <frag-pseudo>.
 */

export const PERSISTENT_ATTR = "data-frag-persistent";
const NATIVE_PSEUDO_PREFIX = "data-frag-native-pseudo-";

/**
 * @param {Element} element
 * @param {string} [owner=""] — identifies who set the marker
 */
export function markPersistent(element, owner = "") {
	element.setAttribute(PERSISTENT_ATTR, owner);
}

/**
 * @param {Element} element
 * @returns {boolean}
 */
export function isPersistent(element) {
	return element.hasAttribute(PERSISTENT_ATTR);
}

/**
 * Remove the marker only if it was set by `owner`.
 *
 * @param {Element} element
 * @param {string} owner
 */
export function clearPersistent(element, owner) {
	if (element.getAttribute(PERSISTENT_ATTR) === owner) {
		element.removeAttribute(PERSISTENT_ATTR);
	}
}

/**
 * @param {Element} element
 * @param {"before"|"after"} pseudo
 */
export function markNativePseudo(element, pseudo) {
	element.setAttribute(`${NATIVE_PSEUDO_PREFIX}${pseudo}`, "");
}

/**
 * @param {Element} element
 * @param {"before"|"after"} pseudo
 * @returns {boolean}
 */
export function hasNativePseudo(element, pseudo) {
	return element.hasAttribute(`${NATIVE_PSEUDO_PREFIX}${pseudo}`);
}
