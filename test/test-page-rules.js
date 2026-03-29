import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PageRule, PageConstraints, PageSizeResolver, parseCSSLength,
} from '../src/page-rules.js';
import {
  getNamedPage, resolveNamedPageForBreakToken,
} from '../src/helpers.js';
import { BlockBreakToken } from '../src/tokens.js';
import { paginateContent } from '../src/driver.js';
import { blockNode } from './fixtures/nodes.js';

// -- PageSizeResolver --

describe('PageSizeResolver', () => {
  const DEFAULT_SIZE = { inlineSize: 816, blockSize: 1056 };

  it('returns default size when no rules', () => {
    const resolver = new PageSizeResolver([], DEFAULT_SIZE);
    const c = resolver.resolve(0, null, null);
    assert.deepEqual(c.contentArea, DEFAULT_SIZE);
    assert.deepEqual(c.margins, { top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('universal @page with explicit size', () => {
    const resolver = new PageSizeResolver([
      new PageRule({ size: [600, 800] }),
    ], DEFAULT_SIZE);
    const c = resolver.resolve(0, null, null);
    assert.equal(c.contentArea.inlineSize, 600);
    assert.equal(c.contentArea.blockSize, 800);
  });

  it('universal @page with named size (a4)', () => {
    const resolver = new PageSizeResolver([
      new PageRule({ size: 'a4' }),
    ], DEFAULT_SIZE);
    const c = resolver.resolve(0, null, null);
    assert.equal(c.pageBoxSize.inlineSize, 794);
    assert.equal(c.pageBoxSize.blockSize, 1123);
  });

  it('named size with landscape orientation', () => {
    const resolver = new PageSizeResolver([
      new PageRule({ size: 'letter landscape' }),
    ], DEFAULT_SIZE);
    const c = resolver.resolve(0, null, null);
    assert.equal(c.pageBoxSize.inlineSize, 1056);
    assert.equal(c.pageBoxSize.blockSize, 816);
  });

  it('bare landscape rotates default', () => {
    const resolver = new PageSizeResolver([
      new PageRule({ size: 'landscape' }),
    ], DEFAULT_SIZE);
    const c = resolver.resolve(0, null, null);
    assert.equal(c.pageBoxSize.inlineSize, DEFAULT_SIZE.blockSize);
    assert.equal(c.pageBoxSize.blockSize, DEFAULT_SIZE.inlineSize);
  });

  it('applies margins and computes content area', () => {
    const resolver = new PageSizeResolver([
      new PageRule({ size: [800, 1000], margin: { top: 50, right: 40, bottom: 50, left: 40 } }),
    ], DEFAULT_SIZE);
    const c = resolver.resolve(0, null, null);
    assert.equal(c.contentArea.inlineSize, 720); // 800 - 40 - 40
    assert.equal(c.contentArea.blockSize, 900);  // 1000 - 50 - 50
  });

  it(':first pseudo-class matches only page 0', () => {
    const resolver = new PageSizeResolver([
      new PageRule({ size: [600, 800] }),
      new PageRule({ pseudoClass: 'first', size: [400, 500] }),
    ], DEFAULT_SIZE);

    const c0 = resolver.resolve(0, null, null);
    assert.equal(c0.contentArea.inlineSize, 400);

    const c1 = resolver.resolve(1, null, null);
    assert.equal(c1.contentArea.inlineSize, 600);
  });

  it(':left/:right alternate by page index', () => {
    const resolver = new PageSizeResolver([
      new PageRule({ size: [600, 800] }),
      new PageRule({ pseudoClass: 'right', margin: { top: 0, right: 100, bottom: 0, left: 0 } }),
      new PageRule({ pseudoClass: 'left', margin: { top: 0, right: 0, bottom: 0, left: 100 } }),
    ], DEFAULT_SIZE);

    // Page 0 is right (recto)
    const c0 = resolver.resolve(0, null, null);
    assert.equal(c0.margins.right, 100);
    assert.equal(c0.margins.left, 0);

    // Page 1 is left (verso)
    const c1 = resolver.resolve(1, null, null);
    assert.equal(c1.margins.left, 100);
    assert.equal(c1.margins.right, 0);
  });

  it('named page rule matches only its named page', () => {
    const resolver = new PageSizeResolver([
      new PageRule({ size: [600, 800] }),
      new PageRule({ name: 'chapter', size: [500, 700] }),
    ], DEFAULT_SIZE);

    const cNone = resolver.resolve(0, null, null);
    assert.equal(cNone.contentArea.inlineSize, 600);

    const cChapter = resolver.resolve(1, 'chapter', null);
    assert.equal(cChapter.contentArea.inlineSize, 500);
  });

  it('cascade: named+pseudo overrides named overrides pseudo overrides universal', () => {
    const resolver = new PageSizeResolver([
      new PageRule({ size: [100, 100] }),                                        // universal
      new PageRule({ pseudoClass: 'first', size: [200, 200] }),                  // pseudo
      new PageRule({ name: 'cover', size: [300, 300] }),                         // named
      new PageRule({ name: 'cover', pseudoClass: 'first', size: [400, 400] }),   // named+pseudo
    ], DEFAULT_SIZE);

    // Page 0, named 'cover' → named+pseudo wins
    const c = resolver.resolve(0, 'cover', null);
    assert.equal(c.contentArea.inlineSize, 400);
  });

  it('cascade: margins merge from multiple rules', () => {
    const resolver = new PageSizeResolver([
      new PageRule({ size: [600, 800], margin: { top: 10, right: 10, bottom: 10, left: 10 } }),
      new PageRule({ name: 'wide', margin: { left: 50, right: 50 } }),
    ], DEFAULT_SIZE);

    const c = resolver.resolve(0, 'wide', null);
    assert.equal(c.margins.top, 10);    // from universal
    assert.equal(c.margins.left, 50);   // overridden by named
    assert.equal(c.margins.right, 50);  // overridden by named
  });

  it('page-orientation: rotate-left swaps dimensions', () => {
    const resolver = new PageSizeResolver([
      new PageRule({ size: [600, 800], pageOrientation: 'rotate-left' }),
    ], DEFAULT_SIZE);
    const c = resolver.resolve(0, null, null);
    assert.equal(c.pageBoxSize.inlineSize, 800);
    assert.equal(c.pageBoxSize.blockSize, 600);
  });

  it('toConstraintSpace() produces correct values', () => {
    const resolver = new PageSizeResolver([
      new PageRule({ size: [600, 800], margin: { top: 20, right: 20, bottom: 20, left: 20 } }),
    ], DEFAULT_SIZE);

    const c = resolver.resolve(0, null, null);
    const cs = c.toConstraintSpace();
    assert.equal(cs.availableInlineSize, 560);
    assert.equal(cs.availableBlockSize, 760);
    assert.equal(cs.fragmentainerBlockSize, 760);
    assert.equal(cs.blockOffsetInFragmentainer, 0);
    assert.equal(cs.fragmentationType, 'page');
  });

  it('isFirstPage and isLeftPage flags', () => {
    const resolver = new PageSizeResolver([], DEFAULT_SIZE);

    const c0 = resolver.resolve(0, null, null);
    assert.equal(c0.isFirstPage, true);
    assert.equal(c0.isLeftPage, false); // page 0 = right (recto)

    const c1 = resolver.resolve(1, null, null);
    assert.equal(c1.isFirstPage, false);
    assert.equal(c1.isLeftPage, true);  // page 1 = left (verso)
  });
});

// -- parseCSSLength --

describe('parseCSSLength', () => {
  it('parses px', () => assert.equal(parseCSSLength('100px'), 100));
  it('parses in', () => assert.equal(parseCSSLength('1in'), 96));
  it('parses cm', () => assert.ok(Math.abs(parseCSSLength('2.54cm') - 96) < 0.01));
  it('parses mm', () => assert.ok(Math.abs(parseCSSLength('25.4mm') - 96) < 0.01));
  it('parses pt', () => assert.equal(parseCSSLength('72pt'), 96));
  it('parses bare number as px', () => assert.equal(parseCSSLength('50'), 50));
  it('returns null for invalid', () => assert.equal(parseCSSLength('abc'), null));
});

// -- getNamedPage --

describe('getNamedPage', () => {
  it('returns page property from node', () => {
    assert.equal(getNamedPage(blockNode({ page: 'cover' })), 'cover');
  });

  it('returns null for node with no page', () => {
    assert.equal(getNamedPage(blockNode()), null);
  });

  it('returns null for null node', () => {
    assert.equal(getNamedPage(null), null);
  });
});

// -- resolveNamedPageForBreakToken --

describe('resolveNamedPageForBreakToken', () => {
  it('returns first child page when no break token', () => {
    const root = blockNode({
      children: [
        blockNode({ page: 'cover' }),
        blockNode({ page: 'chapter' }),
      ],
    });
    assert.equal(resolveNamedPageForBreakToken(root, null), 'cover');
  });

  it('returns null when first child has no page', () => {
    const root = blockNode({
      children: [blockNode(), blockNode()],
    });
    assert.equal(resolveNamedPageForBreakToken(root, null), null);
  });

  it('returns page of isBreakBefore child', () => {
    const childB = blockNode({ debugName: 'B', page: 'chapter' });
    const root = blockNode({
      children: [
        blockNode({ debugName: 'A' }),
        childB,
      ],
    });

    const bt = new BlockBreakToken(root);
    const childBT = BlockBreakToken.createBreakBefore(childB, true);
    bt.childBreakTokens.push(childBT);

    assert.equal(resolveNamedPageForBreakToken(root, bt), 'chapter');
  });

  it('returns page of next sibling when break inside a child', () => {
    const childA = blockNode({ debugName: 'A', blockSize: 200 });
    const childB = blockNode({ debugName: 'B', page: 'appendix' });
    const root = blockNode({
      children: [childA, childB],
    });

    // Break inside childA (not isBreakBefore)
    const bt = new BlockBreakToken(root);
    const childAToken = new BlockBreakToken(childA);
    childAToken.consumedBlockSize = 100;
    bt.childBreakTokens.push(childAToken);

    assert.equal(resolveNamedPageForBreakToken(root, bt), 'appendix');
  });
});

// -- Forced breaks from named page changes --

describe('Named page forced breaks', () => {
  it('forces break when page property changes between siblings', () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: 'A', blockSize: 50, page: 'cover' }),
        blockNode({ debugName: 'B', blockSize: 50, page: 'chapter' }),
        blockNode({ debugName: 'C', blockSize: 50, page: 'chapter' }),
      ],
    });

    const pages = paginateContent(root, [{ inlineSize: 600, blockSize: 1000 }]);
    assert.equal(pages.length, 2);
    assert.equal(pages[0].childFragments.length, 1); // Only A
    assert.equal(pages[1].childFragments.length, 2); // B + C (same page name)
  });

  it('forces break when changing from named to null', () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: 'A', blockSize: 50, page: 'cover' }),
        blockNode({ debugName: 'B', blockSize: 50 }),
      ],
    });

    const pages = paginateContent(root, [{ inlineSize: 600, blockSize: 1000 }]);
    assert.equal(pages.length, 2);
  });

  it('forces break when changing from null to named', () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: 'A', blockSize: 50 }),
        blockNode({ debugName: 'B', blockSize: 50, page: 'chapter' }),
      ],
    });

    const pages = paginateContent(root, [{ inlineSize: 600, blockSize: 1000 }]);
    assert.equal(pages.length, 2);
  });

  it('no break when both siblings have same page', () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: 'A', blockSize: 50, page: 'chapter' }),
        blockNode({ debugName: 'B', blockSize: 50, page: 'chapter' }),
      ],
    });

    const pages = paginateContent(root, [{ inlineSize: 600, blockSize: 1000 }]);
    assert.equal(pages.length, 1);
  });

  it('no break when both siblings have null page', () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: 'A', blockSize: 50 }),
        blockNode({ debugName: 'B', blockSize: 50 }),
      ],
    });

    const pages = paginateContent(root, [{ inlineSize: 600, blockSize: 1000 }]);
    assert.equal(pages.length, 1);
  });

  it('forced break token has isForcedBreak = true', () => {
    const root = blockNode({
      children: [
        blockNode({ debugName: 'A', blockSize: 50, page: 'cover' }),
        blockNode({ debugName: 'B', blockSize: 50, page: 'chapter' }),
      ],
    });

    const pages = paginateContent(root, [{ inlineSize: 600, blockSize: 1000 }]);
    assert.equal(pages[0].breakToken.childBreakTokens[0].isForcedBreak, true);
  });
});

