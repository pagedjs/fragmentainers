import { describe, it, expect } from "vitest";
import { rewriteNthSelectorsOnSheet, extractNthDescriptors, buildPerFragmentNthSheet } from "../src/styles/nth-selectors.js";

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

describe("extractNthDescriptors", () => {
  function createSheet(cssText) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    return sheet;
  }

  it("extracts :first-child descriptor", () => {
    const sheet = createSheet("li:first-child { color: red; }");
    const descriptors = extractNthDescriptors([sheet]);
    expect(descriptors.length).toBe(1);
    expect(descriptors[0].baseSelector).toBe("li");
    expect(descriptors[0].nthParts).toEqual([
      { a: 0, b: 1, isType: false, isLast: false },
    ]);
    expect(descriptors[0].cssText).toContain("color");
    expect(descriptors[0].wrappers).toEqual([]);
  });

  it("extracts :last-child descriptor", () => {
    const sheet = createSheet("li:last-child { color: blue; }");
    const descriptors = extractNthDescriptors([sheet]);
    expect(descriptors.length).toBe(1);
    expect(descriptors[0].nthParts).toEqual([
      { a: 0, b: 1, isType: false, isLast: true },
    ]);
  });

  it("extracts :only-child as two parts", () => {
    const sheet = createSheet("div:only-child { margin: 0; }");
    const descriptors = extractNthDescriptors([sheet]);
    expect(descriptors.length).toBe(1);
    expect(descriptors[0].nthParts.length).toBe(2);
    expect(descriptors[0].nthParts[0]).toEqual({ a: 0, b: 1, isType: false, isLast: false });
    expect(descriptors[0].nthParts[1]).toEqual({ a: 0, b: 1, isType: false, isLast: true });
  });

  it("extracts :nth-child(odd) descriptor", () => {
    const sheet = createSheet("tr:nth-child(odd) { background: #eee; }");
    const descriptors = extractNthDescriptors([sheet]);
    expect(descriptors.length).toBe(1);
    expect(descriptors[0].baseSelector).toBe("tr");
    expect(descriptors[0].nthParts).toEqual([
      { a: 2, b: 1, isType: false, isLast: false },
    ]);
  });

  it("extracts :nth-of-type(even) descriptor", () => {
    const sheet = createSheet("p:nth-of-type(even) { margin: 0; }");
    const descriptors = extractNthDescriptors([sheet]);
    expect(descriptors[0].nthParts).toEqual([
      { a: 2, b: 0, isType: true, isLast: false },
    ]);
  });

  it("extracts :nth-last-child descriptor", () => {
    const sheet = createSheet("li:nth-last-child(2) { color: red; }");
    const descriptors = extractNthDescriptors([sheet]);
    expect(descriptors[0].nthParts).toEqual([
      { a: 0, b: 2, isType: false, isLast: true },
    ]);
  });

  it("preserves compound selector parts", () => {
    const sheet = createSheet("table.striped > tr:nth-child(odd) { background: pink; }");
    const descriptors = extractNthDescriptors([sheet]);
    expect(descriptors[0].baseSelector).toBe("table.striped > tr");
  });

  it("does not mutate the original sheet", () => {
    const sheet = createSheet("li:first-child { color: red; }");
    const originalSelector = sheet.cssRules[0].selectorText;
    extractNthDescriptors([sheet]);
    expect(sheet.cssRules[0].selectorText).toBe(originalSelector);
  });

  it("skips rules without nth pseudo-classes", () => {
    const sheet = createSheet("div.foo { color: red; } li:last-child { color: blue; }");
    const descriptors = extractNthDescriptors([sheet]);
    expect(descriptors.length).toBe(1);
    expect(descriptors[0].baseSelector).toBe("li");
  });

  it("preserves @media wrappers", () => {
    const sheet = createSheet("@media (min-width: 0px) { li:first-child { color: red; } }");
    const descriptors = extractNthDescriptors([sheet]);
    expect(descriptors.length).toBe(1);
    expect(descriptors[0].wrappers.length).toBe(1);
    expect(descriptors[0].wrappers[0]).toContain("@media");
  });

  it("handles multiple input sheets", () => {
    const sheet1 = createSheet("li:first-child { color: red; }");
    const sheet2 = createSheet("p:last-of-type { margin: 0; }");
    const descriptors = extractNthDescriptors([sheet1, sheet2]);
    expect(descriptors.length).toBe(2);
  });

  it("returns empty array for sheets without nth selectors", () => {
    const sheet = createSheet("div.foo { color: red; }");
    const descriptors = extractNthDescriptors([sheet]);
    expect(descriptors).toEqual([]);
  });

  it("uses * as base selector when nth is the entire selector", () => {
    const sheet = createSheet(":first-child { color: red; }");
    const descriptors = extractNthDescriptors([sheet]);
    expect(descriptors[0].baseSelector).toBe("*");
  });
});

