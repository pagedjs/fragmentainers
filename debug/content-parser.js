/**
 * ContentParser — parse an HTML string into a DocumentFragment + CSSStyleSheets
 * with all relative URLs resolved against the content's origin.
 *
 * Replaces the fetchAndParse / preprocessContent pipeline that previously
 * used regex-based URL rebasing. CSS url() references are rewritten to
 * absolute URLs because the CSSStyleSheet `baseURL` constructor option is
 * not honored for @font-face loading in Chromium (fonts otherwise resolve
 * against document.baseURI).
 */

/** Attributes that carry URLs and should be resolved. */
const URL_ATTRS = ["src", "href", "poster", "data"];

/** URLs that are already absolute or use a scheme we should not rewrite. */
const ABSOLUTE_URL_RE = /^(?:https?:|data:|blob:|javascript:|mailto:|tel:|#|\/\/)/i;

/** Rename `position: running(...)` to `--page-position: running(...)` custom property. */
const RUNNING_POSITION_RE = /position\s*:\s*(running\([^)]*\))/gi;

/** Rewrite `float: footnote` to a custom property + display: none. */
const FLOAT_FOOTNOTE_RE = /float\s*:\s*footnote/gi;

/** Rewrite `footnote-display` to a custom property. */
const FOOTNOTE_DISPLAY_RE = /footnote-display\s*:/gi;

/** Rewrite `footnote-policy` to a custom property. */
const FOOTNOTE_POLICY_RE = /footnote-policy\s*:/gi;

/** Rewrite `::footnote-call` pseudo-element to attribute selector. */
const FOOTNOTE_CALL_RE = /::footnote-call/g;

/** Rewrite `::footnote-marker` pseudo-element to attribute selector. */
const FOOTNOTE_MARKER_RE = /::footnote-marker/g;

/** Match `url(...)` references in CSS (captures optional quote + URL body). */
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/g;

export class ContentParser {
	#fragment;
	#styles;

	constructor(fragment, styles) {
		this.#fragment = fragment;
		this.#styles = styles;
	}

	/** @returns {DocumentFragment} body content with resolved URLs */
	get fragment() {
		return this.#fragment;
	}

	/** @returns {CSSStyleSheet[]} source sheets + URL override sheet */
	get styles() {
		return this.#styles;
	}

	/**
	 * Parse an HTML string and return a ContentParser with a ready-to-use
	 * DocumentFragment and resolved CSSStyleSheets.
	 *
	 * @param {string} content — full HTML document string
	 * @param {string} baseURL — base URL for resolving relative paths
	 * @returns {Promise<ContentParser>}
	 */
	static async fromString(content, baseURL) {
		baseURL = new URL(baseURL, document.baseURI).href;
		const doc = new DOMParser().parseFromString(content, "text/html");

		ContentParser.resolveURLs(doc.head, baseURL);
		const fragment = ContentParser.html(doc, baseURL);
		const styles = await ContentParser.css(doc, baseURL);

		return new ContentParser(fragment, styles);
	}

	/**
	 * Extract body content from a parsed document into a DocumentFragment
	 * with all relative URLs resolved.
	 *
	 * @param {Document} doc — parsed HTML document
	 * @param {string} baseURL — absolute base URL for resolving relative paths
	 * @returns {DocumentFragment}
	 */
	static html(doc, baseURL) {
		const fragment = document.createDocumentFragment();
		const template = doc.querySelector("template#flow");
		const source = template ? template.content : doc.body;

		while (source.firstChild) {
			fragment.appendChild(document.adoptNode(source.firstChild));
		}

		ContentParser.resolveURLs(fragment, baseURL);
		return fragment;
	}

