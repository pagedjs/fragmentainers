import { describe, it, expect } from "vitest";
import {
  PageRule, PageResolver, parseCSSLength,
  getNamedPage, resolveNamedPageForBreakToken,
} from "../src/atpage/page-resolver.js";
import { BlockBreakToken } from "../src/core/tokens.js";
import { createFragments } from "../src/core/layout-request.js";
import { ConstraintSpace } from "../src/core/constraint-space.js";
import { blockNode } from "./fixtures/nodes.js";

describe("PageResolver", () => {
  const DEFAULT_SIZE = { inlineSize: 816, blockSize: 1056 };

  it("returns default size when no rules", () => {
    const resolver = new PageResolver([], DEFAULT_SIZE);
    const c = resolver.resolve(0, null, null);
    expect(c.contentArea).toEqual(DEFAULT_SIZE);
    expect(c.margins).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("defaults to US Letter when no size given", () => {
    const resolver = new PageResolver([]);
    const c = resolver.resolve(0, null, null);
    expect(c.contentArea).toEqual({ inlineSize: 816, blockSize: 1056 });
  });

  it("universal @page with explicit size", () => {
    const resolver = new PageResolver([
      new PageRule({ size: [600, 800] }),
    ], DEFAULT_SIZE);
    const c = resolver.resolve(0, null, null);
    expect(c.contentArea.inlineSize).toBe(600);
    expect(c.contentArea.blockSize).toBe(800);
  });

  it("universal @page with named size (a4)", () => {
    const resolver = new PageResolver([
      new PageRule({ size: "a4" }),
    ], DEFAULT_SIZE);
    const c = resolver.resolve(0, null, null);
    expect(c.pageBoxSize.inlineSize).toBe(794);
    expect(c.pageBoxSize.blockSize).toBe(1123);
  });

  it("named size with landscape orientation", () => {
    const resolver = new PageResolver([
      new PageRule({ size: "letter landscape" }),
    ], DEFAULT_SIZE);
    const c = resolver.resolve(0, null, null);
    expect(c.pageBoxSize.inlineSize).toBe(1056);
    expect(c.pageBoxSize.blockSize).toBe(816);
  });

  it("bare landscape rotates default", () => {
    const resolver = new PageResolver([
      new PageRule({ size: "landscape" }),
    ], DEFAULT_SIZE);
    const c = resolver.resolve(0, null, null);
    expect(c.pageBoxSize.inlineSize).toBe(DEFAULT_SIZE.blockSize);
    expect(c.pageBoxSize.blockSize).toBe(DEFAULT_SIZE.inlineSize);
  });

  it("applies margins and computes content area", () => {
    const resolver = new PageResolver([
      new PageRule({ size: [800, 1000], margin: { top: 50, right: 40, bottom: 50, left: 40 } }),
    ], DEFAULT_SIZE);
    const c = resolver.resolve(0, null, null);
    expect(c.contentArea.inlineSize).toBe(720); // 800 - 40 - 40
    expect(c.contentArea.blockSize).toBe(900);  // 1000 - 50 - 50
  });

  it(":first pseudo-class matches only page 0", () => {
    const resolver = new PageResolver([
      new PageRule({ size: [600, 800] }),
      new PageRule({ pseudoClass: "first", size: [400, 500] }),
    ], DEFAULT_SIZE);

    const c0 = resolver.resolve(0, null, null);
    expect(c0.contentArea.inlineSize).toBe(400);

    const c1 = resolver.resolve(1, null, null);
    expect(c1.contentArea.inlineSize).toBe(600);
  });

  it(":left/:right alternate by page index", () => {
    const resolver = new PageResolver([
      new PageRule({ size: [600, 800] }),
      new PageRule({ pseudoClass: "right", margin: { top: 0, right: 100, bottom: 0, left: 0 } }),
      new PageRule({ pseudoClass: "left", margin: { top: 0, right: 0, bottom: 0, left: 100 } }),
    ], DEFAULT_SIZE);

    // Page 0 is right (recto)
    const c0 = resolver.resolve(0, null, null);
    expect(c0.margins.right).toBe(100);
    expect(c0.margins.left).toBe(0);

    // Page 1 is left (verso)
    const c1 = resolver.resolve(1, null, null);
    expect(c1.margins.left).toBe(100);
    expect(c1.margins.right).toBe(0);
  });

  it("named page rule matches only its named page", () => {
    const resolver = new PageResolver([
      new PageRule({ size: [600, 800] }),
      new PageRule({ name: "chapter", size: [500, 700] }),
    ], DEFAULT_SIZE);

    const cNone = resolver.resolve(0, null, null);
    expect(cNone.contentArea.inlineSize).toBe(600);

    const chapterRoot = blockNode({ children: [blockNode({ page: "chapter" })] });
    const cChapter = resolver.resolve(1, chapterRoot, null);
    expect(cChapter.contentArea.inlineSize).toBe(500);
  });

  it("cascade: named+pseudo overrides named overrides pseudo overrides universal", () => {
    const resolver = new PageResolver([
      new PageRule({ size: [100, 100] }),                                        // universal
      new PageRule({ pseudoClass: "first", size: [200, 200] }),                  // pseudo
      new PageRule({ name: "cover", size: [300, 300] }),                         // named
      new PageRule({ name: "cover", pseudoClass: "first", size: [400, 400] }),   // named+pseudo
    ], DEFAULT_SIZE);

    // Page 0, named 'cover' → named+pseudo wins
    const coverRoot = blockNode({ children: [blockNode({ page: "cover" })] });
    const c = resolver.resolve(0, coverRoot, null);
    expect(c.contentArea.inlineSize).toBe(400);
  });

  it("cascade: margins merge from multiple rules", () => {
    const resolver = new PageResolver([
      new PageRule({ size: [600, 800], margin: { top: 10, right: 10, bottom: 10, left: 10 } }),
      new PageRule({ name: "wide", margin: { left: 50, right: 50 } }),
    ], DEFAULT_SIZE);

    const wideRoot = blockNode({ children: [blockNode({ page: "wide" })] });
    const c = resolver.resolve(0, wideRoot, null);
    expect(c.margins.top).toBe(10);    // from universal
    expect(c.margins.left).toBe(50);   // overridden by named
    expect(c.margins.right).toBe(50);  // overridden by named
  });

  it("page-orientation: rotate-left swaps dimensions", () => {
    const resolver = new PageResolver([
      new PageRule({ size: [600, 800], pageOrientation: "rotate-left" }),
    ], DEFAULT_SIZE);
    const c = resolver.resolve(0, null, null);
    expect(c.pageBoxSize.inlineSize).toBe(800);
    expect(c.pageBoxSize.blockSize).toBe(600);
  });

  it("toConstraintSpace() produces correct values", () => {
    const resolver = new PageResolver([
      new PageRule({ size: [600, 800], margin: { top: 20, right: 20, bottom: 20, left: 20 } }),
    ], DEFAULT_SIZE);

    const c = resolver.resolve(0, null, null);
    const cs = c.toConstraintSpace();
    expect(cs.availableInlineSize).toBe(560);
    expect(cs.availableBlockSize).toBe(760);
    expect(cs.fragmentainerBlockSize).toBe(760);
    expect(cs.blockOffsetInFragmentainer).toBe(0);
    expect(cs.fragmentationType).toBe("page");
  });

  it("isFirstPage and isLeftPage flags", () => {
    const resolver = new PageResolver([], DEFAULT_SIZE);

    const c0 = resolver.resolve(0, null, null);
    expect(c0.isFirstPage).toBe(true);
    expect(c0.isLeftPage).toBe(false); // page 0 = right (recto)

    const c1 = resolver.resolve(1, null, null);
    expect(c1.isFirstPage).toBe(false);
    expect(c1.isLeftPage).toBe(true);  // page 1 = left (verso)
  });
});

describe("parseCSSLength", () => {
  it("parses px", () => expect(parseCSSLength("100px")).toBe(100));
  it("parses in", () => expect(parseCSSLength("1in")).toBe(96));
  it("parses cm", () => expect(Math.abs(parseCSSLength("2.54cm") - 96) < 0.01).toBeTruthy());
  it("parses mm", () => expect(Math.abs(parseCSSLength("25.4mm") - 96) < 0.01).toBeTruthy());
  it("parses pt", () => expect(parseCSSLength("72pt")).toBe(96));
  it("parses bare number as px", () => expect(parseCSSLength("50")).toBe(50));
  it("returns null for invalid", () => expect(parseCSSLength("abc")).toBe(null));
});

describe("getNamedPage", () => {
  it("returns page property from node", () => {
    expect(getNamedPage(blockNode({ page: "cover" }))).toBe("cover");
  });

  it("returns null for node with no page", () => {
    expect(getNamedPage(blockNode())).toBe(null);
  });

  it("returns null for null node", () => {
    expect(getNamedPage(null)).toBe(null);
  });
});

describe("resolveNamedPageForBreakToken", () => {
  it("returns first child page when no break token", () => {
    const root = blockNode({
      children: [
        blockNode({ page: "cover" }),
        blockNode({ page: "chapter" }),
      ],
    });
    expect(resolveNamedPageForBreakToken(root, null)).toBe("cover");
  });

  it("returns null when first child has no page", () => {
    const root = blockNode({
      children: [blockNode(), blockNode()],
    });
    expect(resolveNamedPageForBreakToken(root, null)).toBe(null);
  });

  it("returns page of isBreakBefore child", () => {
    const childB = blockNode({ debugName: "B", page: "chapter" });
    const root = blockNode({
      children: [
        blockNode({ debugName: "A" }),
        childB,
      ],
    });

    const bt = new BlockBreakToken(root);
    const childBT = BlockBreakToken.createBreakBefore(childB, true);
    bt.childBreakTokens.push(childBT);

    expect(resolveNamedPageForBreakToken(root, bt)).toBe("chapter");
  });

  it("returns page of next sibling when break inside a child", () => {
    const childA = blockNode({ debugName: "A", blockSize: 200 });
    const childB = blockNode({ debugName: "B", page: "appendix" });
    const root = blockNode({
      children: [childA, childB],
    });

    // Break inside childA (not isBreakBefore)
    const bt = new BlockBreakToken(root);
    const childAToken = new BlockBreakToken(childA);
    childAToken.consumedBlockSize = 100;
    bt.childBreakTokens.push(childAToken);

    expect(resolveNamedPageForBreakToken(root, bt)).toBe("appendix");
  });
});

describe("Named page forced breaks", () => {
  it("forces break when page property changes between siblings", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50, page: "cover" }),
        blockNode({ debugName: "B", blockSize: 50, page: "chapter" }),
        blockNode({ debugName: "C", blockSize: 50, page: "chapter" }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: "page",
    }));
    expect(pages.length).toBe(2);
    expect(pages[0].childFragments.length).toBe(1); // Only A
    expect(pages[1].childFragments.length).toBe(2); // B + C (same page name)
  });

  it("forces break when changing from named to null", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50, page: "cover" }),
        blockNode({ debugName: "B", blockSize: 50 }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: "page",
    }));
    expect(pages.length).toBe(2);
  });

  it("forces break when changing from null to named", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50, page: "chapter" }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: "page",
    }));
    expect(pages.length).toBe(2);
  });

  it("no break when both siblings have same page", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50, page: "chapter" }),
        blockNode({ debugName: "B", blockSize: 50, page: "chapter" }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: "page",
    }));
    expect(pages.length).toBe(1);
  });

  it("no break when both siblings have null page", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50 }),
        blockNode({ debugName: "B", blockSize: 50 }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: "page",
    }));
    expect(pages.length).toBe(1);
  });

  it("forced break token has isForcedBreak = true", () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: "A", blockSize: 50, page: "cover" }),
        blockNode({ debugName: "B", blockSize: 50, page: "chapter" }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: "page",
    }));
    expect(pages[0].breakToken.childBreakTokens[0].isForcedBreak).toBe(true);
  });
});

