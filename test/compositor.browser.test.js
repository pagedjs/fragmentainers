import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderFragmentTree, applySliceDecorations, buildInlineContent } from "../src/compositor/render-fragments.js";
import { PhysicalFragment } from "../src/fragment.js";
import { BlockBreakToken, InlineBreakToken } from "../src/tokens.js";
import { DOMLayoutNode } from "../src/dom/layout-node.js";
import { INLINE_TEXT, INLINE_CONTROL, INLINE_OPEN_TAG, INLINE_CLOSE_TAG } from "../src/constants.js";

let container;

beforeEach(() => {
  container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

// ---------------------------------------------------------------------------
// applySliceDecorations with real elements
// ---------------------------------------------------------------------------

describe("applySliceDecorations with real elements", () => {
  function makeDiv() {
    const el = document.createElement("div");
    el.style.border = "2px solid black";
    el.style.padding = "10px";
    container.appendChild(el);
    return el;
  }

  it("does nothing for only-fragment (no breaks)", () => {
    const el = makeDiv();
    const fragment = new PhysicalFragment(null, 200);
    applySliceDecorations(el, null, fragment);
    expect(el.style.borderBlockStart).toBe("");
    expect(el.style.borderBlockEnd).toBe("");
    expect(el.style.paddingBlockStart).toBe("");
    expect(el.style.paddingBlockEnd).toBe("");
  });

  it("suppresses block-end on first fragment", () => {
    const el = makeDiv();
    const fragment = new PhysicalFragment(null, 200);
    fragment.breakToken = new BlockBreakToken(null);
    applySliceDecorations(el, null, fragment);
    expect(el.style.borderBlockEnd).toBe("none");
    expect(el.style.paddingBlockEnd).toBe("0px");
    // block-start untouched
    expect(el.style.borderBlockStart).toBe("");
    expect(el.style.paddingBlockStart).toBe("");
  });

  it("suppresses block-start on continuation (final fragment)", () => {
    const el = makeDiv();
    const inputBT = new BlockBreakToken(null);
    const fragment = new PhysicalFragment(null, 200);
    applySliceDecorations(el, inputBT, fragment);
    expect(el.style.borderBlockStart).toBe("none");
    expect(el.style.paddingBlockStart).toBe("0px");
    // block-end untouched
    expect(el.style.borderBlockEnd).toBe("");
    expect(el.style.paddingBlockEnd).toBe("");
  });

  it("suppresses both on middle fragment", () => {
    const el = makeDiv();
    const inputBT = new BlockBreakToken(null);
    const fragment = new PhysicalFragment(null, 200);
    fragment.breakToken = new BlockBreakToken(null);
    applySliceDecorations(el, inputBT, fragment);
    expect(el.style.borderBlockStart).toBe("none");
    expect(el.style.paddingBlockStart).toBe("0px");
    expect(el.style.borderBlockEnd).toBe("none");
    expect(el.style.paddingBlockEnd).toBe("0px");
  });
});

// ---------------------------------------------------------------------------
// buildInlineContent
// ---------------------------------------------------------------------------

describe("buildInlineContent", () => {
  it("renders simple text into a container", () => {
    const items = [
      { type: INLINE_TEXT, startOffset: 0, endOffset: 11 },
    ];
    const textContent = "Hello world";
    const target = document.createElement("div");
    buildInlineContent(items, textContent, 0, 11, target);
    expect(target.textContent).toBe("Hello world");
  });

  it("renders a sliced range from the middle of text", () => {
    const textContent = "Hello world test content";
    const items = [
      { type: INLINE_TEXT, startOffset: 0, endOffset: textContent.length },
    ];
    const target = document.createElement("div");
    buildInlineContent(items, textContent, 6, 16, target);
    expect(target.textContent).toBe("world test");
  });

  it("renders inline elements using open/close tag items", () => {
    const span = document.createElement("span");
    span.className = "highlight";
    container.appendChild(span);

    const textContent = "before inside after";
    const items = [
      { type: INLINE_TEXT, startOffset: 0, endOffset: 7 },
      { type: INLINE_OPEN_TAG, element: span },
      { type: INLINE_TEXT, startOffset: 7, endOffset: 13 },
      { type: INLINE_CLOSE_TAG },
      { type: INLINE_TEXT, startOffset: 13, endOffset: 19 },
    ];

    const target = document.createElement("div");
    buildInlineContent(items, textContent, 0, 19, target);

    expect(target.textContent).toBe("before inside after");
    // The span should be a child of target
    const innerSpan = target.querySelector("span.highlight");
    expect(innerSpan).not.toBeNull();
    expect(innerSpan.textContent).toBe("inside");
  });

  it("renders a break element for INLINE_CONTROL items", () => {
    const textContent = "line one\nline two";
    const items = [
      { type: INLINE_TEXT, startOffset: 0, endOffset: 8 },
      { type: INLINE_CONTROL, startOffset: 8, endOffset: 9 },
      { type: INLINE_TEXT, startOffset: 9, endOffset: 17 },
    ];
    const target = document.createElement("div");
    buildInlineContent(items, textContent, 0, 17, target);
    expect(target.querySelector("br")).not.toBeNull();
    expect(target.textContent).toBe("line oneline two");
  });
});

// ---------------------------------------------------------------------------
// renderFragmentTree
// ---------------------------------------------------------------------------

describe("renderFragmentTree", () => {
  it("renders child fragments as cloned elements", () => {
    // Build real DOM
    const outer = document.createElement("div");
    const child1 = document.createElement("div");
    child1.textContent = "First";
    const child2 = document.createElement("div");
    child2.textContent = "Second";
    outer.appendChild(child1);
    outer.appendChild(child2);
    container.appendChild(outer);

    // Wrap in DOMLayoutNodes
    const outerNode = new DOMLayoutNode(outer);
    const childNodes = outerNode.children;
    expect(childNodes.length).toBe(2);

    // Build a fragment tree: root fragment with two leaf child fragments
    const childFrag1 = new PhysicalFragment(childNodes[0], 20);
    const childFrag2 = new PhysicalFragment(childNodes[1], 20);
    const rootFragment = new PhysicalFragment(outerNode, 40, [childFrag1, childFrag2]);

    // Render
    const docFrag = renderFragmentTree(rootFragment, null);

    // The DocumentFragment should contain two cloned divs
    expect(docFrag.childNodes.length).toBe(2);
    expect(docFrag.childNodes[0].tagName).toBe("DIV");
    expect(docFrag.childNodes[0].textContent).toBe("First");
    expect(docFrag.childNodes[1].tagName).toBe("DIV");
    expect(docFrag.childNodes[1].textContent).toBe("Second");
  });

  it("skips null-node children (line fragments)", () => {
    const outer = document.createElement("div");
    const child = document.createElement("p");
    child.textContent = "Content";
    outer.appendChild(child);
    container.appendChild(outer);

    const outerNode = new DOMLayoutNode(outer);
    const childNodes = outerNode.children;

    // Mix a line fragment (null node) with a real child fragment
    const lineFrag = new PhysicalFragment(null, 20);
    const childFrag = new PhysicalFragment(childNodes[0], 30);
    const rootFragment = new PhysicalFragment(outerNode, 50, [lineFrag, childFrag]);

    const docFrag = renderFragmentTree(rootFragment, null);

    // Only the real child should be rendered
    expect(docFrag.childNodes.length).toBe(1);
    expect(docFrag.childNodes[0].tagName).toBe("P");
    expect(docFrag.childNodes[0].textContent).toBe("Content");
  });

  it("sets data-split-to when fragment has a break token", () => {
    const outer = document.createElement("div");
    const child = document.createElement("div");
    child.textContent = "Split content";
    outer.appendChild(child);
    container.appendChild(outer);

    const outerNode = new DOMLayoutNode(outer);
    const childNodes = outerNode.children;

    const childFrag = new PhysicalFragment(childNodes[0], 50);
    childFrag.breakToken = new BlockBreakToken(childNodes[0]);
    const rootFragment = new PhysicalFragment(outerNode, 50, [childFrag]);

    const docFrag = renderFragmentTree(rootFragment, null);

    expect(docFrag.childNodes.length).toBe(1);
    expect(docFrag.childNodes[0].hasAttribute("data-split-to")).toBe(true);
  });
});
