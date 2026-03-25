import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BreakToken, BlockBreakToken, InlineBreakToken } from '../src/tokens.js';
import { findChildBreakToken, isMonolithic, debugPrintTokenTree } from '../src/helpers.js';
import { blockNode, replacedNode, scrollableNode } from './fixtures/nodes.js';

describe('BreakToken', () => {
  it('constructs with default flags', () => {
    const node = blockNode();
    const token = new BreakToken('block', node);
    assert.equal(token.type, 'block');
    assert.equal(token.node, node);
    assert.equal(token.isBreakBefore, false);
    assert.equal(token.isForcedBreak, false);
    assert.equal(token.isRepeated, false);
    assert.equal(token.isAtBlockEnd, false);
    assert.equal(token.hasSeenAllChildren, false);
  });
});

describe('BlockBreakToken', () => {
  it('constructs with default values', () => {
    const node = blockNode();
    const token = new BlockBreakToken(node);
    assert.equal(token.type, 'block');
    assert.equal(token.consumedBlockSize, 0);
    assert.equal(token.sequenceNumber, 0);
    assert.deepEqual(token.childBreakTokens, []);
    assert.equal(token.algorithmData, null);
  });

  it('createBreakBefore sets correct flags', () => {
    const node = blockNode({ debugName: 'pushed' });
    const token = BlockBreakToken.createBreakBefore(node, false);
    assert.equal(token.isBreakBefore, true);
    assert.equal(token.isForcedBreak, false);
    assert.equal(token.node, node);
  });

  it('createBreakBefore with forced break', () => {
    const node = blockNode();
    const token = BlockBreakToken.createBreakBefore(node, true);
    assert.equal(token.isBreakBefore, true);
    assert.equal(token.isForcedBreak, true);
  });

  it('createRepeated sets correct flags', () => {
    const node = blockNode({ debugName: 'thead' });
    const token = BlockBreakToken.createRepeated(node, 3);
    assert.equal(token.isRepeated, true);
    assert.equal(token.sequenceNumber, 3);
    assert.deepEqual(token.childBreakTokens, []);
  });

  it('createForBreakInRepeatedFragment sets all fields', () => {
    const node = blockNode();
    const token = BlockBreakToken.createForBreakInRepeatedFragment(node, 2, 150);
    assert.equal(token.isRepeated, true);
    assert.equal(token.sequenceNumber, 2);
    assert.equal(token.consumedBlockSize, 150);
  });
});

describe('InlineBreakToken', () => {
  it('constructs with default values', () => {
    const node = blockNode();
    const token = new InlineBreakToken(node);
    assert.equal(token.type, 'inline');
    assert.equal(token.itemIndex, 0);
    assert.equal(token.textOffset, 0);
    assert.equal(token.flags, 0);
  });
});

describe('Break token tree', () => {
  it('builds a sparse tree mirroring the box tree', () => {
    const child1 = blockNode({ debugName: 'child1' });
    const child2 = blockNode({ debugName: 'child2' });
    const grandchild = blockNode({ debugName: 'grandchild' });

    // grandchild broke — its parent (child2) has a break token containing it
    const grandchildToken = new BlockBreakToken(grandchild);
    grandchildToken.consumedBlockSize = 50;

    const child2Token = new BlockBreakToken(child2);
    child2Token.consumedBlockSize = 100;
    child2Token.childBreakTokens = [grandchildToken];

    const rootToken = new BlockBreakToken(blockNode({ debugName: 'root' }));
    rootToken.consumedBlockSize = 200;
    rootToken.childBreakTokens = [child2Token];

    // child1 completed — no token in the tree (sparse)
    assert.equal(rootToken.childBreakTokens.length, 1);
    assert.equal(rootToken.childBreakTokens[0].node, child2);
    assert.equal(rootToken.childBreakTokens[0].childBreakTokens[0].node, grandchild);
  });

  it('contains inline break token as leaf', () => {
    const paragraph = blockNode({ debugName: 'p' });
    const inlineNode = blockNode({ debugName: 'text' });

    const inlineToken = new InlineBreakToken(inlineNode);
    inlineToken.itemIndex = 12;
    inlineToken.textOffset = 347;

    const pToken = new BlockBreakToken(paragraph);
    pToken.consumedBlockSize = 280;
    pToken.childBreakTokens = [inlineToken];

    assert.equal(pToken.childBreakTokens[0].type, 'inline');
    assert.equal(pToken.childBreakTokens[0].itemIndex, 12);
    assert.equal(pToken.childBreakTokens[0].textOffset, 347);
  });
});

describe('findChildBreakToken', () => {
  it('returns null when parent is null', () => {
    const child = blockNode();
    assert.equal(findChildBreakToken(null, child), null);
  });

  it('returns null when child has no token', () => {
    const parent = new BlockBreakToken(blockNode());
    const child = blockNode();
    assert.equal(findChildBreakToken(parent, child), null);
  });

  it('finds the correct child token', () => {
    const childA = blockNode({ debugName: 'A' });
    const childB = blockNode({ debugName: 'B' });
    const tokenB = new BlockBreakToken(childB);

    const parent = new BlockBreakToken(blockNode());
    parent.childBreakTokens = [tokenB];

    assert.equal(findChildBreakToken(parent, childA), null);
    assert.equal(findChildBreakToken(parent, childB), tokenB);
  });
});

describe('isMonolithic', () => {
  it('replaced elements are monolithic', () => {
    assert.equal(isMonolithic(replacedNode()), true);
  });

  it('scrollable elements are monolithic', () => {
    assert.equal(isMonolithic(scrollableNode()), true);
  });

  it('overflow:hidden with explicit height is monolithic', () => {
    const node = blockNode({ hasOverflowHidden: true, hasExplicitBlockSize: true });
    assert.equal(isMonolithic(node), true);
  });

  it('overflow:hidden without explicit height is not monolithic', () => {
    const node = blockNode({ hasOverflowHidden: true, hasExplicitBlockSize: false });
    assert.equal(isMonolithic(node), false);
  });

  it('normal block is not monolithic', () => {
    assert.equal(isMonolithic(blockNode()), false);
  });
});

describe('debugPrintTokenTree', () => {
  it('prints null token', () => {
    assert.equal(debugPrintTokenTree(null), '(null)');
  });

  it('prints a block token with flags', () => {
    const node = blockNode({ debugName: 'section' });
    const token = new BlockBreakToken(node);
    token.consumedBlockSize = 312;
    token.sequenceNumber = 1;
    token.hasSeenAllChildren = true;

    const output = debugPrintTokenTree(token);
    assert.ok(output.includes('section'));
    assert.ok(output.includes('consumed=312'));
    assert.ok(output.includes('seq=1'));
    assert.ok(output.includes('seen-all'));
  });
});
