import { describe, it, expect } from "vitest";
import { parseAnPlusB, matchesAnPlusB, rewriteNthSelectors, stampNthAttributes } from "../src/nth-selectors.js";

// ---------------------------------------------------------------------------
// parseAnPlusB
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// matchesAnPlusB
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// rewriteNthSelectors
// ---------------------------------------------------------------------------

describe("rewriteNthSelectors", () => {
  it("rewrites :first-child", () => {
    const { cssText } = rewriteNthSelectors("li:first-child { color: red; }");
    expect(cssText).toBe("li[data-child-index=\"1\"] { color: red; }");
  });

  it("rewrites :last-child", () => {
    const { cssText } = rewriteNthSelectors("li:last-child { color: blue; }");
    expect(cssText).toBe("li[data-last-child] { color: blue; }");
  });

  it("rewrites :first-of-type", () => {
    const { cssText } = rewriteNthSelectors("p:first-of-type { margin: 0; }");
    expect(cssText).toBe("p[data-type-index=\"1\"] { margin: 0; }");
  });

  it("rewrites :last-of-type", () => {
    const { cssText } = rewriteNthSelectors("p:last-of-type { margin: 0; }");
    expect(cssText).toBe("p[data-last-of-type] { margin: 0; }");
  });

  it("rewrites :only-child", () => {
    const { cssText } = rewriteNthSelectors("div:only-child { width: 100%; }");
    expect(cssText).toBe("div[data-child-index=\"1\"][data-last-child] { width: 100%; }");
  });

  it("rewrites :only-of-type", () => {
    const { cssText } = rewriteNthSelectors("h1:only-of-type { text-align: center; }");
    expect(cssText).toBe("h1[data-type-index=\"1\"][data-last-of-type] { text-align: center; }");
  });

  it("rewrites :nth-child(N) to attribute selector", () => {
    const { cssText } = rewriteNthSelectors("li:nth-child(3) { color: red; }");
    expect(cssText).toBe("li[data-child-index=\"3\"] { color: red; }");
  });

  it("rewrites :nth-of-type(N) to attribute selector", () => {
    const { cssText } = rewriteNthSelectors("p:nth-of-type(2) { margin: 0; }");
    expect(cssText).toBe("p[data-type-index=\"2\"] { margin: 0; }");
  });

  it("rewrites :nth-child(odd) to formula attribute", () => {
    const { cssText, formulas } = rewriteNthSelectors("tr:nth-child(odd) { background: #eee; }");
    expect(cssText).toContain("[data-nth-child-2np1]");
    expect(formulas.size).toBe(1);
    const formula = [...formulas.values()][0];
    expect(formula.a).toBe(2);
    expect(formula.b).toBe(1);
    expect(formula.isType).toBe(false);
    expect(formula.isLast).toBe(false);
  });

  it("rewrites :nth-child(even) to formula attribute", () => {
    const { cssText, formulas } = rewriteNthSelectors("tr:nth-child(even) { background: #ddd; }");
    expect(cssText).toContain("[data-nth-child-2np0]");
    expect(formulas.size).toBe(1);
  });

  it("rewrites :nth-child(2n+1) to formula attribute", () => {
    const { cssText, formulas } = rewriteNthSelectors("li:nth-child(2n+1) { color: red; }");
    expect(cssText).toContain("[data-nth-child-2np1]");
    expect(formulas.size).toBe(1);
  });

  it("rewrites :nth-last-child(N) to formula attribute", () => {
    const { cssText, formulas } = rewriteNthSelectors("li:nth-last-child(2) { color: red; }");
    expect(cssText).toContain("[data-nth-last-child-0np2]");
    expect(formulas.size).toBe(1);
    const formula = [...formulas.values()][0];
    expect(formula.isLast).toBe(true);
  });

  it("rewrites :nth-last-of-type(odd) to formula attribute", () => {
    const { cssText, formulas } = rewriteNthSelectors("p:nth-last-of-type(odd) { color: blue; }");
    expect(cssText).toContain("[data-nth-last-of-type-2np1]");
    const formula = [...formulas.values()][0];
    expect(formula.isType).toBe(true);
    expect(formula.isLast).toBe(true);
  });

  it("deduplicates identical formulas across rules", () => {
    const css = "tr:nth-child(odd) { bg: a; } td:nth-child(odd) { bg: b; }";
    const { formulas } = rewriteNthSelectors(css);
    expect(formulas.size).toBe(1);
  });

  it("accumulates formulas across calls with shared map", () => {
    const formulas = new Map();
    rewriteNthSelectors("tr:nth-child(odd) { bg: a; }", formulas);
    rewriteNthSelectors("td:nth-child(even) { bg: b; }", formulas);
    expect(formulas.size).toBe(2);
  });

  it("preserves non-nth selectors", () => {
    const { cssText } = rewriteNthSelectors("div.foo > p { color: red; }");
    expect(cssText).toBe("div.foo > p { color: red; }");
  });

  it("handles multiple pseudo-classes in one rule", () => {
    const { cssText } = rewriteNthSelectors("ul > li:first-child:last-child { color: red; }");
    expect(cssText).toBe("ul > li[data-child-index=\"1\"][data-last-child] { color: red; }");
  });
});

