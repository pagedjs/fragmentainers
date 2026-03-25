import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { paginateContent } from '../src/driver.js';
import { blockNode, replacedNode, scrollableNode } from './fixtures/nodes.js';

describe('Phase 4: Monolithic content', () => {
  it('pushes a monolithic element to the next page when it does not fit', () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: 'div', blockSize: 50 }),
        replacedNode({ debugName: 'img', blockSize: 300 }),
        blockNode({ debugName: 'after', blockSize: 50 }),
      ],
    });

    // 200px fragmentainer. div=50, img=300 doesn't fit (150 remaining), pushed.
    const pages = paginateContent(root, [{ inlineSize: 600, blockSize: 200 }]);

    assert.equal(pages.length, 3);
    // Page 1: just the div
    assert.equal(pages[0].childFragments.length, 1);
    assert.equal(pages[0].blockSize, 50);
    // Break token should have createBreakBefore for img
    assert.ok(pages[0].breakToken);
    assert.equal(pages[0].breakToken.childBreakTokens[0].isBreakBefore, true);

    // Page 2: img placed at top, overflows (300 > 200), 'after' pushed
    assert.equal(pages[1].childFragments.length, 1);
    assert.equal(pages[1].childFragments[0].blockSize, 300);

    // Page 3: after
    assert.equal(pages[2].childFragments.length, 1);
    assert.equal(pages[2].blockSize, 50);
  });

  it('places monolithic at top of fragmentainer even if it overflows', () => {
    const root = blockNode({
      children: [
        replacedNode({ debugName: 'big-img', blockSize: 500 }),
      ],
    });

    // 200px fragmentainer. img at offset 0 → placed even though it overflows.
    const pages = paginateContent(root, [{ inlineSize: 600, blockSize: 200 }]);

    assert.equal(pages.length, 1);
    assert.equal(pages[0].childFragments.length, 1);
    assert.equal(pages[0].childFragments[0].blockSize, 500);
  });

  it('monolithic elements never produce their own break token', () => {
    const root = blockNode({
      children: [
        replacedNode({ debugName: 'img', blockSize: 500 }),
        blockNode({ debugName: 'after', blockSize: 50 }),
      ],
    });

    const pages = paginateContent(root, [{ inlineSize: 600, blockSize: 200 }]);

    // img placed with overflow (500px at offset 0), 'after' pushed
    // The img itself should NOT have a break token
    assert.equal(pages[0].childFragments[0].breakToken, null);
  });

  it('pushes scrollable monolithic element', () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: 'header', blockSize: 100 }),
        scrollableNode({ debugName: 'scroller', blockSize: 200 }),
      ],
    });

    // 150px fragmentainer. header=100, scroller=200 doesn't fit (50 remaining).
    const pages = paginateContent(root, [{ inlineSize: 600, blockSize: 150 }]);

    assert.equal(pages.length, 2);
    assert.equal(pages[0].childFragments.length, 1); // just header
    assert.equal(pages[1].childFragments.length, 1); // scroller on page 2
  });

  it('monolithic element that fits is placed normally', () => {
    const root = blockNode({
      children: [
        replacedNode({ debugName: 'small-img', blockSize: 100 }),
        blockNode({ debugName: 'text', blockSize: 50 }),
      ],
    });

    const pages = paginateContent(root, [{ inlineSize: 600, blockSize: 200 }]);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].childFragments.length, 2);
  });
});
