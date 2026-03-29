import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        // Browser globals
        document: "readonly",
        window: "readonly",
        HTMLElement: "readonly",
        Node: "readonly",
        CSSStyleSheet: "readonly",
        getComputedStyle: "readonly",
        customElements: "readonly",
        requestAnimationFrame: "readonly",
        location: "readonly",
        fetch: "readonly",
        DocumentFragment: "readonly",
        DOMParser: "readonly",
        URL: "readonly",
        performance: "readonly",
        // Node.js test globals
        console: "readonly",
      },
    },
    rules: {
      quotes: ["error", "double", { avoidEscape: true }],
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    ignores: ["node_modules/", ".claude/", "specs/", "viewer/"],
  },
];