// ---------------------------------------------------------------------------
// stampNthAttributes
// ---------------------------------------------------------------------------

describe("stampNthAttributes", () => {
  /**
   * Helper: create a minimal mock node with a real parentElement reference.
   */
  function createMockSiblings(tagNames) {
    // Use a lightweight approach with objects
    const parent = { children: [], tagName: "DIV" };
    const elements = tagNames.map(tag => ({
      tagName: tag.toUpperCase(),
      parentElement: parent,
    }));
    parent.children = elements;
    // Make it array-like with length and indexing
    Object.defineProperty(parent.children, "length", { value: elements.length });
    return elements;
  }

  function createMockEl() {
    const attrs = {};
    return {
      setAttribute(name, value) { attrs[name] = value; },
      getAttribute(name) { return attrs[name] ?? null; },
      _attrs: attrs,
    };
  }

  it("stamps data-child-index and data-type-index", () => {
    const elements = createMockSiblings(["li", "li", "li"]);
    const el = createMockEl();
    const node = { element: elements[1] };
    stampNthAttributes(el, node, new Map());
    expect(el._attrs["data-child-index"]).toBe("2");
    expect(el._attrs["data-type-index"]).toBe("2");
  });

  it("stamps data-last-child on last element", () => {
    const elements = createMockSiblings(["li", "li", "li"]);
    const el = createMockEl();
    const node = { element: elements[2] };
    stampNthAttributes(el, node, new Map());
    expect(el._attrs["data-child-index"]).toBe("3");
    expect(el._attrs["data-last-child"]).toBe("");
    expect(el._attrs["data-last-of-type"]).toBe("");
  });

  it("does not stamp data-last-child on non-last element", () => {
    const elements = createMockSiblings(["li", "li", "li"]);
    const el = createMockEl();
    const node = { element: elements[0] };
    stampNthAttributes(el, node, new Map());
    expect(el._attrs["data-last-child"]).toBeUndefined();
  });

  it("computes type-index across mixed tag types", () => {
    const elements = createMockSiblings(["p", "div", "p", "div", "p"]);
    const el = createMockEl();
    const node = { element: elements[4] }; // 3rd <p>
    stampNthAttributes(el, node, new Map());
    expect(el._attrs["data-child-index"]).toBe("5");
    expect(el._attrs["data-type-index"]).toBe("3");
    expect(el._attrs["data-last-child"]).toBe("");
    expect(el._attrs["data-last-of-type"]).toBe("");
  });

  it("stamps formula-matching attributes for nth-child(odd)", () => {
    const elements = createMockSiblings(["li", "li", "li", "li"]);
    const formulas = new Map();
    formulas.set("nth-child:2:1", {
      pseudo: "nth-child", a: 2, b: 1,
      attr: "data-nth-child-2np1", isType: false, isLast: false,
    });

    // 1st child (odd) — should match
    const el1 = createMockEl();
    stampNthAttributes(el1, { element: elements[0] }, formulas);
    expect(el1._attrs["data-nth-child-2np1"]).toBe("");

    // 2nd child (even) — should not match
    const el2 = createMockEl();
    stampNthAttributes(el2, { element: elements[1] }, formulas);
    expect(el2._attrs["data-nth-child-2np1"]).toBeUndefined();

    // 3rd child (odd) — should match
    const el3 = createMockEl();
    stampNthAttributes(el3, { element: elements[2] }, formulas);
    expect(el3._attrs["data-nth-child-2np1"]).toBe("");
  });

  it("stamps formula-matching attributes for nth-last-child", () => {
    const elements = createMockSiblings(["li", "li", "li", "li"]);
    const formulas = new Map();
    formulas.set("nth-last-child:0:2", {
      pseudo: "nth-last-child", a: 0, b: 2,
      attr: "data-nth-last-child-0np2", isType: false, isLast: true,
    });

    // 3rd child = 2nd from last — should match
    const el3 = createMockEl();
    stampNthAttributes(el3, { element: elements[2] }, formulas);
    expect(el3._attrs["data-nth-last-child-0np2"]).toBe("");

    // 4th child = 1st from last — should not match
    const el4 = createMockEl();
    stampNthAttributes(el4, { element: elements[3] }, formulas);
    expect(el4._attrs["data-nth-last-child-0np2"]).toBeUndefined();
  });

  it("skips elements without parentElement", () => {
    const el = createMockEl();
    const node = { element: { tagName: "DIV", parentElement: null } };
    stampNthAttributes(el, node, new Map());
    expect(el._attrs["data-child-index"]).toBeUndefined();
  });

  it("skips nodes without element", () => {
    const el = createMockEl();
    const node = { element: null };
    stampNthAttributes(el, node, new Map());
    expect(el._attrs["data-child-index"]).toBeUndefined();
  });
});
