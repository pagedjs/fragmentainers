import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PhysicalFragment } from '../src/fragment.js';
import { BlockBreakToken } from '../src/tokens.js';
import { PageSizeResolver, PageRule } from '../src/page-rules.js';
import { blockNode } from './fixtures/nodes.js';

// Import the renamed compositor function
import { getFragmentainerSize } from '../src/compositor/fragmentainer-builder.js';

// Import the new coordinator classes (directly, not via compositor index,
// because fragmentainer-layout.js pulls in DOM deps via dom/index.js)
import { FragmentainerLayout, FragmentedFlow } from '../src/fragmentainer-layout.js';

// ---------------------------------------------------------------------------
// getFragmentainerSize (renamed from getPageSize)
// ---------------------------------------------------------------------------

describe('getFragmentainerSize', () => {
  const sizes = [
    { inlineSize: 600, blockSize: 800 },
    { inlineSize: 800, blockSize: 600 },
  ];

  it('returns the size at the given index', () => {
    assert.deepEqual(getFragmentainerSize(sizes, 0), { inlineSize: 600, blockSize: 800 });
    assert.deepEqual(getFragmentainerSize(sizes, 1), { inlineSize: 800, blockSize: 600 });
  });

  it('returns the last size for indices beyond the array', () => {
    assert.deepEqual(getFragmentainerSize(sizes, 2), { inlineSize: 800, blockSize: 600 });
    assert.deepEqual(getFragmentainerSize(sizes, 99), { inlineSize: 800, blockSize: 600 });
  });

  it('works with a single-element array', () => {
    const single = [{ inlineSize: 500, blockSize: 700 }];
    assert.deepEqual(getFragmentainerSize(single, 0), { inlineSize: 500, blockSize: 700 });
    assert.deepEqual(getFragmentainerSize(single, 5), { inlineSize: 500, blockSize: 700 });
  });

  it('prefers fragment constraints over sizes array', () => {
    const fragments = [
      Object.assign(new PhysicalFragment(blockNode(), 100), {
        constraints: {
          contentArea: { inlineSize: 700, blockSize: 900 },
        },
      }),
    ];
    const fallback = [{ inlineSize: 600, blockSize: 800 }];
    assert.deepEqual(
      getFragmentainerSize(fallback, 0, fragments),
      { inlineSize: 700, blockSize: 900 }
    );
  });
});

// ---------------------------------------------------------------------------
// FragmentedFlow
// ---------------------------------------------------------------------------

describe('FragmentedFlow', () => {
  function makeFragments(count) {
    const fragments = [];
    let prevBreakToken = null;
    for (let i = 0; i < count; i++) {
      const node = blockNode({ debugName: `frag-${i}` });
      const frag = new PhysicalFragment(node, 200, []);
      frag.constraints = {
        contentArea: { inlineSize: 816, blockSize: 1056 },
      };
      if (i < count - 1) {
        const bt = new BlockBreakToken(node);
        bt.consumedBlockSize = (i + 1) * 200;
        frag.breakToken = bt;
      }
      fragments.push(frag);
    }
    return fragments;
  }

  it('exposes fragments array', () => {
    const fragments = makeFragments(3);
    const flow = new FragmentedFlow(fragments, null);
    assert.equal(flow.fragments, fragments);
  });

  it('reports correct fragmentainerCount', () => {
    const flow = new FragmentedFlow(makeFragments(5), null);
    assert.equal(flow.fragmentainerCount, 5);
  });

  it('reports zero fragmentainerCount for empty array', () => {
    const flow = new FragmentedFlow([], null);
    assert.equal(flow.fragmentainerCount, 0);
  });

  it('stores contentStyles', () => {
    const styles = { sheets: [], cssText: 'body { color: red }' };
    const flow = new FragmentedFlow(makeFragments(1), styles);
    // contentStyles is used internally by renderFragmentainer, verify it is retained
    assert.equal(flow._contentStyles, styles);
  });
});

// ---------------------------------------------------------------------------
// FragmentainerLayout constructor
// ---------------------------------------------------------------------------

describe('FragmentainerLayout', () => {
  // Use a mock element — flow() requires DOM, so we only test construction
  const mockElement = { getRootNode() { return {}; } };

  it('accepts a PageSizeResolver via options.resolver', () => {
    const resolver = new PageSizeResolver([], { inlineSize: 816, blockSize: 1056 });
    const layout = new FragmentainerLayout(mockElement, { resolver });
    assert.equal(layout._resolver, resolver);
  });

  it('creates a PageSizeResolver from defaultSize', () => {
    const layout = new FragmentainerLayout(mockElement, {
      defaultSize: { inlineSize: 600, blockSize: 800 },
    });
    assert.ok(layout._resolver instanceof PageSizeResolver);
    // The resolver should return the default size for any page
    const constraints = layout._resolver.resolve(0, null, null);
    assert.equal(constraints.contentArea.inlineSize, 600);
    assert.equal(constraints.contentArea.blockSize, 800);
  });

  it('uses letter size as default when no size specified', () => {
    const layout = new FragmentainerLayout(mockElement);
    assert.ok(layout._resolver instanceof PageSizeResolver);
    const constraints = layout._resolver.resolve(0, null, null);
    assert.equal(constraints.contentArea.inlineSize, 816);
    assert.equal(constraints.contentArea.blockSize, 1056);
  });

  it('resolver with @page rules overrides default size', () => {
    const rules = [new PageRule({ size: 'a5' })];
    const resolver = new PageSizeResolver(rules, { inlineSize: 816, blockSize: 1056 });
    const layout = new FragmentainerLayout(mockElement, { resolver });
    const constraints = layout._resolver.resolve(0, null, null);
    // A5 is 559x794
    assert.equal(constraints.contentArea.inlineSize, 559);
    assert.equal(constraints.contentArea.blockSize, 794);
  });
});
