/**
 * FontMetrics — DOM-based font metric extraction.
 *
 * Measures normal line-height by rendering a probe element and
 * reading the actual line box gap via Range.getClientRects().
 * This matches browser rendering across engines (Chromium, Firefox,
 * WebKit) unlike canvas measureText() which returns em-square bounds
 * in Firefox instead of line-height bounds.
 *
 * Results are DPR-rounded to the device pixel grid: floored at DPR 1,
 * rounded at higher DPRs. Without this rounding, sub-pixel overcount
 * accumulates to phantom overflow across a full page.
 */

const REFERENCE_SIZE = 100;

class FontMetrics {
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
	 * Creates a probe element, forces multi-line wrapping, and reads
	 * the actual rendered line box gap via Range.getClientRects().
	 *
	 * @param {string} family — CSS font-family value (may be a stack)
	 * @param {string} [weight="400"]
	 * @param {string} [style="normal"]
	 * @returns {number} line-height ratio (e.g. 1.15 for Inter, 1.42 for Times)
	 */
	measure(family, weight = "400", style = "normal") {
		const key = `${weight}|${style}|${family}`;
		if (this.#cache.has(key)) return this.#cache.get(key);

		let ratio = 1.2; // fallback

		if (typeof document !== "undefined") {
			const probe = document.createElement("div");
			probe.style.cssText = [
				"position:absolute",
				"left:-9999px",
				"top:-9999px",
				"width:50px",
				"visibility:hidden",
				"line-height:normal",
				`font-family:${family}`,
				`font-weight:${weight}`,
				`font-style:${style}`,
				`font-size:${REFERENCE_SIZE}px`,
			].join(";");
			// Enough words to guarantee multiple lines at 50px width
			probe.textContent = "x x x x x x x x";
			document.body.appendChild(probe);

			const lineHeight = measureProbeLineHeight(probe);
			if (lineHeight > 0) {
				ratio = lineHeight / REFERENCE_SIZE;
			}

			document.body.removeChild(probe);
		}

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
		return this.round(fontSize * ratio);
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
		return this.round(fontSize * ratio);
	}

	/**
	 * Round a value to the device pixel grid.
	 *
	 * Used for line-height and margin values that the browser snaps
	 * to device pixels. Floored at DPR 1, rounded at higher DPRs.
	 *
	 * @param {number} value — CSS px value
	 * @returns {number} device-pixel-aligned value
	 */
	round(value) {
		return this.#dpr === 1 ? Math.floor(value) : Math.round(value * this.#dpr) / this.#dpr;
	}
}

/**
 * Measure the rendered line-height of a probe element using
 * Range.getClientRects(). Returns the gap between the last two
 * distinct line-box tops, or 0 if fewer than 2 lines.
 *
 * @param {Element} element — must be in the DOM with multiple lines
 * @returns {number} line-height in pixels, or 0
 */
function measureProbeLineHeight(element) {
	const range = document.createRange();
	range.selectNodeContents(element);
	const rects = range.getClientRects();
	if (rects.length === 0) return 0;

	const tops = [rects[0].top];
	for (let i = 1; i < rects.length; i++) {
		if (rects[i].top > tops[tops.length - 1] + 0.5) {
			tops.push(rects[i].top);
		}
	}

	if (tops.length < 2) return 0;
	return tops[tops.length - 1] - tops[tops.length - 2];
}

let shared;

/** Lazily-initialized shared FontMetrics instance. */
export function getSharedFontMetrics() {
	if (!shared) shared = new FontMetrics();
	return shared;
}
