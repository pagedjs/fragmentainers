/**
 * Materialize ::before and ::after pseudo elements as real DOM elements.
 *
 * Called after content injection into the measurement container, before
 * building the layout tree. Creates <frag-pseudo> elements that participate
 * in layout like normal DOM nodes.
 *
 * Follows Chromium LayoutNG's approach where pseudo elements become layout
 * objects in the layout tree, rather than being invisible to the engine.
 *
 * Two-phase process:
 * 1. buildPseudoStyleSheet — generates companion and relocation rules
 *    (applied BEFORE materialization so relocated content renders)
 * 2. materializePseudoElements — detects pseudo elements via getComputedStyle,
 *    creates <frag-pseudo> synthetics, and returns a suppression sheet
 *    (applied AFTER materialization to hide the original pseudos)
 */

const PSEUDO_TAG = "FRAG-PSEUDO";

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
		// Match double-quoted string
		const dq = remaining.match(/^"((?:[^"\\]|\\.)*)"/);
		if (dq) {
			parts.push(dq[1].replace(/\\(.)/g, "$1"));
			remaining = remaining.slice(dq[0].length).trim();
			continue;
		}
		// Match single-quoted string
		const sq = remaining.match(/^'((?:[^'\\]|\\.)*)'/);
		if (sq) {
			parts.push(sq[1].replace(/\\(.)/g, "$1"));
			remaining = remaining.slice(sq[0].length).trim();
			continue;
		}

		// Not a quoted string — counter(), attr(), url(), etc.
		allStrings = false;
		break;
	}

	return {
		isStringOnly: allStrings && parts.length > 0,
		text: parts.join(""),
	};
}

/**
 * Check whether an element is a materialized pseudo element.
 * @param {Element} element
 * @returns {boolean}
 */
export function isPseudoElement(element) {
	return element.tagName === PSEUDO_TAG;
}

// ——— CSS rule rewriting ———

/**
 * Detect the pseudo type ("before" or "after") from a single CSS selector.
 * Returns null if the selector doesn't end with ::before or ::after.
 */
function extractPseudo(selector) {
	const match = selector.match(/::(before|after)\s*$/);
	return match ? match[1] : null;
}

/**
 * Build a CSSStyleSheet with companion, relocation, and suppression rules
 * for ::before/::after pseudo elements.
 *
 * For each rule with ::before/::after, generates:
 * 1. A style companion rule targeting frag-pseudo (all props except content)
 * 2. For counter/attr/mixed content: a relocation rule on frag-pseudo's own ::before/::after
 *
 * Also appends global suppression rules that hide original pseudo elements
 * on elements marked with data-frag-resolved-* attributes (set later by
 * materializePseudoElements). These attribute-based selectors are inert
 * until materialization adds the attributes, so they're safe to include
 * before materialization runs.
 *
 * Modules can opt out via registry.claimPseudoRule().
 *
 * @param {CSSStyleSheet[]} styles — input stylesheets to scan
 * @param {{ claimPseudoRule: Function }} registry — module registry
 * @returns {CSSStyleSheet}
 */
export function buildPseudoStyleSheet(styles, registry) {
	const sheet = new CSSStyleSheet();

	for (const srcSheet of styles) {
		let rules;
		try {
			rules = srcSheet.cssRules;
		} catch {
			continue;
		}
		collectPseudoRules(rules, sheet, registry);
	}

	// Append global suppression rules. These use data-frag-resolved-*
	// attribute selectors that only match after materializePseudoElements
	// sets the attributes, so they're safe to include from the start.
	// Placing them here ensures they're in contentStyles for all
	// fragment containers, including across segmented measurement.
	if (sheet.cssRules.length > 0) {
		try {
			sheet.insertRule(
				"[data-frag-resolved-before]::before { content: none !important; }",
				sheet.cssRules.length,
			);
		} catch {
			/* */
		}
		try {
			sheet.insertRule(
				"[data-frag-resolved-after]::after { content: none !important; }",
				sheet.cssRules.length,
			);
		} catch {
			/* */
		}
	}

	return sheet;
}

/**
 * Recursively walk CSS rules, handling grouping rules (@media, @supports, etc.)
 * Same pattern as body-selectors.js collectBodyOverrides.
 */
function collectPseudoRules(ruleList, target, registry) {
	for (const rule of ruleList) {
		if (rule.selectorText !== undefined) {
			rewritePseudoRule(rule, target, registry);
		} else if (rule.cssRules) {
			const preamble = rule.cssText.substring(0, rule.cssText.indexOf("{")).trim();
			const inner = new CSSStyleSheet();
			collectPseudoRules(rule.cssRules, inner, registry);
			if (inner.cssRules.length > 0) {
				let innerCSS = "";
				for (const r of inner.cssRules) {
					innerCSS += r.cssText + "\n";
				}
				try {
					target.insertRule(`${preamble} { ${innerCSS} }`, target.cssRules.length);
				} catch {
					/* invalid grouping rule */
				}
			}
		}
	}
}

