/**
 * Minimal DOM globals for Node.js tests that import browser-only modules.
 *
 * Must be loaded via --import before any test file so that module-level
 * code (e.g. `new CSSStyleSheet()` in overrides.js) can execute.
 */
if (typeof HTMLElement === "undefined") {
  globalThis.HTMLElement = class HTMLElement {};
  globalThis.CSSStyleSheet = class CSSStyleSheet {
    replaceSync() {}
  };
  globalThis.customElements = { define() {} };
}