// -- paginateContent with PageSizeResolver --

describe('paginateContent with PageSizeResolver', () => {
  it('resolves page sizes dynamically', () => {
    const DEFAULT_SIZE = { inlineSize: 600, blockSize: 1000 };
    const resolver = new PageSizeResolver([
      new PageRule({ size: [600, 1000] }),
    ], DEFAULT_SIZE);

    const root = blockNode({
      children: [
        blockNode({ blockSize: 800 }),
        blockNode({ blockSize: 800 }),
      ],
    });

    const pages = paginateContent(root, resolver);
    assert.equal(pages.length, 2);
    assert.ok(pages[0].constraints);
    assert.equal(pages[0].constraints.contentArea.inlineSize, 600);
  });

  it('uses named page sizes for different pages', () => {
    const resolver = new PageSizeResolver([
      new PageRule({ size: [600, 200] }),
      new PageRule({ name: 'wide', size: [800, 200] }),
    ], { inlineSize: 600, blockSize: 200 });

    const root = blockNode({
      children: [
        blockNode({ debugName: 'narrow', blockSize: 50 }),
        blockNode({ debugName: 'wide-content', blockSize: 50, page: 'wide' }),
      ],
    });

    const pages = paginateContent(root, resolver);
    assert.equal(pages.length, 2);
    assert.equal(pages[0].constraints.contentArea.inlineSize, 600);
    assert.equal(pages[1].constraints.contentArea.inlineSize, 800);
    assert.equal(pages[1].constraints.namedPage, 'wide');
  });

  it('backward compat: array of sizes still works', () => {
    const root = blockNode({
      children: [blockNode({ blockSize: 50 })],
    });

    const pages = paginateContent(root, [{ inlineSize: 600, blockSize: 200 }]);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].constraints, null); // no constraints in array path
  });
});
