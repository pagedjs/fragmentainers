import { describe, it, expect, afterEach } from "vitest";
import { FragmentainerLayout } from "../../src/core/fragmentainer-layout.js";
import { ConstraintSpace } from "../../src/core/constraint-space.js";
import { FRAGMENTATION_PAGE } from "../../src/core/constants.js";

let layout;

afterEach(() => {
  layout?.destroy();
});

const PAGE_WIDTH = 400;
const PAGE_HEIGHT = 400;

function pageConstraint(height = PAGE_HEIGHT) {
  return new ConstraintSpace({
    availableInlineSize: PAGE_WIDTH,
    availableBlockSize: height,
    fragmentainerBlockSize: height,
    fragmentationType: FRAGMENTATION_PAGE,
  });
}

function makeContent(html, css = "") {
  const template = document.createElement("template");
  template.innerHTML = html;
  const content = template.content;

  const styles = [];
  if (css) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    styles.push(sheet);
  }
  return { content, styles };
}

describe("Footnotes in paged media (browser)", () => {
  it("places footnote body at bottom of the page", async () => {
    const { content, styles } = makeContent(
      `<div style="margin: 0; padding: 0;">
        <p style="height: 100px; margin: 0; padding: 0;">
          Main text
          <span class="fn">Footnote body text</span>
        </p>
      </div>`,
      ".fn { --float: footnote; }",
    );

    layout = new FragmentainerLayout(content, {
      constraintSpace: pageConstraint(),
      styles,
    });
    const flow = await layout.flow();
    expect(flow.fragmentainerCount).toBe(1);

    const elements = flow.render();
    const el = elements[0];
    document.body.appendChild(el);

    const area = el.shadowRoot.querySelector(".footnote-area");
    expect(area).not.toBeNull();
    expect(area.children.length).toBe(1);
    expect(area.children[0].hasAttribute("data-footnote-marker")).toBe(true);
    expect(area.children[0].textContent).toContain("Footnote body text");
    el.remove();
  });

  it("inserts a footnote call marker in place of the body", async () => {
    const { content, styles } = makeContent(
      `<div style="margin: 0; padding: 0;">
        <p style="height: 100px; margin: 0; padding: 0;">
          Before<span class="fn">Body</span>After
        </p>
      </div>`,
      ".fn { --float: footnote; }",
    );

    layout = new FragmentainerLayout(content, {
      constraintSpace: pageConstraint(),
      styles,
    });
    const flow = await layout.flow();
    const elements = flow.render();
    const el = elements[0];
    document.body.appendChild(el);

    const call = el.shadowRoot.querySelector("[data-footnote-call]");
    expect(call).not.toBeNull();
    expect(call.tagName).toBe("A");
    el.remove();
  });

  it("handles multiple footnotes on the same page", async () => {
    const { content, styles } = makeContent(
      `<div style="margin: 0; padding: 0;">
        <p style="height: 80px; margin: 0; padding: 0;">
          First<span class="fn">First footnote</span>
        </p>
        <p style="height: 80px; margin: 0; padding: 0;">
          Second<span class="fn">Second footnote</span>
        </p>
      </div>`,
      ".fn { --float: footnote; }",
    );

    layout = new FragmentainerLayout(content, {
      constraintSpace: pageConstraint(),
      styles,
    });
    const flow = await layout.flow();
    const elements = flow.render();
    const el = elements[0];
    document.body.appendChild(el);

    const area = el.shadowRoot.querySelector(".footnote-area");
    expect(area).not.toBeNull();
    expect(area.children.length).toBe(2);
    expect(area.children[0].textContent).toContain("First footnote");
    expect(area.children[1].textContent).toContain("Second footnote");
    el.remove();
  });

  it("footnote reduces available content space causing page break", async () => {
    // Use leaf divs (no children) so blockSize is predictable from CSS height.
    // Footnote body is in a separate wrapper div so it can be extracted.
    // Content after extraction: ~0 + 100 + 100 + 100 = 300px (leaf divs)
    // Footnote body: 150px
    // Page: 400px
    // Without footnote: 300 < 400 → 1 page
    // With 150px footnote: 400 - 150 = 250 available. 300 > 250 → 2 pages
    const { content, styles } = makeContent(
      `<div style="margin: 0; padding: 0;">
        <div style="margin: 0; padding: 0;">
          <div class="fn" style="height: 150px; margin: 0; padding: 0;">Footnote body</div>
        </div>
        <div style="height: 100px; margin: 0; padding: 0;"></div>
        <div style="height: 100px; margin: 0; padding: 0;"></div>
        <div style="height: 100px; margin: 0; padding: 0;"></div>
      </div>`,
      ".fn { --float: footnote; }",
    );

    layout = new FragmentainerLayout(content, {
      constraintSpace: pageConstraint(),
      styles,
    });
    const flow = await layout.flow();

    expect(flow.fragmentainerCount).toBeGreaterThanOrEqual(2);
  });

  it("page without footnotes has no footnote area", async () => {
    const { content, styles } = makeContent(
      `<div style="margin: 0; padding: 0;">
        <div style="height: 100px; margin: 0; padding: 0;">No footnotes here</div>
      </div>`,
      ".fn { --float: footnote; }",
    );

    layout = new FragmentainerLayout(content, {
      constraintSpace: pageConstraint(),
      styles,
    });
    const flow = await layout.flow();
    const elements = flow.render();
    const el = elements[0];
    document.body.appendChild(el);

    const area = el.shadowRoot.querySelector(".footnote-area");
    expect(area).toBeNull();
    el.remove();
  });

  it("footnote call and body stay on the same page", async () => {
    const { content, styles } = makeContent(
      `<div style="margin: 0; padding: 0;">
        <div style="height: 100px; margin: 0; padding: 0;">Page 1 content</div>
        <div style="height: 100px; margin: 0; padding: 0;">
          Page 2 text<span class="fn">Page 2 footnote</span>
        </div>
      </div>`,
      ".fn { --float: footnote; }",
    );

    layout = new FragmentainerLayout(content, {
      constraintSpace: pageConstraint(200),
      styles,
    });
    const flow = await layout.flow();
    const elements = flow.render();

    // Find the page with the footnote call
    let pageWithCall = -1;
    let pageWithBody = -1;

    for (let i = 0; i < elements.length; i++) {
      document.body.appendChild(elements[i]);
      const call = elements[i].shadowRoot.querySelector("[data-footnote-call]");
      const area = elements[i].shadowRoot.querySelector(".footnote-area");
      if (call) pageWithCall = i;
      if (area) pageWithBody = i;
      elements[i].remove();
    }

    expect(pageWithCall).not.toBe(-1);
    expect(pageWithCall).toBe(pageWithBody);
  });
});