	/**
	 * Collect and build CSSStyleSheets from a parsed document's
	 * inline styles and linked stylesheets, with resolved URLs.
	 *
	 * @param {Document} doc — parsed HTML document
	 * @param {string} baseURL — absolute base URL for resolving relative paths
	 * @returns {Promise<CSSStyleSheet[]>}
	 */
	static async css(doc, baseURL) {
		const cssEntries = [];

		for (const style of doc.querySelectorAll("style")) {
			cssEntries.push({ css: style.textContent, cssBaseURL: baseURL });
		}

		for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
			const href = link.getAttribute("href");
			if (!href) continue;
			let cssURL;
			try {
				cssURL = new URL(href, baseURL).href;
			} catch (e) {
				console.warn(`Invalid stylesheet URL: ${href}`, e);
				continue;
			}
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 10000);
			try {
				const response = await fetch(cssURL, { signal: controller.signal });
				if (!response.ok) {
					console.warn(`Failed to fetch stylesheet ${cssURL}: HTTP ${response.status}`);
					continue;
				}
				cssEntries.push({ css: await response.text(), cssBaseURL: cssURL });
			} catch (e) {
				console.warn(`Failed to fetch stylesheet ${cssURL}:`, e);
			} finally {
				clearTimeout(timeoutId);
			}
		}

		return ContentParser.#buildSheets(cssEntries);
	}

	/**
	 * Convert the current document's styleSheets into constructed
	 * CSSStyleSheets that can be adopted into shadow roots.
	 * Cross-origin sheets that cannot be read are silently skipped.
	 *
	 * @returns {CSSStyleSheet[]}
	 */
	static collectDocumentStyles() {
		if (typeof document === "undefined") return [];
		const sheets = [];
		for (const sheet of document.styleSheets) {
			try {
				const constructed = new CSSStyleSheet();
				let css = "";
				for (const rule of sheet.cssRules) {
					css += rule.cssText + "\n";
				}
				constructed.replaceSync(css);
				sheets.push(constructed);
			} catch {
				// Cross-origin sheets can't be read — skip
			}
		}

		document.adoptedStyleSheets.push(...sheets);
		return sheets;
	}

	// DOM URL resolution

	/**
	 * Walk any root (DocumentFragment, Element, or head) and resolve
	 * relative URL attributes (src/href/poster/data) against baseURL.
	 *
	 * @param {DocumentFragment|Element} root
	 * @param {string} baseURL — absolute base URL for resolving relative paths
	 */
	static resolveURLs(root, baseURL) {
		for (const el of root.querySelectorAll("*")) {
			for (const attr of URL_ATTRS) {
				const value = el.getAttribute(attr);
				if (value && !ABSOLUTE_URL_RE.test(value)) {
					try {
						el.setAttribute(attr, new URL(value, baseURL).href);
					} catch {
						// Malformed URL — leave as-is
					}
				}
			}
		}
	}

	/**
	 * Rewrite relative `url(...)` references in CSS text to absolute URLs
	 * against baseURL. Leaves absolute URLs, data:, blob:, and fragment (#)
	 * references untouched.
	 *
	 * @param {string} css
	 * @param {string} baseURL
	 * @returns {string}
	 */
	static #resolveCSSURLs(css, baseURL) {
		return css.replace(CSS_URL_RE, (match, quote, url) => {
			const trimmed = url.trim();
			if (!trimmed || ABSOLUTE_URL_RE.test(trimmed)) return match;
			try {
				return `url(${quote}${new URL(trimmed, baseURL).href}${quote})`;
			} catch {
				return match;
			}
		});
	}

	/**
	 * Build CSSStyleSheets from CSS entries, rewriting relative url()
	 * references to absolute URLs against each entry's baseURL.
	 *
	 * @param {{ css: string, cssBaseURL: string }[]} cssEntries
	 * @returns {CSSStyleSheet[]}
	 */
	static #buildSheets(cssEntries) {
		const sheets = [];

		for (let { css, cssBaseURL } of cssEntries) {
			css = ContentParser.#resolveCSSURLs(css, cssBaseURL);
			css = css.replace(RUNNING_POSITION_RE, "--page-position: $1; display: none");
			css = css.replace(FLOAT_FOOTNOTE_RE, "--float: footnote; display: none");
			css = css.replace(FOOTNOTE_DISPLAY_RE, "--footnote-display:");
			css = css.replace(FOOTNOTE_POLICY_RE, "--footnote-policy:");
			css = css.replace(FOOTNOTE_CALL_RE, "[data-footnote-call]::after");
			css = css.replace(FOOTNOTE_MARKER_RE, "[data-footnote-marker]::marker");
			const sheet = new CSSStyleSheet({ baseURL: cssBaseURL });
			sheet.replaceSync(css);
			sheets.push(sheet);
		}

		return sheets;
	}
}
