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

export { UA_DEFAULTS, UA_DEFAULTS_HOST_TEXT };
