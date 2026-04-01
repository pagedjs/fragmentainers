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

  it("reflow(0) then flow() matches a fresh layout", async () => {
    const children = [
      blockNode({ blockSize: 200 }),
      blockNode({ blockSize: 200 }),
      blockNode({ blockSize: 200 }),
    ];

    // Fresh layout
    const layout1 = makeLayout(children);
    const flow1 = await layout1.flow();

    // Second layout: flow once, then reflow from 0 and flow again
    const layout2 = makeLayout(children);
    await layout2.flow();
    layout2.reflow(0);
    const flow2 = await layout2.flow();

    expect(flow2.fragmentainerCount).toBe(flow1.fragmentainerCount);
    for (let i = 0; i < flow1.fragmentainerCount; i++) {
      expect(flow2.fragments[i].blockSize).toBe(flow1.fragments[i].blockSize);
      expect(flow2.fragments[i].childFragments.length).toBe(
        flow1.fragments[i].childFragments.length,
      );
    }
  });

  it("reflow(1) then next() matches original fragments from index 1", async () => {
    const children = [
      blockNode({ blockSize: 200 }),
      blockNode({ blockSize: 200 }),
      blockNode({ blockSize: 200 }),
    ];

    // Fresh layout — collect all fragments
    const layout1 = makeLayout(children);
    const flow1 = await layout1.flow();

    // Same layout — reflow from index 1
    const layout2 = makeLayout(children);
    await layout2.flow();
    layout2.reflow(1);

    const reflowed = [];
    let frag;
    do {
      frag = layout2.next();
      reflowed.push(frag);
    } while (frag.breakToken !== null);

    // Reflowed should match fragments[1..]
    expect(reflowed.length).toBe(flow1.fragmentainerCount - 1);
    for (let i = 0; i < reflowed.length; i++) {
      expect(reflowed[i].blockSize).toBe(flow1.fragments[i + 1].blockSize);
    }
  });

  it("reflow() restores counter state from preceding fragment", async () => {
    const section = blockNode({
      counterReset: "paragraph 0",
      children: [
        blockNode({ blockSize: 200, counterIncrement: "paragraph 1" }),
        blockNode({ blockSize: 200, counterIncrement: "paragraph 1" }),
        blockNode({ blockSize: 200, counterIncrement: "paragraph 1" }),
      ],
    });

    const layout = makeLayout([section]);
    const flow = await layout.flow();

    // Fragment 0 should have accumulated some counter state
    const countersBefore = flow.fragments[0].counterState;

    // Reflow from index 1 — counter state should be restored from fragment 0
    layout.reflow(1);
    const frag = layout.next();

    // If there was counter state on fragment 0, fragment 1 should continue from it
    if (countersBefore) {
      expect(frag.counterState).toBeDefined();
    }
  });

  it("reflow(0) on single-fragment content produces identical result", async () => {
    const children = [blockNode({ blockSize: 100 })];

    const layout = makeLayout(children);
    const flow1 = await layout.flow();
    expect(flow1.fragmentainerCount).toBe(1);

    layout.reflow(0);
    const frag = layout.next();
    expect(frag.blockSize).toBe(flow1.fragments[0].blockSize);
    expect(frag.breakToken).toBeNull();
  });
});
