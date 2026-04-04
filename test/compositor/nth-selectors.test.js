import { describe, it, expect } from "vitest";
import { parseAnPlusB, matchesAnPlusB, computeOriginalPosition, extractNthDescriptors, buildPerFragmentNthSheet } from "../../src/modules/nth-selectors.js";
import { modules } from "../../src/modules/registry.js";

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

  it("parses negative integer", () => {
    expect(parseAnPlusB("-2")).toEqual({ a: 0, b: -2 });
  });

  it("parses 'n'", () => {
    expect(parseAnPlusB("n")).toEqual({ a: 1, b: 0 });
  });

  it("parses '-n+6'", () => {
    expect(parseAnPlusB("-n+6")).toEqual({ a: -1, b: 6 });
  });

  it("parses '2n+1'", () => {
    expect(parseAnPlusB("2n+1")).toEqual({ a: 2, b: 1 });
  });

  it("parses '2n'", () => {
    expect(parseAnPlusB("2n")).toEqual({ a: 2, b: 0 });
  });

  it("parses '+n'", () => {
    expect(parseAnPlusB("+n")).toEqual({ a: 1, b: 0 });
  });

  it("parses '-3n-2'", () => {
    expect(parseAnPlusB("-3n-2")).toEqual({ a: -3, b: -2 });
  });

  it("handles whitespace", () => {
    expect(parseAnPlusB(" 2n + 1 ")).toEqual({ a: 2, b: 1 });
  });
});

describe("matchesAnPlusB", () => {
  it("matches exact index", () => {
    expect(matchesAnPlusB(3, { a: 0, b: 3 })).toBe(true);
    expect(matchesAnPlusB(2, { a: 0, b: 3 })).toBe(false);
  });

  it("matches odd (2n+1)", () => {
    expect(matchesAnPlusB(1, { a: 2, b: 1 })).toBe(true);
    expect(matchesAnPlusB(2, { a: 2, b: 1 })).toBe(false);
    expect(matchesAnPlusB(3, { a: 2, b: 1 })).toBe(true);
  });

  it("matches even (2n)", () => {
    expect(matchesAnPlusB(2, { a: 2, b: 0 })).toBe(true);
    expect(matchesAnPlusB(4, { a: 2, b: 0 })).toBe(true);
    expect(matchesAnPlusB(1, { a: 2, b: 0 })).toBe(false);
  });

  it("matches -n+3 (first 3 elements)", () => {
    expect(matchesAnPlusB(1, { a: -1, b: 3 })).toBe(true);
    expect(matchesAnPlusB(2, { a: -1, b: 3 })).toBe(true);
    expect(matchesAnPlusB(3, { a: -1, b: 3 })).toBe(true);
    expect(matchesAnPlusB(4, { a: -1, b: 3 })).toBe(false);
  });
});

describe("computeOriginalPosition", () => {
  it("computes position for a single child", () => {
    const parent = document.createElement("div");
    const child = document.createElement("p");
    parent.appendChild(child);
    document.body.appendChild(parent);

    const pos = computeOriginalPosition(child);
    expect(pos).toEqual({
      childIndex: 1,
      typeIndex: 1,
      childFromEnd: 1,
      typeFromEnd: 1,
      totalChildren: 1,
      totalOfType: 1,
    });

    document.body.removeChild(parent);
  });

  it("computes position for middle child", () => {
    const parent = document.createElement("ul");
    parent.innerHTML = "<li>a</li><li>b</li><li>c</li>";
    document.body.appendChild(parent);

    const pos = computeOriginalPosition(parent.children[1]);
    expect(pos.childIndex).toBe(2);
    expect(pos.typeIndex).toBe(2);
    expect(pos.childFromEnd).toBe(2);
    expect(pos.typeFromEnd).toBe(2);

    document.body.removeChild(parent);
  });

  it("handles mixed tag types", () => {
    const parent = document.createElement("div");
    parent.innerHTML = "<p>first</p><span>mid</span><p>last</p>";
    document.body.appendChild(parent);

    const lastP = parent.children[2];
    const pos = computeOriginalPosition(lastP);
    expect(pos.childIndex).toBe(3);
    expect(pos.typeIndex).toBe(2);
    expect(pos.totalChildren).toBe(3);
    expect(pos.totalOfType).toBe(2);

    document.body.removeChild(parent);
  });

  it("returns null for orphan elements", () => {
    const orphan = document.createElement("div");
    expect(computeOriginalPosition(orphan)).toBeNull();
  });
});

describe("extractNthDescriptors", () => {
  function sheetFrom(cssText) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    return sheet;
  }

  it("extracts :first-child rules", () => {
    const sheet = sheetFrom("li:first-child { color: red; }");
    const descriptors = extractNthDescriptors([sheet]);
    expect(descriptors.length).toBe(1);
    expect(descriptors[0].baseSelector).toBe("li");
    expect(descriptors[0].nthParts).toEqual([{ a: 0, b: 1, isType: false, isLast: false }]);
    expect(descriptors[0].cssText).toContain("color");
  });

  it("extracts :nth-child(odd) rules", () => {
    const sheet = sheetFrom("li:nth-child(odd) { background: pink; }");
    const descriptors = extractNthDescriptors([sheet]);
    expect(descriptors.length).toBe(1);
    expect(descriptors[0].nthParts[0].a).toBe(2);
    expect(descriptors[0].nthParts[0].b).toBe(1);
  });

  it("captures @media wrappers", () => {
    const sheet = sheetFrom("@media (min-width: 0px) { li:first-child { color: red; } }");
    const descriptors = extractNthDescriptors([sheet]);
    expect(descriptors.length).toBe(1);
    expect(descriptors[0].wrappers.length).toBe(1);
    expect(descriptors[0].wrappers[0]).toContain("@media");
  });

  it("handles multiple sheets", () => {
    const s1 = sheetFrom("li:first-child { color: red; }");
    const s2 = sheetFrom("p:last-child { font-weight: bold; }");
    const descriptors = extractNthDescriptors([s1, s2]);
    expect(descriptors.length).toBe(2);
  });

  it("returns empty array for sheets without nth rules", () => {
    const sheet = sheetFrom("div { color: blue; }");
    expect(extractNthDescriptors([sheet]).length).toBe(0);
  });
});

