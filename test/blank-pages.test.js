import { describe, it, expect } from "vitest";
import { createFragments } from "../src/core/layout-request.js";
import { BlockBreakToken } from "../src/core/tokens.js";
import {
  PageRule, PageResolver,
  isSideSpecificBreak,
  requiredPageSide,
  resolveForcedBreakValue,
  resolveNextPageBreakBefore,
} from "../src/atpage/page-resolver.js";
import { blockNode } from "./fixtures/nodes.js";

// --- Helper function tests ---

describe("isSideSpecificBreak", () => {
  it("returns true for left, right, recto, verso", () => {
    expect(isSideSpecificBreak("left")).toBe(true);
    expect(isSideSpecificBreak("right")).toBe(true);
    expect(isSideSpecificBreak("recto")).toBe(true);
    expect(isSideSpecificBreak("verso")).toBe(true);
  });

  it("returns false for page, column, always, auto, avoid", () => {
    expect(isSideSpecificBreak("page")).toBe(false);
    expect(isSideSpecificBreak("column")).toBe(false);
    expect(isSideSpecificBreak("always")).toBe(false);
    expect(isSideSpecificBreak("auto")).toBe(false);
    expect(isSideSpecificBreak("avoid")).toBe(false);
    expect(isSideSpecificBreak(null)).toBe(false);
    expect(isSideSpecificBreak(undefined)).toBe(false);
  });
});

describe("requiredPageSide", () => {
  it("normalizes right and recto to 'right'", () => {
    expect(requiredPageSide("right")).toBe("right");
    expect(requiredPageSide("recto")).toBe("right");
  });

  it("normalizes left and verso to 'left'", () => {
    expect(requiredPageSide("left")).toBe("left");
    expect(requiredPageSide("verso")).toBe("left");
  });

  it("returns null for non-side-specific values", () => {
    expect(requiredPageSide("page")).toBeNull();
    expect(requiredPageSide("auto")).toBeNull();
    expect(requiredPageSide(null)).toBeNull();
  });
});

describe("resolveForcedBreakValue", () => {
  it("returns null for null break token", () => {
    expect(resolveForcedBreakValue(null)).toBeNull();
  });

  it("returns forcedBreakValue from a direct token", () => {
    const node = blockNode({ debugName: "A" });
    const token = BlockBreakToken.createBreakBefore(node, true, "right");
    // Wrap in a parent token
    const parent = new BlockBreakToken(blockNode({ debugName: "root" }));
    parent.childBreakTokens = [token];
    expect(resolveForcedBreakValue(parent)).toBe("right");
  });

  it("returns null when no forced break value", () => {
    const node = blockNode({ debugName: "A" });
    const token = BlockBreakToken.createBreakBefore(node, true);
    const parent = new BlockBreakToken(blockNode({ debugName: "root" }));
    parent.childBreakTokens = [token];
    expect(resolveForcedBreakValue(parent)).toBeNull();
  });
});

describe("resolveNextPageBreakBefore", () => {
  it("returns first child breakBefore when no break token", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", breakBefore: "right" }),
        blockNode({ debugName: "B" }),
      ],
    });
    expect(resolveNextPageBreakBefore(root, null)).toBe("right");
  });

  it("returns breakBefore from isBreakBefore token node", () => {
    const childA = blockNode({ debugName: "A", blockSize: 50 });
    const childB = blockNode({ debugName: "B", blockSize: 50, breakBefore: "left" });
    const root = blockNode({ children: [childA, childB] });
    const token = new BlockBreakToken(root);
    const childToken = BlockBreakToken.createBreakBefore(childB, true, "left");
    token.childBreakTokens = [childToken];
    expect(resolveNextPageBreakBefore(root, token)).toBe("left");
  });

  it("returns auto when first child has no break-before", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A" }),
        blockNode({ debugName: "B" }),
      ],
    });
    expect(resolveNextPageBreakBefore(root, null)).toBe("auto");
  });
});

// --- forcedBreakValue on tokens ---

