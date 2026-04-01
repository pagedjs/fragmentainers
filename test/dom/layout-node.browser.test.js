import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DOMLayoutNode, AnonymousBlockNode } from "../../src/dom/layout-node.js";
import { INLINE_TEXT, INLINE_OPEN_TAG, INLINE_CLOSE_TAG } from "../../src/core/constants.js";

let container;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe("DOMLayoutNode", () => {
  describe("debugName", () => {
    it("formats tag#id.class1.class2", () => {
      const div = document.createElement("div");
      div.id = "foo";
      div.className = "bar baz";
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.debugName).toBe("div#foo.bar.baz");
    });

    it("formats tag only when no id or class", () => {
      const p = document.createElement("p");
      container.appendChild(p);
      const node = new DOMLayoutNode(p);
      expect(node.debugName).toBe("p");
    });
  });

  describe("classification", () => {
    it("img is a replaced element", () => {
      const img = document.createElement("img");
      container.appendChild(img);
      const node = new DOMLayoutNode(img);
      expect(node.isReplacedElement).toBe(true);
    });

    it("div is not a replaced element", () => {
      const div = document.createElement("div");
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.isReplacedElement).toBe(false);
    });

    it("overflow-y: scroll is scrollable", () => {
      const div = document.createElement("div");
      div.style.overflowY = "scroll";
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.isScrollable).toBe(true);
    });

    it("explicit height means hasExplicitBlockSize", () => {
      const div = document.createElement("div");
      div.style.height = "100px";
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.hasExplicitBlockSize).toBe(true);
    });

    it("auto height means no explicit block size", () => {
      const div = document.createElement("div");
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.hasExplicitBlockSize).toBe(false);
    });

    it("display: flex is a flex container", () => {
      const div = document.createElement("div");
      div.style.display = "flex";
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.isFlexContainer).toBe(true);
    });

    it("display: grid is a grid container", () => {
      const div = document.createElement("div");
      div.style.display = "grid";
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.isGridContainer).toBe(true);
    });

    it("column-count: 3 is a multicol container", () => {
      const div = document.createElement("div");
      div.style.columnCount = "3";
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.isMulticolContainer).toBe(true);
    });

    it("overflow: hidden sets hasOverflowHidden", () => {
      const div = document.createElement("div");
      div.style.overflow = "hidden";
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.hasOverflowHidden).toBe(true);
    });
  });

  describe("box model", () => {
    it("returns margin, padding, and border block-start values", () => {
      const div = document.createElement("div");
      div.style.margin = "10px";
      div.style.padding = "20px";
      div.style.border = "5px solid black";
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.marginBlockStart).toBe(10);
      expect(node.paddingBlockStart).toBe(20);
      expect(node.borderBlockStart).toBe(5);
    });

    it("returns margin, padding, and border block-end values", () => {
      const div = document.createElement("div");
      div.style.margin = "10px";
      div.style.padding = "20px";
      div.style.border = "5px solid black";
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.marginBlockEnd).toBe(10);
      expect(node.paddingBlockEnd).toBe(20);
      expect(node.borderBlockEnd).toBe(5);
    });
  });

  describe("children", () => {
    it("returns DOMLayoutNode children for block children", () => {
      const parent = document.createElement("div");
      parent.innerHTML = "<div>A</div><div>B</div>";
      container.appendChild(parent);
      const node = new DOMLayoutNode(parent);
      expect(node.children.length).toBe(2);
      expect(node.children[0]).toBeInstanceOf(DOMLayoutNode);
      expect(node.children[1]).toBeInstanceOf(DOMLayoutNode);
    });

    it("skips display:none children", () => {
      const parent = document.createElement("div");
      parent.innerHTML = "<div>A</div><div style=\"display:none\">B</div>";
      container.appendChild(parent);
      const node = new DOMLayoutNode(parent);
      expect(node.children.length).toBe(1);
    });

    it("skips script tags", () => {
      const parent = document.createElement("div");
      parent.innerHTML = "<div>A</div><script>var x=1;</script>";
      container.appendChild(parent);
      const node = new DOMLayoutNode(parent);
      expect(node.children.length).toBe(1);
    });

    it("skips style tags", () => {
      const parent = document.createElement("div");
      parent.innerHTML = "<div>A</div><style>.x{}</style>";
      container.appendChild(parent);
      const node = new DOMLayoutNode(parent);
      expect(node.children.length).toBe(1);
    });

    it("wraps mixed inline/block content with AnonymousBlockNode", () => {
      const parent = document.createElement("div");
      parent.innerHTML = "Some text <div>block</div> more text";
      container.appendChild(parent);
      const node = new DOMLayoutNode(parent);
      // "Some text" → AnonymousBlockNode, <div> → DOMLayoutNode, "more text" → AnonymousBlockNode
      expect(node.children.length).toBe(3);
      expect(node.children[0]).toBeInstanceOf(AnonymousBlockNode);
      expect(node.children[1]).toBeInstanceOf(DOMLayoutNode);
      expect(node.children[2]).toBeInstanceOf(AnonymousBlockNode);
    });
  });

  describe("blockSize", () => {
    it("returns the height of an element", () => {
      const div = document.createElement("div");
      div.style.height = "200px";
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.blockSize).toBe(200);
    });
  });

  describe("isInlineFormattingContext", () => {
    it("is true for a paragraph with text", () => {
      const p = document.createElement("p");
      p.textContent = "Hello world";
      container.appendChild(p);
      const node = new DOMLayoutNode(p);
      expect(node.isInlineFormattingContext).toBe(true);
    });

    it("is false for a div with block children", () => {
      const div = document.createElement("div");
      div.innerHTML = "<div>block</div>";
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.isInlineFormattingContext).toBe(false);
    });

    it("is false for a replaced element", () => {
      const img = document.createElement("img");
      container.appendChild(img);
      const node = new DOMLayoutNode(img);
      expect(node.isInlineFormattingContext).toBe(false);
    });
  });

  describe("inlineItemsData", () => {
    it("collects items with correct types for mixed inline content", () => {
      const p = document.createElement("p");
      p.innerHTML = "Hello <em>world</em>";
      container.appendChild(p);
      const node = new DOMLayoutNode(p);
      const data = node.inlineItemsData;

      expect(data).not.toBeNull();
      expect(data.textContent).toBe("Hello world");

      const types = data.items.map((item) => item.type);
      // "Hello " → INLINE_TEXT, <em> open → INLINE_OPEN_TAG,
      // "world" → INLINE_TEXT, </em> close → INLINE_CLOSE_TAG
      expect(types).toContain(INLINE_TEXT);
      expect(types).toContain(INLINE_OPEN_TAG);
      expect(types).toContain(INLINE_CLOSE_TAG);
    });

    it("returns null for non-IFC elements", () => {
      const div = document.createElement("div");
      div.innerHTML = "<div>block</div>";
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.inlineItemsData).toBeNull();
    });
  });

  describe("fragmentation properties", () => {
    it("reads break-before", () => {
      const div = document.createElement("div");
      div.style.breakBefore = "page";
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.breakBefore).toBe("page");
    });

    it("reads break-after", () => {
      const div = document.createElement("div");
      div.style.breakAfter = "column";
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.breakAfter).toBe("column");
    });

    it("reads break-inside", () => {
      const div = document.createElement("div");
      div.style.breakInside = "avoid";
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.breakInside).toBe("avoid");
    });

    it("reads orphans", () => {
      const div = document.createElement("div");
      div.style.orphans = "3";
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.orphans).toBe(3);
    });

    it("reads widows", () => {
      const div = document.createElement("div");
      div.style.widows = "4";
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.widows).toBe(4);
    });

    it("defaults orphans to 2", () => {
      const div = document.createElement("div");
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.orphans).toBe(2);
    });

    it("defaults breakBefore to auto", () => {
      const div = document.createElement("div");
      container.appendChild(div);
      const node = new DOMLayoutNode(div);
      expect(node.breakBefore).toBe("auto");
    });
  });
});

