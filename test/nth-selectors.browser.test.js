import { describe, it, expect } from "vitest";
import { rewriteNthSelectorsOnSheet } from "../src/nth-selectors.js";

// ---------------------------------------------------------------------------
// rewriteNthSelectorsOnSheet — CSSOM-based rewriting
// ---------------------------------------------------------------------------

describe("rewriteNthSelectorsOnSheet", () => {
  function createSheet(cssText) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    return sheet;
  }

  it("rewrites :first-child in selectorText", () => {
    const sheet = createSheet("li:first-child { color: red; }");
    rewriteNthSelectorsOnSheet(sheet);
    expect(sheet.cssRules[0].selectorText).toContain("[data-child-index=\"1\"]");
    expect(sheet.cssRules[0].selectorText).not.toContain(":first-child");
  });

  it("rewrites :last-child in selectorText", () => {
    const sheet = createSheet("li:last-child { color: blue; }");
    rewriteNthSelectorsOnSheet(sheet);
    expect(sheet.cssRules[0].selectorText).toContain("[data-last-child]");
  });

  it("rewrites :nth-child(N) to attribute selector", () => {
    const sheet = createSheet("li:nth-child(3) { color: red; }");
    rewriteNthSelectorsOnSheet(sheet);
    expect(sheet.cssRules[0].selectorText).toContain("[data-child-index=\"3\"]");
  });

  it("rewrites :nth-child(odd) and collects formula", () => {
    const sheet = createSheet("tr:nth-child(odd) { background: #eee; }");
    const { formulas } = rewriteNthSelectorsOnSheet(sheet);
    expect(sheet.cssRules[0].selectorText).toContain("[data-nth-child-2np1]");
    expect(formulas.size).toBe(1);
    const formula = [...formulas.values()][0];
    expect(formula.a).toBe(2);
    expect(formula.b).toBe(1);
  });

  it("rewrites :nth-of-type(even) and collects formula", () => {
    const sheet = createSheet("p:nth-of-type(even) { margin: 0; }");
    const { formulas } = rewriteNthSelectorsOnSheet(sheet);
    expect(sheet.cssRules[0].selectorText).toContain("[data-nth-of-type-2np0]");
    expect(formulas.size).toBe(1);
    const formula = [...formulas.values()][0];
    expect(formula.isType).toBe(true);
  });

  it("recurses into @media rules", () => {
    const sheet = createSheet("@media (min-width: 0) { li:first-child { color: red; } }");
    rewriteNthSelectorsOnSheet(sheet);
    const mediaRule = sheet.cssRules[0];
    expect(mediaRule.cssRules[0].selectorText).toContain("[data-child-index=\"1\"]");
  });

  it("recurses into @supports rules", () => {
    const sheet = createSheet("@supports (display: grid) { div:last-of-type { color: blue; } }");
    rewriteNthSelectorsOnSheet(sheet);
    const supportsRule = sheet.cssRules[0];
    expect(supportsRule.cssRules[0].selectorText).toContain("[data-last-of-type]");
  });

  it("leaves @font-face and @keyframes untouched", () => {
    const sheet = createSheet(`
      @font-face { font-family: "Test"; src: local("Test"); }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    `);
    rewriteNthSelectorsOnSheet(sheet);
    // Should not throw; rules preserved
    expect(sheet.cssRules.length).toBe(2);
  });

  it("accumulates formulas across multiple sheets", () => {
    const formulas = new Map();
    const sheet1 = createSheet("tr:nth-child(odd) { background: #eee; }");
    const sheet2 = createSheet("td:nth-child(even) { background: #ddd; }");
    rewriteNthSelectorsOnSheet(sheet1, formulas);
    rewriteNthSelectorsOnSheet(sheet2, formulas);
    expect(formulas.size).toBe(2);
  });

  it("deduplicates identical formulas across sheets", () => {
    const formulas = new Map();
    const sheet1 = createSheet("tr:nth-child(odd) { background: #eee; }");
    const sheet2 = createSheet("li:nth-child(odd) { color: red; }");
    rewriteNthSelectorsOnSheet(sheet1, formulas);
    rewriteNthSelectorsOnSheet(sheet2, formulas);
    expect(formulas.size).toBe(1);
  });

  it("handles multiple rules in one sheet", () => {
    const sheet = createSheet(`
      li:first-child { color: red; }
      li:last-child { color: blue; }
      p:nth-of-type(2) { margin: 0; }
    `);
    const { formulas } = rewriteNthSelectorsOnSheet(sheet);
    expect(sheet.cssRules[0].selectorText).toContain("[data-child-index=\"1\"]");
    expect(sheet.cssRules[1].selectorText).toContain("[data-last-child]");
    expect(sheet.cssRules[2].selectorText).toContain("[data-type-index=\"2\"]");
    expect(formulas.size).toBe(0); // all simple rewrites, no formulas needed
  });

  it("preserves non-nth selectors", () => {
    const sheet = createSheet("div.foo > p { color: red; }");
    rewriteNthSelectorsOnSheet(sheet);
    expect(sheet.cssRules[0].selectorText).toBe("div.foo > p");
  });

  it("returns the same sheet object (mutates in place)", () => {
    const sheet = createSheet("li:first-child { color: red; }");
    const { sheet: returned } = rewriteNthSelectorsOnSheet(sheet);
    expect(returned).toBe(sheet);
  });
});
