/**
 * Polyfill for element.computedStyleMap().
 *
 * Uses native CSS Typed OM when available, falls back to a
 * getComputedStyle-based shim that returns the same interface:
 * a map with .get(prop) → CSSUnitValue | CSSKeywordValue shapes.
 *
 * When all evergreen browsers support Typed OM, delete this file
 * and replace imports with direct element.computedStyleMap() calls.
 *
 * @module
 */

/**
 * One-time static feature probe. True if the browser supports
 * element.computedStyleMap() (Chromium 66+, partial Firefox/Safari).
 */
const HAS_TYPED_OM =
	typeof HTMLElement !== "undefined" &&
	typeof HTMLElement.prototype.computedStyleMap === "function";

/**
 * Get a typed computed style map for an element.
 *
 * @param {Element} element
 * @returns {StylePropertyMapReadOnly} Native map or polyfill with same shape
 */
export function computedStyleMap(element) {
	if (HAS_TYPED_OM) {
		return element.computedStyleMap();
	}
	return createFallbackStyleMap(element);
}

/**
 * Create a fallback style map from getComputedStyle that returns
 * CSSUnitValue / CSSKeywordValue-shaped objects from .get().
 *
 * Exported for testing — not part of the public API.
 *
 * @param {Element} element
 * @returns {{ get(property: string): { value: number|string, unit?: string } | null }}
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
 * Parse a raw computed CSS value string into a CSSUnitValue or
 * CSSKeywordValue-shaped object matching the native Typed OM interface.
 *
 * @param {string} raw - trimmed getPropertyValue() result
 * @returns {{ value: number, unit: string } | { value: string }}
 */
function parseCSSValue(raw) {
	// Unitless integer (column-count, orphans, widows, z-index)
	if (/^\d+$/.test(raw)) {
		return { value: parseInt(raw, 10), unit: "number" };
	}

	// Pixel value — the most common case for resolved computed styles
	if (raw.endsWith("px")) {
		return { value: parseFloat(raw), unit: "px" };
	}

	// Percentage
	if (raw.endsWith("%")) {
		return { value: parseFloat(raw), unit: "percent" };
	}

	// Other numeric+unit (em, rem, s, ms, deg, etc.)
	const match = raw.match(/^([\d.]+)(\w+)$/);
	if (match) {
		return { value: parseFloat(match[1]), unit: match[2] };
	}

	// Keyword (auto, normal, none, block, flex, etc.)
	return { value: raw };
}
