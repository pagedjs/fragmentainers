/**
 * Parse a CSS An+B expression into { a, b } coefficients.
 * Accepts the `odd` and `even` keywords as shortcuts for `2n+1` and `2n`.
 */
export function parseAnPlusB(expr) {
	const s = expr.replace(/\s+/g, "").toLowerCase();
	if (s === "odd") return { a: 2, b: 1 };
	if (s === "even") return { a: 2, b: 0 };
	if (!s.includes("n")) return { a: 0, b: parseInt(s, 10) };
	const [aPart, bPart] = s.split("n");
	let a;
	if (aPart === "" || aPart === "+") a = 1;
	else if (aPart === "-") a = -1;
	else a = parseInt(aPart, 10);
	return { a, b: bPart ? parseInt(bPart, 10) : 0 };
}

/**
 * Test whether a 1-based index matches an An+B formula.
 */
export function matchesAnPlusB(index, { a, b }) {
	if (a === 0) return index === b;
	const n = (index - b) / a;
	return Number.isInteger(n) && n >= 0;
}