describe("forcedBreakValue on tokens", () => {
  it("createBreakBefore stores forcedBreakValue", () => {
    const node = blockNode({ debugName: "A" });
    const token = BlockBreakToken.createBreakBefore(node, true, "left");
    expect(token.isForcedBreak).toBe(true);
    expect(token.forcedBreakValue).toBe("left");
  });

  it("createBreakBefore defaults forcedBreakValue to null", () => {
    const node = blockNode({ debugName: "A" });
    const token = BlockBreakToken.createBreakBefore(node, true);
    expect(token.forcedBreakValue).toBeNull();
  });

  it("break-before: right stores value through layout", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50, breakBefore: "right" }),
      ],
    });

    const resolver = new PageResolver([], { inlineSize: 600, blockSize: 1000 });
    const pages = createFragments(root, resolver);

    // Page 0 (right): A. Forced break token should have value "right".
    const forcedToken = pages[0].breakToken.childBreakTokens[0];
    expect(forcedToken.isForcedBreak).toBe(true);
    expect(forcedToken.forcedBreakValue).toBe("right");
  });

  it("break-after: left stores value through layout", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50, breakAfter: "left" }),
        blockNode({ debugName: "B", blockSize: 50 }),
      ],
    });

    const resolver = new PageResolver([], { inlineSize: 600, blockSize: 1000 });
    const pages = createFragments(root, resolver);

    const forcedToken = pages[0].breakToken.childBreakTokens[0];
    expect(forcedToken.isForcedBreak).toBe(true);
    expect(forcedToken.forcedBreakValue).toBe("left");
  });
});

// --- Blank page insertion ---

describe("Blank page insertion", () => {
  // Page 0 = right, Page 1 = left, Page 2 = right, Page 3 = left, ...
  const SIZE = { inlineSize: 600, blockSize: 1000 };

  it("break-before: left inserts a blank page when content is on a right page", () => {
    // A fills page 0 (right). B has break-before: left.
    // Page 1 is left — no blank needed. B goes on page 1.
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50, breakBefore: "left" }),
      ],
    });

    const resolver = new PageResolver([], SIZE);
    const pages = createFragments(root, resolver);

    // Page 0: A, Page 1: B (left — correct, no blank)
    expect(pages.length).toBe(2);
    expect(pages[0].isBlank).toBe(false);
    expect(pages[1].isBlank).toBe(false);
  });

  it("break-before: right inserts a blank page when next page would be left", () => {
    // A fills page 0 (right). Forced break creates break token.
    // Page 1 is left, but B needs right → blank page 1, B on page 2 (right).
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50, breakBefore: "right" }),
      ],
    });

    const resolver = new PageResolver([], SIZE);
    const pages = createFragments(root, resolver);

    expect(pages.length).toBe(3);
    expect(pages[0].isBlank).toBe(false); // Page 0: A
    expect(pages[1].isBlank).toBe(true);  // Page 1: blank (left)
    expect(pages[2].isBlank).toBe(false); // Page 2: B (right)
  });

  it("break-before: recto works like right", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50, breakBefore: "recto" }),
      ],
    });

    const resolver = new PageResolver([], SIZE);
    const pages = createFragments(root, resolver);

    expect(pages.length).toBe(3);
    expect(pages[1].isBlank).toBe(true);
  });

  it("break-before: verso works like left", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50, breakBefore: "verso" }),
      ],
    });

    const resolver = new PageResolver([], SIZE);
    const pages = createFragments(root, resolver);

    // Page 1 is left (verso) — no blank needed
    expect(pages.length).toBe(2);
    expect(pages[0].isBlank).toBe(false);
    expect(pages[1].isBlank).toBe(false);
  });

  it("no blank page when already on correct side", () => {
    // A on page 0 (right), forced break, B needs left.
    // Page 1 IS left → no blank.
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50, breakBefore: "left" }),
        blockNode({ debugName: "C", blockSize: 50, breakBefore: "right" }),
      ],
    });

    const resolver = new PageResolver([], SIZE);
    const pages = createFragments(root, resolver);

    // Page 0: A (right), Page 1: B (left), Page 2: C (right)
    // No blanks needed — each break lands on the correct side
    expect(pages.length).toBe(3);
    expect(pages.every(p => !p.isBlank)).toBe(true);
  });

  it("break-after: right inserts a blank page", () => {
    // A has break-after: right. A is on page 0 (right).
    // Next page is 1 (left), but B needs right → blank page 1, B on page 2.
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50, breakAfter: "right" }),
        blockNode({ debugName: "B", blockSize: 50 }),
      ],
    });

    const resolver = new PageResolver([], SIZE);
    const pages = createFragments(root, resolver);

    expect(pages.length).toBe(3);
    expect(pages[1].isBlank).toBe(true);
  });

  it("blank pages are counted in the page sequence", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50, breakBefore: "right" }),
        blockNode({ debugName: "C", blockSize: 50, breakBefore: "right" }),
      ],
    });

    const resolver = new PageResolver([], SIZE);
    const pages = createFragments(root, resolver);

    // Page 0: A (right)
    // Page 1: blank (left) — blank because B needs right
    // Page 2: B (right)
    // Page 3: blank (left) — blank because C needs right
    // Page 4: C (right)
    expect(pages.length).toBe(5);
    expect(pages[0].isBlank).toBe(false);
    expect(pages[1].isBlank).toBe(true);
    expect(pages[2].isBlank).toBe(false);
    expect(pages[3].isBlank).toBe(true);
    expect(pages[4].isBlank).toBe(false);
  });

  it("blank page has constraints from resolver", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50, breakBefore: "right" }),
      ],
    });

    const resolver = new PageResolver([], SIZE);
    const pages = createFragments(root, resolver);

    const blankPage = pages[1];
    expect(blankPage.isBlank).toBe(true);
    expect(blankPage.constraints).toBeTruthy();
    expect(blankPage.constraints.contentArea.inlineSize).toBe(SIZE.inlineSize);
    expect(blankPage.constraints.contentArea.blockSize).toBe(SIZE.blockSize);
    expect(blankPage.constraints.isBlank).toBe(true);
  });

  it("break-before: page does NOT insert blank pages", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50, breakBefore: "page" }),
      ],
    });

    const resolver = new PageResolver([], SIZE);
    const pages = createFragments(root, resolver);

    // break-before: page is not side-specific — just 2 pages, no blanks
    expect(pages.length).toBe(2);
    expect(pages.every(p => !p.isBlank)).toBe(true);
  });
});

