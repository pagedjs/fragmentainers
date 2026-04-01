import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createFragments } from "../src/core/layout-request.js";
import { ConstraintSpace } from "../src/core/constraint-space.js";
import { buildLayoutTree } from "../src/dom/index.js";
import { BREAK_TOKEN_INLINE } from "../src/core/constants.js";

describe("Inline content layout (browser)", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    container.style.cssText = "position: absolute; left: -9999px; top: 0;";
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("lays out inline content that fits on one page", () => {
    container.innerHTML = "<p style=\"width: 400px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;\">Hello world</p>";
    const p = container.querySelector("p");
    const root = buildLayoutTree(p);

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 400,
      availableBlockSize: 800,
      fragmentainerBlockSize: 800,
      fragmentationType: "page",
    }));

    expect(pages.length).toBe(1);
    expect(pages[0].breakToken).toBe(null);
  });

  it("breaks text across multiple lines", () => {
    const text = Array.from({ length: 20 }, () => "word").join(" ");
    container.innerHTML = `<p style="width: 100px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">${text}</p>`;
    const p = container.querySelector("p");
    const root = buildLayoutTree(p);

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 100,
      availableBlockSize: 800,
      fragmentainerBlockSize: 800,
      fragmentationType: "page",
    }));

    expect(pages.length).toBe(1);
    // With real DOM, <p> is an inline formatting context directly,
    // so line fragments are direct children of the root fragment.
    expect(pages[0].childFragments.length).toBeGreaterThan(1);
  });

  it("fragments inline content across pages", () => {
    const text = Array.from({ length: 80 }, () => "word").join(" ");
    container.innerHTML = `<p style="width: 200px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">${text}</p>`;
    const p = container.querySelector("p");
    const root = buildLayoutTree(p);

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 200,
      availableBlockSize: 60,
      fragmentainerBlockSize: 60,
      fragmentationType: "page",
    }));

    expect(pages.length).toBeGreaterThan(1);
    // First page should have a break token
    expect(pages[0].breakToken).toBeTruthy();
    // Last page should have no break token
    expect(pages[pages.length - 1].breakToken).toBe(null);
  });

  it("InlineBreakToken has content-addressed position", () => {
    const text = Array.from({ length: 80 }, () => "test").join(" ");
    container.innerHTML = `<p style="width: 200px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">${text}</p>`;
    const p = container.querySelector("p");
    const root = buildLayoutTree(p);

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 200,
      availableBlockSize: 60,
      fragmentainerBlockSize: 60,
      fragmentationType: "page",
    }));

    expect(pages.length).toBeGreaterThan(1);

    // With real DOM, the <p> is the inline formatting context itself,
    // so the break token is directly on the root fragment.
    const breakToken = pages[0].breakToken;
    expect(breakToken).toBeTruthy();
    expect(breakToken.type).toBe(BREAK_TOKEN_INLINE);
    expect(breakToken.textOffset).toBeGreaterThan(0);
  });

  it("handles forced line break with <br>", () => {
    container.innerHTML = "<p style=\"width: 400px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;\">Line one<br>Line two<br>Line three</p>";
    const p = container.querySelector("p");
    const root = buildLayoutTree(p);

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 400,
      availableBlockSize: 800,
      fragmentainerBlockSize: 800,
      fragmentationType: "page",
    }));

    expect(pages.length).toBe(1);
    // Three lines: one per segment separated by <br>
    expect(pages[0].childFragments.length).toBe(3);
  });

  it("varying inline size between pages changes line breaks", () => {
    const text = Array.from({ length: 40 }, () => "word").join(" ");
    container.innerHTML = `<p style="width: 100px; font: 16px monospace; line-height: 20px; margin: 0; padding: 0;">${text}</p>`;
    const p = container.querySelector("p");
    const root = buildLayoutTree(p);

    const pages = createFragments(root, {
      resolve: (index) => {
        const sizes = [
          { inlineSize: 100, blockSize: 60 },
          { inlineSize: 400, blockSize: 400 },
        ];
        const size = sizes[index] || sizes.at(-1);
        return {
          toConstraintSpace: () => new ConstraintSpace({
            availableInlineSize: size.inlineSize,
            availableBlockSize: size.blockSize,
            fragmentainerBlockSize: size.blockSize,
            fragmentationType: "page",
          }),
        };
      },
    });

    expect(pages.length).toBeGreaterThanOrEqual(2);
    // Page 1 with narrow width should have line fragments
    expect(pages[0].childFragments.length).toBeGreaterThan(0);
  });
});
