/**
 * UA stylesheet defaults restoring `body { margin: 8px }` for the
 * body stand-in. UA rules aren't reachable through document.styleSheets,
 * so the engine restates them.
 *
 * `UA_DEFAULTS` adopts on `<content-measure>`'s shadow; targets the
 * `slot` and `:host` body/html stand-ins.
 *
 * `UA_DEFAULTS_HOST_TEXT` concatenates into the document-level scoped
 * sheet; targets `:scope` (the fragment-container host).
 */

const UA_DEFAULTS = new CSSStyleSheet();
UA_DEFAULTS.replaceSync(`
    :host {
      height: 100%;
    }
    slot {
      margin: 8px;
    }
    :host(fragment-container:not([data-first])) > slot {
      margin-block-start: 0 !important;
    }
    :host(fragment-container:not([data-last])) > slot {
      margin-block-end: 0 !important;
    }
  `);

const UA_DEFAULTS_HOST_TEXT = `
:scope { margin: 8px; }
:scope:not([data-first]) { margin-block-start: 0 !important; }
:scope:not([data-last])  { margin-block-end:   0 !important; }
`;

/**
 * Elements the UA stylesheet hides outright. `noscript` is among them because
 * the engine runs with scripting enabled.
 *
 * HTML §15.3.1 "Hidden elements".
 */
const UA_DISPLAY_NONE = new Set([
	"area", "base", "basefont", "datalist", "head", "link", "meta", "noembed",
	"noframes", "noscript", "param", "rp", "script", "style", "template", "title",
]);

/**
 * The display value the UA stylesheet gives an element. Needed for content
 * measured off the document, where `getComputedStyle` is unavailable and UA
 * rules are not reachable through `document.styleSheets`; a caller seeds the
 * cascade with this, so any author or inline declaration replaces it.
 *
 * Covers HTML §15.3.1 (hidden elements and `[hidden]`) and the two column
 * displays of §15.3.9 (tables). Everything else is left at its initial value.
 *
 * @param {Element} el - The element to classify.
 * @returns {string|null} A CSS display value, or null when the UA sheet sets none.
 */
export function uaDisplay(el) {
	if (el.hasAttribute("hidden")) return "none";
	const tag = el.tagName.toLowerCase();
	if (UA_DISPLAY_NONE.has(tag)) return "none";
	if (tag === "col") return "table-column";
	if (tag === "colgroup") return "table-column-group";
	return null;
}

export { UA_DEFAULTS, UA_DEFAULTS_HOST_TEXT };