describe("createFragments with PageResolver", () => {
  it("resolves page sizes dynamically", () => {
    const DEFAULT_SIZE = { inlineSize: 600, blockSize: 1000 };
    const resolver = new PageResolver([
      new PageRule({ size: [600, 1000] }),
    ], DEFAULT_SIZE);

    const root = blockNode({
      children: [
        blockNode({ blockSize: 800 }),
        blockNode({ blockSize: 800 }),
      ],
    });

    const pages = createFragments(root, resolver);
    expect(pages.length).toBe(2);
    expect(pages[0].constraints).toBeTruthy();
    expect(pages[0].constraints.contentArea.inlineSize).toBe(600);
  });

  it("uses named page sizes for different pages", () => {
    const resolver = new PageResolver([
      new PageRule({ size: [600, 200] }),
      new PageRule({ name: "wide", size: [800, 200] }),
    ], { inlineSize: 600, blockSize: 200 });

    const root = blockNode({
      children: [
        blockNode({ debugName: "narrow", blockSize: 50 }),
        blockNode({ debugName: "wide-content", blockSize: 50, page: "wide" }),
      ],
    });

    const pages = createFragments(root, resolver);
    expect(pages.length).toBe(2);
    expect(pages[0].constraints.contentArea.inlineSize).toBe(600);
    expect(pages[1].constraints.contentArea.inlineSize).toBe(800);
    expect(pages[1].constraints.namedPage).toBe("wide");
  });

  it("accepts a plain ConstraintSpace (no resolver)", () => {
    const root = blockNode({
      children: [blockNode({ blockSize: 50 })],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 200,
      fragmentainerBlockSize: 200,
      fragmentationType: "page",
    }));
    expect(pages.length).toBe(1);
    expect(pages[0].constraints).toBe(null); // no constraints without resolver
  });
});
