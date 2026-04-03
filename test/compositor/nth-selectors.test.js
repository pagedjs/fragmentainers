import { describe, it, expect } from "vitest";
import { parseAnPlusB, matchesAnPlusB, computeOriginalPosition, extractNthDescriptors, buildPerFragmentNthSheet } from "../../src/styles/nth-selectors.js";

describe("parseAnPlusB", () => {
  it("parses 'odd'", () => {
    expect(parseAnPlusB("odd")).toEqual({ a: 2, b: 1 });
  });

  it("parses 'even'", () => {
    expect(parseAnPlusB("even")).toEqual({ a: 2, b: 0 });
  });

  it("parses a plain integer", () => {
    expect(parseAnPlusB("3")).toEqual({ a: 0, b: 3 });
  });

  it("parses a negative integer", () => {
    expect(parseAnPlusB("-2")).toEqual({ a: 0, b: -2 });
  });

  it("parses 'n'", () => {
    expect(parseAnPlusB("n")).toEqual({ a: 1, b: 0 });
  });

  it("parses '2n'", () => {
    expect(parseAnPlusB("2n")).toEqual({ a: 2, b: 0 });
  });

  it("parses '2n+1'", () => {
    expect(parseAnPlusB("2n+1")).toEqual({ a: 2, b: 1 });
  });

  it("parses '3n-2'", () => {
    expect(parseAnPlusB("3n-2")).toEqual({ a: 3, b: -2 });
  });

  it("parses '-n+6'", () => {
    expect(parseAnPlusB("-n+6")).toEqual({ a: -1, b: 6 });
  });

  it("parses '+n'", () => {
    expect(parseAnPlusB("+n")).toEqual({ a: 1, b: 0 });
  });

  it("parses '-3n-2'", () => {
    expect(parseAnPlusB("-3n-2")).toEqual({ a: -3, b: -2 });
  });

  it("handles whitespace", () => {
    expect(parseAnPlusB("  2n + 1  ")).toEqual({ a: 2, b: 1 });
  });

  it("parses 'n+3'", () => {
    expect(parseAnPlusB("n+3")).toEqual({ a: 1, b: 3 });
  });
});

describe("matchesAnPlusB", () => {
  it("matches exact index (a=0)", () => {
    expect(matchesAnPlusB(3, { a: 0, b: 3 })).toBe(true);
    expect(matchesAnPlusB(2, { a: 0, b: 3 })).toBe(false);
  });

  it("matches odd (2n+1)", () => {
    const odd = { a: 2, b: 1 };
    expect(matchesAnPlusB(1, odd)).toBe(true);
    expect(matchesAnPlusB(2, odd)).toBe(false);
    expect(matchesAnPlusB(3, odd)).toBe(true);
    expect(matchesAnPlusB(4, odd)).toBe(false);
  });

  it("matches even (2n)", () => {
    const even = { a: 2, b: 0 };
    expect(matchesAnPlusB(1, even)).toBe(false);
    expect(matchesAnPlusB(2, even)).toBe(true);
    expect(matchesAnPlusB(3, even)).toBe(false);
    expect(matchesAnPlusB(4, even)).toBe(true);
  });

  it("matches 3n+1", () => {
    const formula = { a: 3, b: 1 };
    expect(matchesAnPlusB(1, formula)).toBe(true);  // n=0
    expect(matchesAnPlusB(2, formula)).toBe(false);
    expect(matchesAnPlusB(4, formula)).toBe(true);  // n=1
    expect(matchesAnPlusB(7, formula)).toBe(true);  // n=2
  });

  it("matches -n+3 (first 3)", () => {
    const formula = { a: -1, b: 3 };
    expect(matchesAnPlusB(1, formula)).toBe(true);  // n=2
    expect(matchesAnPlusB(2, formula)).toBe(true);  // n=1
    expect(matchesAnPlusB(3, formula)).toBe(true);  // n=0
    expect(matchesAnPlusB(4, formula)).toBe(false); // n=-1, negative
  });

  it("rejects negative n results", () => {
    expect(matchesAnPlusB(10, { a: 2, b: 1 })).toBe(false);
    expect(matchesAnPlusB(11, { a: 2, b: 1 })).toBe(true);
  });
});

describe("computeOriginalPosition", () => {
  function createMockSiblings(tagNames) {
    const parent = { children: [], tagName: "DIV" };
    const elements = tagNames.map(tag => ({
      tagName: tag.toUpperCase(),
      parentElement: parent,
    }));
    parent.children = elements;
    Object.defineProperty(parent.children, "length", { value: elements.length });
    // Make children iterable
    parent.children[Symbol.iterator] = function* () {
      for (let i = 0; i < this.length; i++) yield this[i];
    };
    return elements;
  }

  it("computes child index and type index", () => {
    const elements = createMockSiblings(["li", "li", "li"]);
    const pos = computeOriginalPosition(elements[1]);
    expect(pos.childIndex).toBe(2);
    expect(pos.typeIndex).toBe(2);
  });

  it("computes last-child position", () => {
    const elements = createMockSiblings(["li", "li", "li"]);
    const pos = computeOriginalPosition(elements[2]);
    expect(pos.childIndex).toBe(3);
    expect(pos.childFromEnd).toBe(1);
    expect(pos.totalChildren).toBe(3);
  });

  it("computes type index across mixed tag types", () => {
    const elements = createMockSiblings(["p", "div", "p", "div", "p"]);
    const pos = computeOriginalPosition(elements[4]); // 3rd <p>
    expect(pos.childIndex).toBe(5);
    expect(pos.typeIndex).toBe(3);
    expect(pos.totalOfType).toBe(3);
  });

  it("returns null for elements without parentElement", () => {
    const el = { tagName: "DIV", parentElement: null };
    expect(computeOriginalPosition(el)).toBeNull();
  });

  it("returns null for null elements", () => {
    expect(computeOriginalPosition(null)).toBeNull();
  });

  it("computes childFromEnd and typeFromEnd", () => {
    const elements = createMockSiblings(["li", "li", "li", "li"]);
    const pos = computeOriginalPosition(elements[2]); // 3rd of 4
    expect(pos.childIndex).toBe(3);
    expect(pos.childFromEnd).toBe(2);
    expect(pos.typeFromEnd).toBe(2);
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