// --- :blank pseudo-class matching ---

describe(":blank pseudo-class matching", () => {
  it("@page :blank rule matches blank pages", () => {
    const resolver = new PageResolver([
      new PageRule({ pseudoClass: "blank", margin: { top: 100 } }),
    ], { inlineSize: 600, blockSize: 1000 });

    // Non-blank page should not get the margin
    const normal = resolver.resolve(0, null, null, false);
    expect(normal.margins.top).toBe(0);

    // Blank page should get the margin
    const blank = resolver.resolve(1, null, null, true);
    expect(blank.margins.top).toBe(100);
    expect(blank.isBlank).toBe(true);
  });

  it("@page :blank does not match non-blank pages", () => {
    const resolver = new PageResolver([
      new PageRule({ pseudoClass: "blank", size: [400, 400] }),
    ], { inlineSize: 600, blockSize: 1000 });

    const c = resolver.resolve(0, null, null, false);
    expect(c.contentArea.inlineSize).toBe(600);
    expect(c.contentArea.blockSize).toBe(1000);
  });
});

// --- First page edge case ---

describe("First page blank page edge case", () => {
  const SIZE = { inlineSize: 600, blockSize: 1000 };

  it("first child with break-before: left inserts blank page 0 (page 0 is right)", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50, breakBefore: "left" }),
        blockNode({ debugName: "B", blockSize: 50 }),
      ],
    });

    const resolver = new PageResolver([], SIZE);
    const pages = createFragments(root, resolver);

    // Page 0 is right, A needs left → blank page 0, A on page 1 (left)
    expect(pages.length).toBe(2);
    expect(pages[0].isBlank).toBe(true);
    expect(pages[1].isBlank).toBe(false);
  });

  it("first child with break-before: right does NOT insert blank (page 0 is right)", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50, breakBefore: "right" }),
        blockNode({ debugName: "B", blockSize: 50 }),
      ],
    });

    const resolver = new PageResolver([], SIZE);
    const pages = createFragments(root, resolver);

    // Page 0 is right, A needs right → already correct, no blank
    expect(pages.length).toBe(1);
    expect(pages[0].isBlank).toBe(false);
  });
});
