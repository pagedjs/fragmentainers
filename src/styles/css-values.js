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