describe("buildPerFragmentNthSheet", () => {
  function createSlotWith(html) {
    const slot = document.createElement("div");
    slot.innerHTML = html;
    return slot;
  }

  function createRefMap(slot, sourceParent) {
    const refMap = new Map();
    const clones = slot.querySelectorAll("*");
    const sources = sourceParent.children;
    for (let i = 0; i < clones.length && i < sources.length; i++) {
      const ref = String(i);
      clones[i].setAttribute("data-ref", ref);
      refMap.set(ref, sources[i]);
    }
    return refMap;
  }

  it("returns null for empty descriptors", () => {
    const slot = createSlotWith("<li>a</li><li>b</li>");
    const result = buildPerFragmentNthSheet(slot, [], new Map());
    expect(result).toBeNull();
  });

  it("generates :is([data-ref=...]) rules for :first-child", () => {
    // Source DOM: <ul><li>a</li><li>b</li><li>c</li></ul>
    const sourceUl = document.createElement("ul");
    sourceUl.innerHTML = "<li>a</li><li>b</li><li>c</li>";
    document.body.appendChild(sourceUl);

    // Fragment clone: same structure
    const slot = createSlotWith("<li>a</li><li>b</li><li>c</li>");
    const refMap = createRefMap(slot, sourceUl);

    const descriptors = [{
      baseSelector: "li",
      nthParts: [{ a: 0, b: 1, isType: false, isLast: false }], // :first-child
      cssText: "color: red;",
      wrappers: [],
    }];

    const sheet = buildPerFragmentNthSheet(slot, descriptors, refMap);
    expect(sheet).not.toBeNull();
    expect(sheet.cssRules.length).toBe(1);
    // Should contain data-ref for the first li only
    const ruleText = sheet.cssRules[0].cssText;
    expect(ruleText).toContain("data-ref");
    expect(ruleText).toContain("color");

    document.body.removeChild(sourceUl);
  });

  it("generates rules for :nth-child(odd)", () => {
    const sourceUl = document.createElement("ul");
    sourceUl.innerHTML = "<li>1</li><li>2</li><li>3</li><li>4</li>";
    document.body.appendChild(sourceUl);

    const slot = createSlotWith("<li>1</li><li>2</li><li>3</li><li>4</li>");
    const refMap = createRefMap(slot, sourceUl);

    const descriptors = [{
      baseSelector: "li",
      nthParts: [{ a: 2, b: 1, isType: false, isLast: false }], // :nth-child(odd)
      cssText: "background: pink;",
      wrappers: [],
    }];

    const sheet = buildPerFragmentNthSheet(slot, descriptors, refMap);
    expect(sheet).not.toBeNull();
    expect(sheet.cssRules.length).toBe(1);
    // Should match elements at positions 1 and 3 (refs "0" and "2")
    const ruleText = sheet.cssRules[0].cssText;
    expect(ruleText).toContain("[data-ref=\"0\"]");
    expect(ruleText).toContain("[data-ref=\"2\"]");
    expect(ruleText).not.toContain("[data-ref=\"1\"]");
    expect(ruleText).not.toContain("[data-ref=\"3\"]");

    document.body.removeChild(sourceUl);
  });

  it("wraps rules in grouping contexts", () => {
    const sourceUl = document.createElement("ul");
    sourceUl.innerHTML = "<li>a</li>";
    document.body.appendChild(sourceUl);

    const slot = createSlotWith("<li>a</li>");
    const refMap = createRefMap(slot, sourceUl);

    const descriptors = [{
      baseSelector: "li",
      nthParts: [{ a: 0, b: 1, isType: false, isLast: false }],
      cssText: "color: red;",
      wrappers: ["@media (min-width: 0px)"],
    }];

    const sheet = buildPerFragmentNthSheet(slot, descriptors, refMap);
    expect(sheet).not.toBeNull();
    const outerRule = sheet.cssRules[0];
    expect(outerRule.cssText).toContain("@media");
    expect(outerRule.cssRules[0].cssText).toContain("data-ref");

    document.body.removeChild(sourceUl);
  });

  it("returns null when no elements match", () => {
    const sourceUl = document.createElement("ul");
    sourceUl.innerHTML = "<li>a</li><li>b</li>";
    document.body.appendChild(sourceUl);

    const slot = createSlotWith("<li>a</li><li>b</li>");
    const refMap = createRefMap(slot, sourceUl);

    const descriptors = [{
      baseSelector: "li",
      nthParts: [{ a: 0, b: 5, isType: false, isLast: false }], // :nth-child(5) — no match
      cssText: "color: red;",
      wrappers: [],
    }];

    const sheet = buildPerFragmentNthSheet(slot, descriptors, refMap);
    expect(sheet).toBeNull();

    document.body.removeChild(sourceUl);
  });

  it("handles :last-child", () => {
    const sourceUl = document.createElement("ul");
    sourceUl.innerHTML = "<li>a</li><li>b</li><li>c</li>";
    document.body.appendChild(sourceUl);

    const slot = createSlotWith("<li>a</li><li>b</li><li>c</li>");
    const refMap = createRefMap(slot, sourceUl);

    const descriptors = [{
      baseSelector: "li",
      nthParts: [{ a: 0, b: 1, isType: false, isLast: true }], // :last-child
      cssText: "color: blue;",
      wrappers: [],
    }];

    const sheet = buildPerFragmentNthSheet(slot, descriptors, refMap);
    expect(sheet).not.toBeNull();
    const ruleText = sheet.cssRules[0].cssText;
    // Only the last li (ref "2") should match
    expect(ruleText).toContain("[data-ref=\"2\"]");
    expect(ruleText).not.toContain("[data-ref=\"0\"]");
    expect(ruleText).not.toContain("[data-ref=\"1\"]");

    document.body.removeChild(sourceUl);
  });

  it("handles :only-child (two nthParts)", () => {
    const sourceDiv = document.createElement("div");
    sourceDiv.innerHTML = "<p>only child</p>";
    document.body.appendChild(sourceDiv);

    const slot = createSlotWith("<p>only child</p>");
    const refMap = createRefMap(slot, sourceDiv);

    const descriptors = [{
      baseSelector: "p",
      nthParts: [
        { a: 0, b: 1, isType: false, isLast: false }, // first-child
        { a: 0, b: 1, isType: false, isLast: true },  // last-child
      ],
      cssText: "font-weight: bold;",
      wrappers: [],
    }];

    const sheet = buildPerFragmentNthSheet(slot, descriptors, refMap);
    expect(sheet).not.toBeNull();
    expect(sheet.cssRules[0].cssText).toContain("[data-ref=\"0\"]");

    document.body.removeChild(sourceDiv);
  });
});
