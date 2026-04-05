import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createRangeMeasurer,
  createCaretMeasurer,
  measureElementBlockSize,
  getLineHeight,
  parseLength,
} from "../../src/dom/measure.js";
import { INLINE_TEXT } from "../../src/core/constants.js";

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

describe("createCaretMeasurer", () => {
  describe("charTop", () => {
    it("returns different top values for characters on different lines", () => {
      const div = document.createElement("div");
      div.style.fontFamily = "monospace";
      div.style.fontSize = "16px";
      div.style.lineHeight = "20px";
      div.style.width = "50px";
      div.style.wordBreak = "break-all";
      div.textContent = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      container.appendChild(div);

      const measurer = createCaretMeasurer();
      const textNode = div.firstChild;

      const topFirst = measurer.charTop(textNode, 0);
      const topLater = measurer.charTop(textNode, 20);

      expect(topFirst).not.toBe(Infinity);
      expect(topLater).not.toBe(Infinity);
      expect(topLater).toBeGreaterThan(topFirst);
    });
  });

  describe("offsetAtY", () => {
    it("returns the flat offset at the start of a given line", () => {
      const div = document.createElement("div");
      div.style.fontFamily = "monospace";
      div.style.fontSize = "16px";
      div.style.lineHeight = "20px";
      div.style.width = "50px";
      div.style.wordBreak = "break-all";
      div.textContent = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      container.appendChild(div);

      const textNode = div.firstChild;
      const items = [{
        type: INLINE_TEXT,
        startOffset: 0,
        endOffset: div.textContent.length,
        domNode: textNode,
      }];

      const measurer = createCaretMeasurer();
      const rect = div.getBoundingClientRect();

      // Probe at the top of the second line
      const offset = measurer.offsetAtY(div, items, rect.top + 20);
      expect(offset).not.toBeNull();
      expect(offset).toBeGreaterThan(0);
      expect(offset).toBeLessThan(div.textContent.length);
    });

    it("returns offset consistent with charTop", () => {
      const div = document.createElement("div");
      div.style.fontFamily = "monospace";
      div.style.fontSize = "16px";
      div.style.lineHeight = "20px";
      div.style.width = "80px";
      div.style.wordBreak = "break-all";
      div.textContent = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefgh";
      container.appendChild(div);

      const textNode = div.firstChild;
      const items = [{
        type: INLINE_TEXT,
        startOffset: 0,
        endOffset: div.textContent.length,
        domNode: textNode,
      }];

      const measurer = createCaretMeasurer();
      const rect = div.getBoundingClientRect();
      const yCutoff = rect.top + 20; // start of second line

      const caretOffset = measurer.offsetAtY(div, items, yCutoff);
      expect(caretOffset).not.toBeNull();

      // The charTop at the returned offset should be >= yCutoff
      const topAtOffset = measurer.charTop(textNode, caretOffset);
      expect(topAtOffset).toBeGreaterThanOrEqual(yCutoff - 1); // 1px tolerance

      // And the character before it should be on the previous line
      if (caretOffset > 0) {
        const topBefore = measurer.charTop(textNode, caretOffset - 1);
        expect(topBefore).toBeLessThan(yCutoff);
      }
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
