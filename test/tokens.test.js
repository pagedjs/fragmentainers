import { describe, it, expect } from "vitest";
import { BlockBreakToken, InlineBreakToken } from "../src/tokens.js";
import { findChildBreakToken, isMonolithic } from "../src/helpers.js";
import { blockNode, replacedNode, scrollableNode } from "./fixtures/nodes.js";

describe("BlockBreakToken", () => {
  it("createBreakBefore sets correct flags", () => {
    const node = blockNode({ debugName: "pushed" });
    const token = BlockBreakToken.createBreakBefore(node, false);
    expect(token.isBreakBefore).toBe(true);
    expect(token.isForcedBreak).toBe(false);
    expect(token.node).toBe(node);
  });

  it("createBreakBefore with forced break", () => {
    const node = blockNode();
    const token = BlockBreakToken.createBreakBefore(node, true);
    expect(token.isBreakBefore).toBe(true);
    expect(token.isForcedBreak).toBe(true);
  });

  it("createRepeated sets correct flags", () => {
    const node = blockNode({ debugName: "thead" });
    const token = BlockBreakToken.createRepeated(node, 3);
    expect(token.isRepeated).toBe(true);
    expect(token.sequenceNumber).toBe(3);
    expect(token.childBreakTokens).toEqual([]);
  });

  it("createForBreakInRepeatedFragment sets all fields", () => {
    const node = blockNode();
    const token = BlockBreakToken.createForBreakInRepeatedFragment(node, 2, 150);
    expect(token.isRepeated).toBe(true);
    expect(token.sequenceNumber).toBe(2);
    expect(token.consumedBlockSize).toBe(150);
  });
});

describe("Break token tree", () => {
  it("builds a sparse tree mirroring the box tree", () => {
    blockNode({ debugName: "child1" });
    const child2 = blockNode({ debugName: "child2" });
    const grandchild = blockNode({ debugName: "grandchild" });

    // grandchild broke — its parent (child2) has a break token containing it
    const grandchildToken = new BlockBreakToken(grandchild);
    grandchildToken.consumedBlockSize = 50;

    const child2Token = new BlockBreakToken(child2);
    child2Token.consumedBlockSize = 100;
    child2Token.childBreakTokens = [grandchildToken];

    const rootToken = new BlockBreakToken(blockNode({ debugName: "root" }));
    rootToken.consumedBlockSize = 200;
    rootToken.childBreakTokens = [child2Token];

    // child1 completed — no token in the tree (sparse)
    expect(rootToken.childBreakTokens.length).toBe(1);
    expect(rootToken.childBreakTokens[0].node).toBe(child2);
    expect(rootToken.childBreakTokens[0].childBreakTokens[0].node).toBe(grandchild);
  });

  it("contains inline break token as leaf", () => {
    const paragraph = blockNode({ debugName: "p" });
    const inlineNode = blockNode({ debugName: "text" });

    const inlineToken = new InlineBreakToken(inlineNode);
    inlineToken.itemIndex = 12;
    inlineToken.textOffset = 347;

    const pToken = new BlockBreakToken(paragraph);
    pToken.consumedBlockSize = 280;
    pToken.childBreakTokens = [inlineToken];

    expect(pToken.childBreakTokens[0].type).toBe("inline");
    expect(pToken.childBreakTokens[0].itemIndex).toBe(12);
    expect(pToken.childBreakTokens[0].textOffset).toBe(347);
  });
});

describe("findChildBreakToken", () => {
  it("returns null when parent is null", () => {
    const child = blockNode();
    expect(findChildBreakToken(null, child)).toBe(null);
  });

  it("returns null when child has no token", () => {
    const parent = new BlockBreakToken(blockNode());
    const child = blockNode();
    expect(findChildBreakToken(parent, child)).toBe(null);
  });

  it("finds the correct child token", () => {
    const childA = blockNode({ debugName: "A" });
    const childB = blockNode({ debugName: "B" });
    const tokenB = new BlockBreakToken(childB);

    const parent = new BlockBreakToken(blockNode());
    parent.childBreakTokens = [tokenB];

    expect(findChildBreakToken(parent, childA)).toBe(null);
    expect(findChildBreakToken(parent, childB)).toBe(tokenB);
  });
});

describe("isMonolithic", () => {
  it("replaced elements are monolithic", () => {
    expect(isMonolithic(replacedNode())).toBe(true);
  });

  it("scrollable elements are monolithic", () => {
    expect(isMonolithic(scrollableNode())).toBe(true);
  });

  it("overflow:hidden with explicit height is monolithic", () => {
    const node = blockNode({ hasOverflowHidden: true, hasExplicitBlockSize: true });
    expect(isMonolithic(node)).toBe(true);
  });

  it("overflow:hidden without explicit height is not monolithic", () => {
    const node = blockNode({ hasOverflowHidden: true, hasExplicitBlockSize: false });
    expect(isMonolithic(node)).toBe(false);
  });

  it("normal block is not monolithic", () => {
    expect(isMonolithic(blockNode())).toBe(false);
  });
});

