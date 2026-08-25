const UNIT_TO_PX = {
	px: 1,
	in: 96,
	cm: 96 / 2.54,
	mm: 96 / 25.4,
	pt: 96 / 72,
	pc: 16,
	q: 96 / 25.4 / 4,
};

const HAS_CSS_UNIT_VALUE = typeof CSSUnitValue !== "undefined";

const HAS_NUMERIC_PARSE =
	typeof CSSNumericValue !== "undefined" &&
	typeof CSSNumericValue.parse === "function";

/**
 * Polyfill for CSSUnitValue with .to() and .sub() for the subset of
 * operations this codebase uses. Returned when the native Typed OM
 * class isn't available (Firefox/Safari).
 */
export class UnitValue {
	constructor(value, unit = "px") {
		this.value = value;
		this.unit = unit;
	}

	to(target) {
		if (this.unit === target) return new UnitValue(this.value, target);
		const fromFactor = UNIT_TO_PX[this.unit];
		const toFactor = UNIT_TO_PX[target];
		if (fromFactor === undefined || toFactor === undefined) {
			throw new TypeError(`Cannot convert ${this.unit} to ${target}`);
		}
		return new UnitValue((this.value * fromFactor) / toFactor, target);
	}

	sub(other) {
		if (this.unit === other.unit) {
			return new UnitValue(this.value - other.value, this.unit);
		}
		const a = this.to("px").value;
		const b = typeof other.to === "function" ? other.to("px").value : other.value;
		return new UnitValue(a - b, "px");
	}

	add(other) {
		if (this.unit === other.unit) {
			return new UnitValue(this.value + other.value, this.unit);
		}
		const a = this.to("px").value;
		const b = typeof other.to === "function" ? other.to("px").value : other.value;
		return new UnitValue(a + b, "px");
	}
}

/**
 * Construct a CSS numeric value. Returns a native CSSUnitValue when
 * available, otherwise a UnitValue polyfill with the same shape.
 */
export function cssValue(value, unit = "px") {
	if (HAS_CSS_UNIT_VALUE) return new CSSUnitValue(value, unit);
	return new UnitValue(value, unit);
}

/**
 * Parse a CSS numeric value string into a typed value with .to() and
 * .sub(). Uses native CSSNumericValue.parse when available so calc()
 * expressions and any supported unit work. Bare numbers are treated as px.
 */
export function parseNumeric(str) {
	str = str.trim();
	if (!str) return null;
	if (/^-?[\d.]+$/.test(str)) return cssValue(parseFloat(str), "px");
	if (HAS_NUMERIC_PARSE) {
		try {
			return CSSNumericValue.parse(str);
		} catch {
			return null;
		}
	}
	const match = str.match(/^([\d.]+)(px|in|cm|mm|pt)?$/);
	if (!match) return null;
	return cssValue(parseFloat(match[1]), match[2] || "px");
}

/**
 * Resolve a Typed OM length (from a computedStyleMap) to pixels, or null when
 * it cannot be resolved at this layer. Percent and relative units (em/rem)
 * need a containing block / font context and return null; bare CSSStyleValues
 * — Chromium under-reifies some properties (e.g. `border-block-*-width`) —
 * carry a px length string, which is parsed.
 *
 * @param {CSSNumericValue|CSSStyleValue|null} value
 * @returns {number|null}
 */
export function typedLengthToPx(value) {
	if (!value) return null;
	if (value.unit === "px") return value.value;
	if (value.unit) return null;
	const str = value.toString();
	if (str.includes("%")) return null;
	const parsed = parseFloat(str);
	return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Resolve a CSS length to pixels without throwing on relative units.
 * em/rem resolve against rootFontSize; percentages against percentBase
 * (returns null when no base is supplied). Absolute units and calc()
 * go through the typed .to("px") conversion. Returns null when the value
 * is empty or cannot be resolved.
 *
 * @param {string|CSSNumericValue} value
 * @param {{ rootFontSize?: number, percentBase?: number|null }} [options]
 * @returns {number|null}
 */
export function toPx(value, { rootFontSize = 16, percentBase = null } = {}) {
	const v = typeof value === "string" ? parseNumeric(value) : value;
	if (!v) return null;
	if (v.unit === "em" || v.unit === "rem") return v.value * rootFontSize;
	if (v.unit === "percent") {
		return percentBase == null ? null : (v.value / 100) * percentBase;
	}
	try {
		return v.to("px").value;
	} catch {
		return null;
	}
}

/**
 * Parse a CSS `content` property value into its constituent parts.
 * Returns { isStringOnly, text } where isStringOnly is true when the
 * value is composed entirely of quoted strings (no counter/attr/url).
 *
 * @param {string} raw — value from getComputedStyle or CSSStyleRule
 * @returns {{ isStringOnly: boolean, text: string }}
 */
export function parseContentValue(raw) {
	if (!raw || raw === "none" || raw === "normal" || raw === '""') {
		return { isStringOnly: false, text: "" };
	}

	const parts = [];
	let remaining = raw.trim();
	let allStrings = true;

	while (remaining.length > 0) {
		const dq = remaining.match(/^"((?:[^"\\]|\\.)*)"/);
		if (dq) {
			parts.push(dq[1].replace(/\\(.)/g, "$1"));
			remaining = remaining.slice(dq[0].length).trim();
			continue;
		}
		const sq = remaining.match(/^'((?:[^'\\]|\\.)*)'/);
		if (sq) {
			parts.push(sq[1].replace(/\\(.)/g, "$1"));
			remaining = remaining.slice(sq[0].length).trim();
			continue;
		}

		allStrings = false;
		break;
	}

	return {
		isStringOnly: allStrings && parts.length > 0,
		text: parts.join(""),
	};
}

const STRING_TOKEN = /^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'/;
const ATTR_TOKEN = /^attr\(\s*[^()]*\)/i;

/**
 * Check whether a `content` value renders as fixed text.
 *
 * Strings qualify, and so does `attr()`: it resolves against the element
 * whose pseudo is being styled, so a relocated rule would read it off the
 * <frag-pseudo> rather than the source element and always come back empty.
 * Computed style substitutes it before materialization, so taking it as text
 * is both the only correct reading and the one already available.
 *
 * `var()` and `counter()` are excluded on purpose — they have to keep
 * re-resolving as custom properties and counters change.
 *
 * @param {string} raw — value from a CSSStyleRule
 * @returns {boolean}
 */
export function contentRendersAsText(raw) {
	if (!raw || raw === "none" || raw === "normal") return false;

	let remaining = raw.trim();
	let parts = 0;
	while (remaining.length > 0) {
		const token = STRING_TOKEN.exec(remaining) ?? ATTR_TOKEN.exec(remaining);
		if (!token) return false;
		remaining = remaining.slice(token[0].length).trim();
		parts += 1;
	}

	return parts > 0;
}
