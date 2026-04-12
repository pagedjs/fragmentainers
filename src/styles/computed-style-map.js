/**
 * Polyfill for element.computedStyleMap().
 *
 * Uses native CSS Typed OM when available, falls back to a
 * getComputedStyle-based shim that returns the same interface:
 * a map with .get(prop) returning a CSSUnitValue-shaped value.
 *
 * When all evergreen browsers support Typed OM, delete this file
 * and replace imports with direct element.computedStyleMap() calls.
 *
 * @module
 */

import { UnitValue } from "./css-values.js";

const HAS_TYPED_OM =
	typeof HTMLElement !== "undefined" &&
	typeof HTMLElement.prototype.computedStyleMap === "function";

/**
 * Get a typed computed style map for an element.
 */
export function computedStyleMap(element) {
	if (HAS_TYPED_OM) return element.computedStyleMap();
	return createFallbackStyleMap(element);
}

/**
 * Fallback style map over getComputedStyle. Exported for testing.
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
	// Unitless integer (column-count, orphans, widows, z-index)
	if (/^\d+$/.test(raw)) return new UnitValue(parseInt(raw, 10), "number");

	// Pixel value — the most common case for resolved computed styles
	if (raw.endsWith("px")) return new UnitValue(parseFloat(raw), "px");

	// Percentage
	if (raw.endsWith("%")) return new UnitValue(parseFloat(raw), "percent");

	// Other numeric+unit (em, rem, s, ms, deg, etc.)
	const match = raw.match(/^([\d.]+)(\w+)$/);
	if (match) return new UnitValue(parseFloat(match[1]), match[2]);

	// Keyword (auto, normal, none, block, flex, etc.)
	return { value: raw };
}