/**
 * Rewrite a single CSS style rule that targets ::before/::after.
 * Generates companion and relocation rules only (no suppression).
 */
function rewritePseudoRule(rule, target, registry) {
	const selectors = rule.selectorText.split(",").map((s) => s.trim());

	const styleSelectors = [];
	const relocateSelectors = [];

	// Check for content property in this rule
	const content = rule.style.getPropertyValue("content").trim();
	let hasContent = false;
	let contentIsStringOnly = false;

	if (content) {
		hasContent = true;
		contentIsStringOnly = parseContentValue(content).isStringOnly;
	}

	for (const sel of selectors) {
		const pseudo = extractPseudo(sel);
		if (!pseudo) continue;

		if (registry.claimPseudoRule(rule, pseudo)) continue;

		const base = sel.replace(/::(before|after)\s*$/, "").trim();
		const fragSel = `${base} > frag-pseudo[data-pseudo="${pseudo}"]`;

		styleSelectors.push(fragSel);

		if (hasContent && !contentIsStringOnly) {
			relocateSelectors.push(`${fragSel}::${pseudo}`);
		}
	}

	if (styleSelectors.length === 0) return;

	// 1. Style companion rule (all properties except content)
	const styleDecls = [];
	for (let i = 0; i < rule.style.length; i++) {
		const prop = rule.style[i];
		if (prop === "content") continue;
		const val = rule.style.getPropertyValue(prop);
		const priority = rule.style.getPropertyPriority(prop);
		styleDecls.push(`${prop}: ${val}${priority ? " !" + priority : ""}`);
	}
	if (styleDecls.length > 0) {
		try {
			target.insertRule(
				`${styleSelectors.join(", ")} { ${styleDecls.join("; ")}; }`,
				target.cssRules.length,
			);
		} catch {
			/* invalid rule */
		}
	}

	// 2. Relocation rule (counter/attr/mixed content → synthetic element's own pseudo)
	if (relocateSelectors.length > 0) {
		try {
			target.insertRule(
				`${relocateSelectors.join(", ")} { content: ${content}; }`,
				target.cssRules.length,
			);
		} catch {
			/* invalid rule */
		}
	}
}

// ——— DOM materialization ———

/**
 * Walk all elements under root and materialize detected ::before/::after
 * pseudo elements as <frag-pseudo> children.
 *
 * Idempotent — checks for existing synthetic children before inserting.
 * Modules can claim pseudos via registry.claimPseudo() to prevent
 * materialization of pseudos they manage.
 *
 * Sets data-frag-resolved-before/after attributes on resolved parents
 * so the suppression rules in buildPseudoStyleSheet take effect on the
 * next reflow.
 *
 * @param {Element} root — content root to walk
 * @param {{ claimPseudo: Function }} registry — module registry
 */
export function materializePseudoElements(root, registry) {
	const elements = root.querySelectorAll("*");
	for (const el of elements) {
		if (el.tagName === PSEUDO_TAG) continue;
		materializePseudo(el, "before", registry);
		materializePseudo(el, "after", registry);
	}
}

function materializePseudo(el, which, registry) {
	const pseudoStyle = getComputedStyle(el, "::" + which);
	const content = pseudoStyle.content;

	if (!content || content === "none" || content === "normal") return;

	// Idempotency check
	const candidate = which === "before" ? el.firstElementChild : el.lastElementChild;
	if (candidate?.tagName === PSEUDO_TAG && candidate.dataset.pseudo === which) return;

	// Let modules claim this pseudo
	if (registry.claimPseudo(el, which, content)) return;

	const synthetic = document.createElement("frag-pseudo");
	synthetic.setAttribute("role", "none");
	synthetic.dataset.pseudo = which;

	const parsed = parseContentValue(content);

	if (parsed.isStringOnly) {
		// String content — set text directly for full inline participation
		synthetic.textContent = parsed.text;
		// Copy display from pseudo computed style
		const display = pseudoStyle.display;
		if (display && display !== "inline") {
			synthetic.style.display = display;
		}
	} else {
		// Counter/attr/mixed — relocation strategy.
		// buildPseudoStyleSheet already created a rule that sets content on
		// this element's own ::before/::after. Match the original pseudo's
		// display so padding/sizing behaves identically (inline padding
		// doesn't affect line height, inline-block does).
		const display = pseudoStyle.display;
		if (display === "block" || display === "flex" || display === "grid") {
			synthetic.style.display = display;
		} else if (display === "inline-block") {
			synthetic.style.display = "inline-block";
		}
		// else: leave as inline (default), matching the original pseudo
	}

	if (which === "before") {
		el.insertBefore(synthetic, el.firstChild);
	} else {
		el.appendChild(synthetic);
	}

	// Mark parent so suppression rules in the pseudo stylesheet
	// (already adopted) target the original pseudo on next reflow
	el.setAttribute(`data-frag-resolved-${which}`, "");
}
