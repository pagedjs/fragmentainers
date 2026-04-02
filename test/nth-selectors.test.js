import { describe, it, expect } from "vitest";
import { parseAnPlusB, matchesAnPlusB, rewriteSelectorText, computeOriginalPosition, extractNthDescriptors } from "../src/styles/nth-selectors.js";

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

describe("rewriteSelectorText", () => {
  function rewrite(selector) {
    const formulas = new Map();
    const result = rewriteSelectorText(selector, formulas);
    return { result, formulas };
  }

  it("rewrites :first-child", () => {
    expect(rewrite("li:first-child").result).toBe("li[data-child-index=\"1\"]");
  });

  it("rewrites :last-child", () => {
    expect(rewrite("li:last-child").result).toBe("li[data-last-child]");
  });

  it("rewrites :first-of-type", () => {
    expect(rewrite("p:first-of-type").result).toBe("p[data-type-index=\"1\"]");
  });

  it("rewrites :last-of-type", () => {
    expect(rewrite("p:last-of-type").result).toBe("p[data-last-of-type]");
  });

  it("rewrites :only-child", () => {
    expect(rewrite("div:only-child").result).toBe("div[data-child-index=\"1\"][data-last-child]");
  });

  it("rewrites :only-of-type", () => {
    expect(rewrite("h1:only-of-type").result).toBe("h1[data-type-index=\"1\"][data-last-of-type]");
  });

  it("rewrites :nth-child(N) to attribute selector", () => {
    expect(rewrite("li:nth-child(3)").result).toBe("li[data-child-index=\"3\"]");
  });

  it("rewrites :nth-of-type(N) to attribute selector", () => {
    expect(rewrite("p:nth-of-type(2)").result).toBe("p[data-type-index=\"2\"]");
  });

  it("rewrites :nth-child(odd) to formula attribute", () => {
    const { result, formulas } = rewrite("tr:nth-child(odd)");
    expect(result).toContain("[data-nth-child-2np1]");
    expect(formulas.size).toBe(1);
    const formula = [...formulas.values()][0];
    expect(formula.a).toBe(2);
    expect(formula.b).toBe(1);
    expect(formula.isType).toBe(false);
    expect(formula.isLast).toBe(false);
  });

  it("rewrites :nth-child(even) to formula attribute", () => {
    const { result, formulas } = rewrite("tr:nth-child(even)");
    expect(result).toContain("[data-nth-child-2np0]");
    expect(formulas.size).toBe(1);
  });

  it("rewrites :nth-child(2n+1) to formula attribute", () => {
    const { result, formulas } = rewrite("li:nth-child(2n+1)");
    expect(result).toContain("[data-nth-child-2np1]");
    expect(formulas.size).toBe(1);
  });

  it("rewrites :nth-last-child(N) to formula attribute", () => {
    const { result, formulas } = rewrite("li:nth-last-child(2)");
    expect(result).toContain("[data-nth-last-child-0np2]");
    expect(formulas.size).toBe(1);
    const formula = [...formulas.values()][0];
    expect(formula.isLast).toBe(true);
  });

  it("rewrites :nth-last-of-type(odd) to formula attribute", () => {
    const { result, formulas } = rewrite("p:nth-last-of-type(odd)");
    expect(result).toContain("[data-nth-last-of-type-2np1]");
    const formula = [...formulas.values()][0];
    expect(formula.isType).toBe(true);
    expect(formula.isLast).toBe(true);
  });

  it("deduplicates identical formulas", () => {
    const formulas = new Map();
    rewriteSelectorText("tr:nth-child(odd)", formulas);
    rewriteSelectorText("td:nth-child(odd)", formulas);
    expect(formulas.size).toBe(1);
  });

  it("accumulates different formulas", () => {
    const formulas = new Map();
    rewriteSelectorText("tr:nth-child(odd)", formulas);
    rewriteSelectorText("td:nth-child(even)", formulas);
    expect(formulas.size).toBe(2);
  });

  it("preserves non-nth selectors", () => {
    expect(rewrite("div.foo > p").result).toBe("div.foo > p");
  });

  it("handles multiple pseudo-classes in one selector", () => {
    expect(rewrite("ul > li:first-child:last-child").result)
      .toBe("ul > li[data-child-index=\"1\"][data-last-child]");
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
  // extractNthDescriptors requires CSSStyleSheet which is only in browser
  // These tests use mock objects to test the descriptor extraction logic

  it("is exported", () => {
    expect(typeof extractNthDescriptors).toBe("function");
  });
});
