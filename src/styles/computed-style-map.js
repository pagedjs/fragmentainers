/**
 * Polyfill for element.computedStyleMap().
 *
 * Uses native CSS Typed OM when available. The fallback provides the `get()`
 * method the engine uses and returns CSSUnitValue-shaped numeric values.
 *
 * @module
 */

import { UnitValue } from "./css-values.js";

export const HAS_TYPED_OM =
	typeof HTMLElement !== "undefined" &&
	typeof HTMLElement.prototype.computedStyleMap === "function";

/**
 * Get a typed computed style map for an element.
 *
 * @param {Element} element - Element whose computed styles are read
 * @returns {StylePropertyMapReadOnly|{get: Function}} Native or fallback style map
 */
export function computedStyleMap(element) {
	if (HAS_TYPED_OM) return element.computedStyleMap();
	return createFallbackStyleMap(element);
}

/**
 * Fallback style map over getComputedStyle. Exported for testing.
 *
 * @param {Element} element - Element whose computed styles are read
 * @returns {{get: Function}} Style map implementing the required `get()` subset
 */
export function createFallbackStyleMap(element) {
	const style = getComputedStyle(element);
	return {
		get(property) {
			const raw = style.getPropertyValue(property).trim();
			if (!raw) return null;
			return parseCSSValue(raw);
		},
	};
}

/**
 * Parse a resolved computed style string into a value with the
 * CSSUnitValue shape (.value, .unit, .to()), or a plain keyword
 * object { value } when the input is non-numeric.
 */
function parseCSSValue(raw) {
	if (/^\d+$/.test(raw)) return new UnitValue(parseInt(raw, 10), "number");

	if (raw.endsWith("px")) return new UnitValue(parseFloat(raw), "px");

	if (raw.endsWith("%")) return new UnitValue(parseFloat(raw), "percent");

	const match = raw.match(/^([\d.]+)(\w+)$/);
	if (match) return new UnitValue(parseFloat(match[1]), match[2]);

	return { value: raw };
}
