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
        NodeFilter: "readonly",
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
        CSSPageRule: "readonly",
        CustomEvent: "readonly",
        ResizeObserver: "readonly",
        MutationObserver: "readonly",
        queueMicrotask: "readonly",
        setTimeout: "readonly",
        CSSRule: "readonly",
        CSSFontFaceRule: "readonly",
        FontFace: "readonly",
        Image: "readonly",
        // Node.js test globals
        console: "readonly",
        process: "readonly",
      },
    },
    rules: {
      quotes: ["error", "double", { avoidEscape: true }],
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "no-underscore-dangle": [
        "error",
        {
          enforceInClassFields: true,
          enforceInMethodNames: true,
          allowAfterThis: false,
          allowFunctionParams: true,
          allowInArrayDestructuring: true,
          allowInObjectDestructuring: true,
        },
      ],
    },
  },
  {
    ignores: ["**", "!src/**", "!test/**", "!specs/**", "!debug/**"],
  },
];
