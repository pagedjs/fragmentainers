/**
 * FontMetrics — canvas-based font metric extraction.
 *
 * Uses CanvasRenderingContext2D.measureText() to read fontBoundingBox
 * ascent/descent for the line-height ratio. The raw ratio is measured
 * at a large reference size for precision, then rounded to device
 * pixels at the target font size to match browser behavior.
 *
 * Browsers round line-height: normal to the nearest device pixel
 * (integer CSS px at DPR 1, half-pixel at DPR 2). Without this
 * rounding, a 0.4px-per-line overcount at 16px serif accumulates
 * to ~15px of phantom overflow across a full page.
 */

const REFERENCE_SIZE = 100;

class FontMetrics {
	#ctx;
	#cache = new Map();
	#dpr;

	/**
	 * @param {Object} [options]
	 * @param {number} [options.dpr] — device pixel ratio override.
	 *   Defaults to window.devicePixelRatio (or 1). Use dpr=1 for
	 *   PDF output where integer-pixel line heights are correct
	 *   regardless of the screen's actual DPR.
	 */
	constructor(options = {}) {
		this.#ctx = document.createElement("canvas").getContext("2d");
		this.#dpr = options.dpr ?? (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1);
	}

	/** Current device pixel ratio used for rounding. */
	get dpr() {
		return this.#dpr;
	}

	/**
	 * Override the device pixel ratio.
	 * @param {number} value
	 */
	set dpr(value) {
		this.#dpr = value;
	}

	/**
	 * Measure the normal line-height ratio for a font.
	 *
	 * Returns (fontBoundingBoxAscent + fontBoundingBoxDescent) / referenceSize,
	 * which equals the multiplier browsers use for line-height: normal.
	 *
	 * @param {string} family — CSS font-family value (may be a stack)
	 * @param {string} [weight="400"]
	 * @param {string} [style="normal"]
	 * @returns {number} line-height ratio (e.g. 1.15 for Inter, 1.42 for Times)
	 */
	measure(family, weight = "400", style = "normal") {
		const key = `${weight}|${style}|${family}`;
		if (this.#cache.has(key)) return this.#cache.get(key);

		this.#ctx.font = `${style} ${weight} ${REFERENCE_SIZE}px ${family}`;
		const m = this.#ctx.measureText("x");

		let ratio;
		if (
			typeof m.fontBoundingBoxAscent === "number" &&
			typeof m.fontBoundingBoxDescent === "number"
		) {
			ratio = (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) / REFERENCE_SIZE;
		} else {
			ratio = 1.2;
		}

		// Sanity check — if the ratio is wildly out of range, fall back
		if (ratio <= 0 || ratio > 5) ratio = 1.2;

		this.#cache.set(key, ratio);
		return ratio;
	}

	/**
	 * Compute the normal line-height for a DOM element using its
	 * computed font properties. Rounded to the device pixel grid:
	 * floored at DPR 1, rounded at higher DPRs.
	 *
	 * @param {Element} element — must be attached to the DOM
	 * @returns {number} line-height in pixels
	 */
	getNormalLineHeight(element) {
		const cs = getComputedStyle(element);
		const family = cs.fontFamily;
		const weight = cs.fontWeight;
		const style = cs.fontStyle;
		const fontSize = parseFloat(cs.fontSize) || 16;

		const ratio = this.measure(family, weight, style);
		return this.#roundForDpr(fontSize * ratio);
	}

	/**
	 * Compute the normal line-height from raw CSS property values.
	 *
	 * @param {string} family — CSS font-family
	 * @param {string} weight — CSS font-weight (e.g. "400", "700")
	 * @param {string} style — CSS font-style (e.g. "normal", "italic")
	 * @param {number} fontSize — font-size in px
	 * @returns {number} line-height in px
	 */
	computeNormalLineHeight(family, weight, style, fontSize) {
		const ratio = this.measure(family, weight, style);
		return this.#roundForDpr(fontSize * ratio);
	}

	/**
	 * Round a line-height value to the device pixel grid.
	 */
	#roundForDpr(value) {
		return this.#dpr === 1 ? Math.floor(value) : Math.round(value * this.#dpr) / this.#dpr;
	}
}

let shared;

/** Lazily-initialized shared FontMetrics instance. */
export function getSharedFontMetrics() {
	if (!shared) shared = new FontMetrics();
	return shared;
}
