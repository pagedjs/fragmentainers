import { describe, it, expect } from "vitest";
import { Footnote } from "../../src/modules/footnote.js";
import { blockNode } from "../fixtures/nodes.js";

describe("Footnote.matches", () => {
  it("returns true for a node with --float: footnote", () => {
    const node = blockNode({
      blockSize: 100,
      getCustomProperty(name) {
        return name === "float" ? "footnote" : null;
      },
    });
    expect(Footnote.matches(node)).toBe(true);
  });

  it("returns false for a regular block node", () => {
    const node = blockNode({ blockSize: 100 });
    expect(Footnote.matches(node)).toBe(false);
  });
});

describe("Footnote.layout", () => {
  it("returns zero reservation by default", () => {
    const result = Footnote.layout();
    expect(result.reservedBlockStart).toBe(0);
    expect(result.reservedBlockEnd).toBe(0);
    expect(result.afterRender).toBeNull();
  });
});

describe("Footnote.claimPersistent", () => {
  it("returns empty array (footnotes are not persistent)", () => {
    const frag = document.createDocumentFragment();
    const result = Footnote.claimPersistent(frag, []);
    expect(result).toEqual([]);
  });
});
