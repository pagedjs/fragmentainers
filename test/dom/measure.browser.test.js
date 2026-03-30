import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createRangeMeasurer,
  measureElementBlockSize,
  getLineHeight,
  parseLength,
} from "../../src/dom/measure.js";

let container;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe("measureElementBlockSize", () => {
  it("returns the height of an element with explicit height", () => {
    const div = document.createElement("div");
    div.style.height = "80px";
    container.appendChild(div);
    expect(measureElementBlockSize(div)).toBe(80);
  });

  it("includes padding and border in the measurement", () => {
    const div = document.createElement("div");
    div.style.height = "50px";
    div.style.paddingTop = "10px";
    div.style.paddingBottom = "10px";
    div.style.borderTop = "5px solid black";
    div.style.borderBottom = "5px solid black";
    div.style.boxSizing = "content-box";
    container.appendChild(div);
    // content-box: total = height + padding + border = 50 + 20 + 10 = 80
    expect(measureElementBlockSize(div)).toBe(80);
  });
});

describe("getLineHeight", () => {
  it("returns an explicit pixel line-height", () => {
    const div = document.createElement("div");
    div.style.lineHeight = "24px";
    container.appendChild(div);
    expect(getLineHeight(div)).toBe(24);
  });

  it("returns fontSize * 1.2 when line-height is normal", () => {
    const div = document.createElement("div");
    div.style.lineHeight = "normal";
    div.style.fontSize = "20px";
    container.appendChild(div);
    expect(getLineHeight(div)).toBe(24);
  });
});

describe("createRangeMeasurer", () => {
  describe("measureRange", () => {
    it("returns a positive width for a text substring", () => {
      const div = document.createElement("div");
      div.style.fontFamily = "monospace";
      div.style.fontSize = "16px";
      div.style.whiteSpace = "pre";
      div.textContent = "ABCDEFGHIJ";
      container.appendChild(div);

      const measurer = createRangeMeasurer();
      const textNode = div.firstChild;

      const width5 = measurer.measureRange(textNode, 0, 5);
      const width10 = measurer.measureRange(textNode, 0, 10);

      expect(width5).toBeGreaterThan(0);
      expect(width10).toBeGreaterThan(0);
      // 10 chars should be roughly double 5 chars in monospace
      expect(width10).toBeCloseTo(width5 * 2, 0);
    });
  });

  describe("charTop", () => {
    it("returns different top values for characters on different lines", () => {
      const div = document.createElement("div");
      div.style.fontFamily = "monospace";
      div.style.fontSize = "16px";
      div.style.lineHeight = "20px";
      div.style.width = "50px";
      div.style.wordBreak = "break-all";
      // Enough text to wrap to multiple lines in a 50px-wide container
      div.textContent = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      container.appendChild(div);

      const measurer = createRangeMeasurer();
      const textNode = div.firstChild;

      const topFirst = measurer.charTop(textNode, 0);
      // Pick an offset far enough along to be on a later line
      const topLater = measurer.charTop(textNode, 20);

      expect(topFirst).not.toBe(Infinity);
      expect(topLater).not.toBe(Infinity);
      expect(topLater).toBeGreaterThan(topFirst);
    });
  });
});

describe("parseLength", () => {
  it("parses px values", () => {
    expect(parseLength("42px", 0, 0)).toBe(42);
  });

  it("parses percentage values relative to parentSize", () => {
    expect(parseLength("50%", 200, 0)).toBe(100);
  });

  it("parses em values relative to fontSize", () => {
    expect(parseLength("2em", 0, 16)).toBe(32);
  });

  it("parses rem values using the document root font size", () => {
    const rootFontSize = parseFloat(
      getComputedStyle(document.documentElement).fontSize
    );
    expect(rootFontSize).toBeGreaterThan(0);
    expect(parseLength("2rem", 0, 0)).toBe(2 * rootFontSize);
  });

  it("returns null for auto", () => {
    expect(parseLength("auto", 0, 0)).toBeNull();
  });

  it("returns null for none", () => {
    expect(parseLength("none", 0, 0)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseLength("", 0, 0)).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(parseLength(null, 0, 0)).toBeNull();
    expect(parseLength(undefined, 0, 0)).toBeNull();
  });
});
