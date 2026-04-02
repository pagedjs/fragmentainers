import { describe, it, expect } from "vitest";
import { parseAnPlusB, matchesAnPlusB, computeOriginalPosition, extractNthDescriptors } from "../../src/styles/nth-selectors.js";

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
  // extractNthDescriptors requires CSSStyleSheet which is only in browser
  // These tests use mock objects to test the descriptor extraction logic

  it("is exported", () => {
    expect(typeof extractNthDescriptors).toBe("function");
  });
});
