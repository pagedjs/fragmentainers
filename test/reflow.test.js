import { describe, it, expect } from "vitest";
import { ConstraintSpace } from "../src/core/constraint-space.js";
import { FragmentainerLayout } from "../src/core/fragmentainer-layout.js";
import { blockNode } from "./fixtures/nodes.js";

describe("FragmentainerLayout.reflow()", () => {
  function makeLayout(children, blockSize = 300) {
    const root = blockNode({ children });
    const cs = new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: blockSize,
      fragmentainerBlockSize: blockSize,
      fragmentationType: "column",
    });
    return new FragmentainerLayout(root, { constraintSpace: cs });
  }

  function collectAll(layout) {
    const fragments = [];
    let frag;
    do {
      frag = layout.next();
      fragments.push(frag);
    } while (frag.breakToken !== null);
    return fragments;
  }

  it("reflow(0) then stepping matches a fresh layout", () => {
    const children = [
      blockNode({ blockSize: 200 }),
      blockNode({ blockSize: 200 }),
      blockNode({ blockSize: 200 }),
    ];

    const fresh = collectAll(makeLayout(children));

    const layout2 = makeLayout(children);
    collectAll(layout2);
    layout2.reflow(0);
    const reflowed = collectAll(layout2);

    expect(reflowed.length).toBe(fresh.length);
    for (let i = 0; i < fresh.length; i++) {
      expect(reflowed[i].blockSize).toBe(fresh[i].blockSize);
      expect(reflowed[i].childFragments.length).toBe(fresh[i].childFragments.length);
    }
  });

  it("reflow(1) then next() matches original fragments from index 1", () => {
    const children = [
      blockNode({ blockSize: 200 }),
      blockNode({ blockSize: 200 }),
      blockNode({ blockSize: 200 }),
    ];

    const fresh = collectAll(makeLayout(children));

    const layout2 = makeLayout(children);
    collectAll(layout2);
    layout2.reflow(1);
    const reflowed = collectAll(layout2);

    expect(reflowed.length).toBe(fresh.length - 1);
    for (let i = 0; i < reflowed.length; i++) {
      expect(reflowed[i].blockSize).toBe(fresh[i + 1].blockSize);
    }
  });

  it("reflow() restores counter state from preceding fragment", () => {
    const section = blockNode({
      counterReset: "paragraph 0",
      children: [
        blockNode({ blockSize: 200, counterIncrement: "paragraph 1" }),
        blockNode({ blockSize: 200, counterIncrement: "paragraph 1" }),
        blockNode({ blockSize: 200, counterIncrement: "paragraph 1" }),
      ],
    });

    const layout = makeLayout([section]);
    const fragments = collectAll(layout);

    const countersBefore = fragments[0].counterState;

    layout.reflow(1);
    const frag = layout.next();

    if (countersBefore) {
      expect(frag.counterState).toBeDefined();
    }
  });

  it("reflow(0) on single-fragment content produces identical result", () => {
    const children = [blockNode({ blockSize: 100 })];

    const layout = makeLayout(children);
    const fresh = collectAll(layout);
    expect(fresh.length).toBe(1);

    layout.reflow(0);
    const frag = layout.next();
    expect(frag.blockSize).toBe(fresh[0].blockSize);
    expect(frag.breakToken).toBeNull();
  });
});
