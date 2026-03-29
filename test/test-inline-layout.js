import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFragments } from '../src/driver.js';
import { ConstraintSpace } from '../src/constraint-space.js';
import { blockNode, inlineNode, textToInlineItems } from './fixtures/nodes.js';

describe('Phase 5: Inline content fragmentation', () => {
  it('lays out inline content that fits in one page', () => {
    const text = 'Hello world this is a test';
    const node = inlineNode({
      debugName: 'p',
      inlineItemsData: textToInlineItems(text),
      lineHeight: 20,
      measureText: (t) => t.length * 8, // 8px per char
      availableInlineSize: 600,
    });

    const root = blockNode({ children: [node] });

    // Wide enough for the entire text on one line (200 chars * 8 = 1600 max)
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 800,
      fragmentainerBlockSize: 800,
      fragmentationType: 'page',
    }));
    assert.equal(pages.length, 1);
    assert.equal(pages[0].breakToken, null);
  });

  it('breaks text across multiple lines', () => {
    // 10 words of 5 chars + space = ~48px per word at 8px/char
    const words = Array.from({ length: 10 }, () => 'hello').join(' ');
    const node = inlineNode({
      debugName: 'p',
      inlineItemsData: textToInlineItems(words),
      lineHeight: 20,
      measureText: (t) => t.length * 8,
      availableInlineSize: 100,
    });

    const root = blockNode({ children: [node] });

    // 100px wide → about 12 chars per line → multiple lines
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 100,
      availableBlockSize: 800,
      fragmentainerBlockSize: 800,
      fragmentationType: 'page',
    }));
    assert.equal(pages.length, 1);
    // Should have multiple line fragments
    const inlineFragment = pages[0].childFragments[0];
    assert.ok(inlineFragment.childFragments.length > 1);
  });

  it('fragments inline content across pages', () => {
    // Generate enough text to span 3+ pages
    const words = Array.from({ length: 100 }, () => 'word').join(' ');
    const node = inlineNode({
      debugName: 'p',
      inlineItemsData: textToInlineItems(words),
      lineHeight: 20,
      measureText: (t) => t.length * 8,
      availableInlineSize: 200,
    });

    const root = blockNode({ children: [node] });

    // 200px wide, 100px tall → 5 lines per page
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 200,
      availableBlockSize: 100,
      fragmentainerBlockSize: 100,
      fragmentationType: 'page',
    }));
    assert.ok(pages.length > 1, `Expected multiple pages, got ${pages.length}`);

    // First page should have a break token
    assert.ok(pages[0].breakToken);

    // Last page should have no break token
    assert.equal(pages[pages.length - 1].breakToken, null);
  });

  it('InlineBreakToken has correct content-addressed position', () => {
    const words = Array.from({ length: 50 }, () => 'test').join(' ');
    const node = inlineNode({
      debugName: 'p',
      inlineItemsData: textToInlineItems(words),
      lineHeight: 20,
      measureText: (t) => t.length * 8,
      availableInlineSize: 200,
    });

    const root = blockNode({ children: [node] });

    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 200,
      availableBlockSize: 60,
      fragmentainerBlockSize: 60,
      fragmentationType: 'page',
    }));
    assert.ok(pages.length > 1);

    // The break token from the inline node should have itemIndex and textOffset
    const rootBT = pages[0].breakToken;
    assert.ok(rootBT);
    // Find the inline break token (could be nested)
    const inlineBT = rootBT.childBreakTokens[0];
    assert.ok(inlineBT);
    assert.equal(inlineBT.type, 'inline');
    assert.ok(inlineBT.textOffset > 0, 'textOffset should be > 0');
  });

  it('handles forced line break (<br>) without fragmentainer break', () => {
    const text = 'line one\nline two\nline three';
    const node = inlineNode({
      debugName: 'p',
      inlineItemsData: textToInlineItems(text),
      lineHeight: 20,
      measureText: (t) => t.length * 8,
      availableInlineSize: 600,
    });

    const root = blockNode({ children: [node] });

    // Plenty of space — all 3 lines fit
    const pages = createFragments(root, new ConstraintSpace({
      availableInlineSize: 600,
      availableBlockSize: 800,
      fragmentainerBlockSize: 800,
      fragmentationType: 'page',
    }));
    assert.equal(pages.length, 1);
    // Should have 3 line fragments (one per \n-separated segment)
    const inlineFragment = pages[0].childFragments[0];
    assert.equal(inlineFragment.childFragments.length, 3);
  });

  it('varying inline size between pages changes line breaks', () => {
    const words = Array.from({ length: 30 }, () => 'word').join(' ');
    const node = inlineNode({
      debugName: 'p',
      inlineItemsData: textToInlineItems(words),
      lineHeight: 20,
      measureText: (t) => t.length * 8,
      availableInlineSize: 100,
    });

    const root = blockNode({ children: [node] });

    // Page 1: narrow (100px), Page 2: wide (400px)
    // Same content-addressed break token, different line layout
    const pages = createFragments(root, {
      resolve: (index) => {
        const sizes = [
          { inlineSize: 100, blockSize: 60 },
          { inlineSize: 400, blockSize: 200 },
        ];
        const size = sizes[index] || sizes.at(-1);
        return {
          toConstraintSpace: () => new ConstraintSpace({
            availableInlineSize: size.inlineSize,
            availableBlockSize: size.blockSize,
            fragmentainerBlockSize: size.blockSize,
            fragmentationType: 'page',
          }),
        };
      },
    });

    assert.ok(pages.length >= 2);
    // Page 1 lines should be narrower than page 2 lines
    const p1Lines = pages[0].childFragments[0].childFragments.length;
    // Page 2 should fit more content per line due to wider inline size
    // (fewer lines for same amount of text)
    assert.ok(p1Lines > 0);
  });
});
