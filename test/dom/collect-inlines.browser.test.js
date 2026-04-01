import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { collectInlineItems } from "../../src/dom/collect-inlines.js";
import {
  INLINE_TEXT,
  INLINE_CONTROL,
  INLINE_OPEN_TAG,
  INLINE_CLOSE_TAG,
  INLINE_ATOMIC,
} from "../../src/core/constants.js";

let container;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe("collectInlineItems", () => {
  it("collects plain text as a single INLINE_TEXT item", () => {
    container.innerHTML = "<p>Hello world</p>";
    const p = container.querySelector("p");
    const { items, textContent } = collectInlineItems(p.childNodes);

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe(INLINE_TEXT);
    expect(items[0].startOffset).toBe(0);
    expect(items[0].endOffset).toBe(11);
    expect(textContent).toBe("Hello world");
  });

  it("collects mixed inline elements with open/close tags", () => {
    container.innerHTML = "<p>Hello <em>world</em></p>";
    const p = container.querySelector("p");
    const { items } = collectInlineItems(p.childNodes);

    expect(items).toHaveLength(4);
    expect(items[0].type).toBe(INLINE_TEXT);
    expect(items[1].type).toBe(INLINE_OPEN_TAG);
    expect(items[1].element.tagName.toLowerCase()).toBe("em");
    expect(items[2].type).toBe(INLINE_TEXT);
    expect(items[3].type).toBe(INLINE_CLOSE_TAG);
    expect(items[3].element.tagName.toLowerCase()).toBe("em");
  });

  it("collects <br> as INLINE_CONTROL", () => {
    container.innerHTML = "<p>Line one<br>Line two</p>";
    const p = container.querySelector("p");
    const { items, textContent } = collectInlineItems(p.childNodes);

    expect(items).toHaveLength(3);
    expect(items[0].type).toBe(INLINE_TEXT);
    expect(items[1].type).toBe(INLINE_CONTROL);
    expect(items[1].domNode.tagName.toLowerCase()).toBe("br");
    expect(items[2].type).toBe(INLINE_TEXT);
    expect(textContent).toBe("Line one\nLine two");
  });

  it("skips display:none elements", () => {
    container.innerHTML =
      "<p>visible<span style=\"display:none\">hidden</span></p>";
    const p = container.querySelector("p");
    const { items, textContent } = collectInlineItems(p.childNodes);

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe(INLINE_TEXT);
    expect(textContent).toBe("visible");
  });

  it("collects inline-block as INLINE_ATOMIC", () => {
    container.innerHTML =
      "<p>text<span style=\"display:inline-block\">box</span></p>";
    const p = container.querySelector("p");
    const { items } = collectInlineItems(p.childNodes);

    expect(items).toHaveLength(2);
    expect(items[0].type).toBe(INLINE_TEXT);
    expect(items[1].type).toBe(INLINE_ATOMIC);
    expect(items[1].element.tagName.toLowerCase()).toBe("span");
  });

  it("includes whitespace-only text nodes", () => {
    container.innerHTML = "<p><em>a</em> <em>b</em></p>";
    const p = container.querySelector("p");
    const { items } = collectInlineItems(p.childNodes);

    // OPEN + TEXT("a") + CLOSE + TEXT(" ") + OPEN + TEXT("b") + CLOSE
    const textItems = items.filter((i) => i.type === INLINE_TEXT);
    expect(textItems).toHaveLength(3);
    expect(textItems[1].endOffset - textItems[1].startOffset).toBe(1);
  });

  it("collects items from an array of nodes", () => {
    container.innerHTML = "hello<span>world</span>!";
    const nodes = Array.from(container.childNodes);
    const { items, textContent } = collectInlineItems(nodes);

    expect(items[0].type).toBe(INLINE_TEXT);
    expect(items[1].type).toBe(INLINE_OPEN_TAG);
    expect(items[2].type).toBe(INLINE_TEXT);
    expect(items[3].type).toBe(INLINE_CLOSE_TAG);
    expect(items[4].type).toBe(INLINE_TEXT);
    expect(textContent).toBe("helloworld!");
  });
});