describe("buildPerFragmentNthSheet", () => {
  function createSlotWith(html) {
    const slot = document.createElement("div");
    slot.innerHTML = html;
    return slot;
  }

  function registerClones(slot, sourceParent) {
    const clones = slot.querySelectorAll("*");
    const sources = sourceParent.children;
    for (let i = 0; i < clones.length && i < sources.length; i++) {
      modules.trackClone(clones[i], sources[i]);
    }
  }

  it("returns null for empty descriptors", () => {
    const slot = createSlotWith("<li>a</li><li>b</li>");
    const result = buildPerFragmentNthSheet(slot, []);
    expect(result).toBeNull();
  });

  it("generates :is([data-ref=...]) rules for :first-child", () => {
    const sourceUl = document.createElement("ul");
    sourceUl.innerHTML = "<li>a</li><li>b</li><li>c</li>";
    document.body.appendChild(sourceUl);

    const slot = createSlotWith("<li>a</li><li>b</li><li>c</li>");
    registerClones(slot, sourceUl);

    const descriptors = [{
      baseSelector: "li",
      nthParts: [{ a: 0, b: 1, isType: false, isLast: false }],
      cssText: "color: red;",
      wrappers: [],
    }];

    const sheet = buildPerFragmentNthSheet(slot, descriptors);
    expect(sheet).not.toBeNull();
    expect(sheet.cssRules.length).toBe(1);
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
    registerClones(slot, sourceUl);

    const descriptors = [{
      baseSelector: "li",
      nthParts: [{ a: 2, b: 1, isType: false, isLast: false }],
      cssText: "background: pink;",
      wrappers: [],
    }];

    const sheet = buildPerFragmentNthSheet(slot, descriptors);
    expect(sheet).not.toBeNull();
    expect(sheet.cssRules.length).toBe(1);
    const ruleText = sheet.cssRules[0].cssText;
    // Positions 1 and 3 match odd — check that 2 refs are present
    const matches = ruleText.match(/data-ref/g);
    expect(matches.length).toBe(2);

    document.body.removeChild(sourceUl);
  });

  it("wraps rules in grouping contexts", () => {
    const sourceUl = document.createElement("ul");
    sourceUl.innerHTML = "<li>a</li>";
    document.body.appendChild(sourceUl);

    const slot = createSlotWith("<li>a</li>");
    registerClones(slot, sourceUl);

    const descriptors = [{
      baseSelector: "li",
      nthParts: [{ a: 0, b: 1, isType: false, isLast: false }],
      cssText: "color: red;",
      wrappers: ["@media (min-width: 0px)"],
    }];

    const sheet = buildPerFragmentNthSheet(slot, descriptors);
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
    registerClones(slot, sourceUl);

    const descriptors = [{
      baseSelector: "li",
      nthParts: [{ a: 0, b: 5, isType: false, isLast: false }],
      cssText: "color: red;",
      wrappers: [],
    }];

    const sheet = buildPerFragmentNthSheet(slot, descriptors);
    expect(sheet).toBeNull();

    document.body.removeChild(sourceUl);
  });

  it("handles :last-child", () => {
    const sourceUl = document.createElement("ul");
    sourceUl.innerHTML = "<li>a</li><li>b</li><li>c</li>";
    document.body.appendChild(sourceUl);

    const slot = createSlotWith("<li>a</li><li>b</li><li>c</li>");
    registerClones(slot, sourceUl);

    const descriptors = [{
      baseSelector: "li",
      nthParts: [{ a: 0, b: 1, isType: false, isLast: true }],
      cssText: "color: blue;",
      wrappers: [],
    }];

    const sheet = buildPerFragmentNthSheet(slot, descriptors);
    expect(sheet).not.toBeNull();
    const ruleText = sheet.cssRules[0].cssText;
    // Only 1 data-ref (the last li)
    const matches = ruleText.match(/data-ref/g);
    expect(matches.length).toBe(1);

    document.body.removeChild(sourceUl);
  });

  it("handles :only-child (two nthParts)", () => {
    const sourceDiv = document.createElement("div");
    sourceDiv.innerHTML = "<p>only child</p>";
    document.body.appendChild(sourceDiv);

    const slot = createSlotWith("<p>only child</p>");
    registerClones(slot, sourceDiv);

    const descriptors = [{
      baseSelector: "p",
      nthParts: [
        { a: 0, b: 1, isType: false, isLast: false },
        { a: 0, b: 1, isType: false, isLast: true },
      ],
      cssText: "font-weight: bold;",
      wrappers: [],
    }];

    const sheet = buildPerFragmentNthSheet(slot, descriptors);
    expect(sheet).not.toBeNull();
    expect(sheet.cssRules[0].cssText).toContain("data-ref");

    document.body.removeChild(sourceDiv);
  });
});
