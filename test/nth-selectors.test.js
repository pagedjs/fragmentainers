import { describe, it, expect } from "vitest";
import { parseAnPlusB, matchesAnPlusB, rewriteSelectorText, stampNthAttributes } from "../src/nth-selectors.js";

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

describe("stampNthAttributes", () => {
  function createMockSiblings(tagNames) {
    const parent = { children: [], tagName: "DIV" };
    const elements = tagNames.map(tag => ({
      tagName: tag.toUpperCase(),
      parentElement: parent,
    }));
    parent.children = elements;
    Object.defineProperty(parent.children, "length", { value: elements.length });
    return elements;
  }

  function createMockEl() {
    const attrs = {};
    return {
      setAttribute(name, value) { attrs[name] = value; },
      getAttribute(name) { return attrs[name] ?? null; },
      attrs,
    };
  }

  it("stamps data-child-index and data-type-index", () => {
    const elements = createMockSiblings(["li", "li", "li"]);
    const el = createMockEl();
    const node = { element: elements[1] };
    stampNthAttributes(el, node, new Map());
    expect(el.attrs["data-child-index"]).toBe("2");
    expect(el.attrs["data-type-index"]).toBe("2");
  });

  it("stamps data-last-child on last element", () => {
    const elements = createMockSiblings(["li", "li", "li"]);
    const el = createMockEl();
    const node = { element: elements[2] };
    stampNthAttributes(el, node, new Map());
    expect(el.attrs["data-child-index"]).toBe("3");
    expect(el.attrs["data-last-child"]).toBe("");
    expect(el.attrs["data-last-of-type"]).toBe("");
  });

  it("does not stamp data-last-child on non-last element", () => {
    const elements = createMockSiblings(["li", "li", "li"]);
    const el = createMockEl();
    const node = { element: elements[0] };
    stampNthAttributes(el, node, new Map());
    expect(el.attrs["data-last-child"]).toBeUndefined();
  });

  it("computes type-index across mixed tag types", () => {
    const elements = createMockSiblings(["p", "div", "p", "div", "p"]);
    const el = createMockEl();
    const node = { element: elements[4] }; // 3rd <p>
    stampNthAttributes(el, node, new Map());
    expect(el.attrs["data-child-index"]).toBe("5");
    expect(el.attrs["data-type-index"]).toBe("3");
    expect(el.attrs["data-last-child"]).toBe("");
    expect(el.attrs["data-last-of-type"]).toBe("");
  });

  it("stamps formula-matching attributes for nth-child(odd)", () => {
    const elements = createMockSiblings(["li", "li", "li", "li"]);
    const formulas = new Map();
    formulas.set("nth-child:2:1", {
      pseudo: "nth-child", a: 2, b: 1,
      attr: "data-nth-child-2np1", isType: false, isLast: false,
    });

    const el1 = createMockEl();
    stampNthAttributes(el1, { element: elements[0] }, formulas);
    expect(el1.attrs["data-nth-child-2np1"]).toBe("");

    const el2 = createMockEl();
    stampNthAttributes(el2, { element: elements[1] }, formulas);
    expect(el2.attrs["data-nth-child-2np1"]).toBeUndefined();

    const el3 = createMockEl();
    stampNthAttributes(el3, { element: elements[2] }, formulas);
    expect(el3.attrs["data-nth-child-2np1"]).toBe("");
  });

  it("stamps formula-matching attributes for nth-last-child", () => {
    const elements = createMockSiblings(["li", "li", "li", "li"]);
    const formulas = new Map();
    formulas.set("nth-last-child:0:2", {
      pseudo: "nth-last-child", a: 0, b: 2,
      attr: "data-nth-last-child-0np2", isType: false, isLast: true,
    });

    const el3 = createMockEl();
    stampNthAttributes(el3, { element: elements[2] }, formulas);
    expect(el3.attrs["data-nth-last-child-0np2"]).toBe("");

    const el4 = createMockEl();
    stampNthAttributes(el4, { element: elements[3] }, formulas);
    expect(el4.attrs["data-nth-last-child-0np2"]).toBeUndefined();
  });

  it("skips elements without parentElement", () => {
    const el = createMockEl();
    const node = { element: { tagName: "DIV", parentElement: null } };
    stampNthAttributes(el, node, new Map());
    expect(el.attrs["data-child-index"]).toBeUndefined();
  });

  it("skips nodes without element", () => {
    const el = createMockEl();
    const node = { element: null };
    stampNthAttributes(el, node, new Map());
    expect(el.attrs["data-child-index"]).toBeUndefined();
  });
});