describe("AnonymousBlockNode", () => {
  it("has debugName [anon]", () => {
    const parent = document.createElement("div");
    const text = document.createTextNode("hello");
    parent.appendChild(text);
    container.appendChild(parent);
    const anon = new AnonymousBlockNode(parent, [text]);
    expect(anon.debugName).toBe("[anon]");
  });

  it("is an inline formatting context", () => {
    const parent = document.createElement("div");
    const text = document.createTextNode("hello");
    parent.appendChild(text);
    container.appendChild(parent);
    const anon = new AnonymousBlockNode(parent, [text]);
    expect(anon.isInlineFormattingContext).toBe(true);
  });

  it("has neutral box model values", () => {
    const anon = new AnonymousBlockNode(document.createElement("div"), []);
    expect(anon.marginBlockStart).toBe(0);
    expect(anon.marginBlockEnd).toBe(0);
    expect(anon.paddingBlockStart).toBe(0);
    expect(anon.paddingBlockEnd).toBe(0);
    expect(anon.borderBlockStart).toBe(0);
    expect(anon.borderBlockEnd).toBe(0);
  });

  it("has no element", () => {
    const anon = new AnonymousBlockNode(document.createElement("div"), []);
    expect(anon.element).toBeNull();
  });

  it("collects inlineItemsData from child nodes", () => {
    const parent = document.createElement("div");
    const text = document.createTextNode("hello");
    parent.appendChild(text);
    container.appendChild(parent);
    const anon = new AnonymousBlockNode(parent, [text]);
    const data = anon.inlineItemsData;
    expect(data).not.toBeNull();
    expect(data.textContent).toBe("hello");
  });
});
