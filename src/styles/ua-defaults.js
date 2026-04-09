/**
 * UA stylesheet defaults for the slot element (body stand-in).
 *
 * Browsers apply `body { margin: 8px }` from the user-agent stylesheet,
 * but UA rules are not accessible through document.styleSheets. When the
 * engine extracts body content into a DocumentFragment and injects it
 * into a shadow DOM slot, the body's UA margin is lost.
 *
 * This stylesheet restores those defaults on the slot. It is placed
 * first in the adopted stylesheet list so any author body rules
 * (rewritten to slot rules by body-selectors.js) override it by
 * source order.
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

export { UA_DEFAULTS };
