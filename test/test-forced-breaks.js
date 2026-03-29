import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFragments } from '../src/driver.js';
import { ConstraintSpace } from '../src/constraint-space.js';
import { blockNode } from './fixtures/nodes.js';

describe('Phase 8: Forced breaks', () => {
  it('break-before: page forces a page break', () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: 'A', blockSize: 50 }),
        blockNode({ debugName: 'B', blockSize: 50, breakBefore: 'page' }),
        blockNode({ debugName: 'C', blockSize: 50 }),
      ],
    });

    // 1000px fragmentainer — everything fits, but forced break before B
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: 'page',
    }));
    assert.equal(pages.length, 2);

    // Page 1: only A
    assert.equal(pages[0].childFragments.length, 1);
    assert.equal(pages[0].blockSize, 50);
    assert.ok(pages[0].breakToken);
    assert.equal(pages[0].breakToken.childBreakTokens[0].isForcedBreak, true);

    // Page 2: B + C
    assert.equal(pages[1].childFragments.length, 2);
    assert.equal(pages[1].blockSize, 100);
  });

  it('break-before: column forces a break', () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: 'A', blockSize: 50 }),
        blockNode({ debugName: 'B', blockSize: 50, breakBefore: 'column' }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: 'page',
    }));
    assert.equal(pages.length, 2);
  });

  it('break-before: always forces a break', () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: 'A', blockSize: 50 }),
        blockNode({ debugName: 'B', blockSize: 50, breakBefore: 'always' }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: 'page',
    }));
    assert.equal(pages.length, 2);
  });

  it('break-after: page forces a break after the element', () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: 'A', blockSize: 50, breakAfter: 'page' }),
        blockNode({ debugName: 'B', blockSize: 50 }),
        blockNode({ debugName: 'C', blockSize: 50 }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: 'page',
    }));
    assert.equal(pages.length, 2);

    // Page 1: only A
    assert.equal(pages[0].childFragments.length, 1);
    assert.equal(pages[0].blockSize, 50);

    // Page 2: B + C
    assert.equal(pages[1].childFragments.length, 2);
  });

  it('break-before on first child does nothing (already at top)', () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: 'A', blockSize: 50, breakBefore: 'page' }),
        blockNode({ debugName: 'B', blockSize: 50 }),
      ],
    });

    // First child has break-before but blockOffset is 0 → no effect
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: 'page',
    }));
    assert.equal(pages.length, 1);
    assert.equal(pages[0].childFragments.length, 2);
  });

  it('break-after on last child does nothing', () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: 'A', blockSize: 50 }),
        blockNode({ debugName: 'B', blockSize: 50, breakAfter: 'page' }),
      ],
    });

    // Last child has break-after but no more children → no break
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: 'page',
    }));
    assert.equal(pages.length, 1);
  });

  it('multiple forced breaks produce multiple pages', () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: 'ch1', blockSize: 50 }),
        blockNode({ debugName: 'ch2', blockSize: 50, breakBefore: 'page' }),
        blockNode({ debugName: 'ch3', blockSize: 50, breakBefore: 'page' }),
        blockNode({ debugName: 'ch4', blockSize: 50 }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: 'page',
    }));
    assert.equal(pages.length, 3);
    assert.equal(pages[0].childFragments.length, 1); // ch1
    assert.equal(pages[1].childFragments.length, 1); // ch2
    assert.equal(pages[2].childFragments.length, 2); // ch3 + ch4
  });

  it('break-before: avoid does not force a break', () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: 'A', blockSize: 50 }),
        blockNode({ debugName: 'B', blockSize: 50, breakBefore: 'avoid' }),
      ],
    });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 1000,
      fragmentainerBlockSize: 1000,
      fragmentationType: 'page',
    }));
    assert.equal(pages.length, 1);
  });
});
