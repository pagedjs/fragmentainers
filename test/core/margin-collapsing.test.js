import { test, expect } from "../browser-fixture.js";

test.describe("MarginStrut", () => {
	test("resolves all-positive margins to max", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginStrut } = await import("/src/layout/margin-collapsing.js");
			const s = new MarginStrut();
			s.append(10);
			s.append(20);
			s.append(5);
			return s.resolve();
		});
		expect(result).toBe(20);
	});

	test("resolves all-negative margins to min (most negative)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginStrut } = await import("/src/layout/margin-collapsing.js");
			const s = new MarginStrut();
			s.append(-5);
			s.append(-10);
			s.append(-3);
			return s.resolve();
		});
		expect(result).toBe(-10);
	});

	test("resolves mixed margins to max(positive) + min(negative)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginStrut } = await import("/src/layout/margin-collapsing.js");
			const s = new MarginStrut();
			s.append(15);
			s.append(-3);
			s.append(10);
			s.append(-7);
			return s.resolve();
		});
		expect(result).toBe(8); // 15 + (-7)
	});

	test("resolves to 0 when no margins appended", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginStrut } = await import("/src/layout/margin-collapsing.js");
			return new MarginStrut().resolve();
		});
		expect(result).toBe(0);
	});

	test("ignores zero margins", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginStrut } = await import("/src/layout/margin-collapsing.js");
			const s = new MarginStrut();
			s.append(0);
			s.append(10);
			s.append(0);
			return s.resolve();
		});
		expect(result).toBe(10);
	});
});

test.describe("collapseMargins", () => {
	test("returns max for positive pair", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collapseMargins } = await import("/src/layout/margin-collapsing.js");
			return collapseMargins(10, 20);
		});
		expect(result).toBe(20);
	});

	test("returns min for negative pair", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collapseMargins } = await import("/src/layout/margin-collapsing.js");
			return collapseMargins(-5, -10);
		});
		expect(result).toBe(-10);
	});

	test("returns sum for mixed pair", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collapseMargins } = await import("/src/layout/margin-collapsing.js");
			return collapseMargins(10, -5);
		});
		expect(result).toBe(5);
	});

	test("handles zero with positive", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collapseMargins } = await import("/src/layout/margin-collapsing.js");
			return collapseMargins(0, 15);
		});
		expect(result).toBe(15);
	});

	test("handles zero with negative", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collapseMargins } = await import("/src/layout/margin-collapsing.js");
			return collapseMargins(0, -8);
		});
		expect(result).toBe(-8);
	});

	test("handles both zero", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collapseMargins } = await import("/src/layout/margin-collapsing.js");
			return collapseMargins(0, 0);
		});
		expect(result).toBe(0);
	});
});

test.describe("collectThroughMargins", () => {
	test("returns empty when child has border-block-start", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectThroughMargins } = await import("/src/layout/margin-collapsing.js");
			const child = {
				paddingBlockStart: 0,
				borderBlockStart: 5,
				children: [{ marginBlockStart: 20 }],
			};
			return collectThroughMargins(child);
		});
		expect(result).toEqual([]);
	});

	test("returns empty when child has padding-block-start", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectThroughMargins } = await import("/src/layout/margin-collapsing.js");
			const child = {
				paddingBlockStart: 10,
				borderBlockStart: 0,
				children: [{ marginBlockStart: 20 }],
			};
			return collectThroughMargins(child);
		});
		expect(result).toEqual([]);
	});

	test("returns empty when child has no children", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectThroughMargins } = await import("/src/layout/margin-collapsing.js");
			const child = {
				paddingBlockStart: 0,
				borderBlockStart: 0,
				children: [],
			};
			return collectThroughMargins(child);
		});
		expect(result).toEqual([]);
	});

	test("collects 1-level through-collapse", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectThroughMargins } = await import("/src/layout/margin-collapsing.js");
			const grandchild = {
				marginBlockStart: 30,
				paddingBlockStart: 5, // has padding — stops walk
				borderBlockStart: 0,
				children: [],
			};
			const child = {
				paddingBlockStart: 0,
				borderBlockStart: 0,
				children: [grandchild],
			};
			return collectThroughMargins(child);
		});
		expect(result).toEqual([30]);
	});

	test("collects multi-level through-collapse", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectThroughMargins } = await import("/src/layout/margin-collapsing.js");
			const greatGrandchild = {
				marginBlockStart: 30,
				paddingBlockStart: 1, // stops walk
				borderBlockStart: 0,
				children: [],
			};
			const grandchild = {
				marginBlockStart: 20,
				paddingBlockStart: 0,
				borderBlockStart: 0,
				children: [greatGrandchild],
			};
			const child = {
				paddingBlockStart: 0,
				borderBlockStart: 0,
				children: [grandchild],
			};
			return collectThroughMargins(child);
		});
		expect(result).toEqual([20, 30]);
	});

	test("skips zero margins in chain", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectThroughMargins } = await import("/src/layout/margin-collapsing.js");
			const greatGrandchild = {
				marginBlockStart: 25,
				paddingBlockStart: 1,
				borderBlockStart: 0,
				children: [],
			};
			const grandchild = {
				marginBlockStart: 0, // zero — skipped
				paddingBlockStart: 0,
				borderBlockStart: 0,
				children: [greatGrandchild],
			};
			const child = {
				paddingBlockStart: 0,
				borderBlockStart: 0,
				children: [grandchild],
			};
			return collectThroughMargins(child);
		});
		expect(result).toEqual([25]);
	});

	test("collects negative through-margins", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectThroughMargins } = await import("/src/layout/margin-collapsing.js");
			const grandchild = {
				marginBlockStart: -10,
				paddingBlockStart: 1,
				borderBlockStart: 0,
				children: [],
			};
			const child = {
				paddingBlockStart: 0,
				borderBlockStart: 0,
				children: [grandchild],
			};
			return collectThroughMargins(child);
		});
		expect(result).toEqual([-10]);
	});
});

test.describe("MarginState", () => {
	test("first child margin on first fragment", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			const child = {
				marginBlockStart: 15,
				marginBlockEnd: 10,
				paddingBlockStart: 5,
				borderBlockStart: 0,
				children: [],
			};
			return margins.computeMarginBefore(child, {
				isFirstInLoop: true,
				isFirstFragment: true,
				atFragmentainerTop: false,
			});
		});
		expect(result.marginDelta).toBe(15);
		expect(result.collapsedThrough).toBe(0);
	});

	test("preserves first child margin at fragmentainer top on first fragment", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			const child = {
				marginBlockStart: 15,
				marginBlockEnd: 0,
				paddingBlockStart: 5, // has padding — no through-collapse
				borderBlockStart: 0,
				children: [],
			};
			return margins.computeMarginBefore(child, {
				isFirstInLoop: true,
				isFirstFragment: true,
				atFragmentainerTop: true,
			});
		});
		// Browser renders the collapsed margin inside the fragmentainer,
		// so the engine must account for it on the first fragment.
		expect(result.marginDelta).toBe(15);
	});

	test("does not truncate at fragmentainer top when through-collapse is active", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			const grandchild = {
				marginBlockStart: 20,
				paddingBlockStart: 1,
				borderBlockStart: 0,
				children: [],
			};
			const child = {
				marginBlockStart: 10,
				marginBlockEnd: 0,
				paddingBlockStart: 0,
				borderBlockStart: 0,
				children: [grandchild],
			};
			return margins.computeMarginBefore(child, {
				isFirstInLoop: true,
				isFirstFragment: true,
				atFragmentainerTop: true,
			});
		});
		// Through-collapse active — margin is NOT truncated
		expect(result.marginDelta).toBe(20); // max(10, 20)
		expect(result.collapsedThrough).toBe(20);
	});

	test("sibling collapse uses strut resolution", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			// First child — sets prevMarginEnd
			const child1 = {
				marginBlockStart: 10,
				marginBlockEnd: 25,
				paddingBlockStart: 5,
				borderBlockStart: 0,
				children: [],
			};
			margins.computeMarginBefore(child1, {
				isFirstInLoop: true,
				isFirstFragment: true,
				atFragmentainerTop: false,
			});
			margins.applyAfterLayout(child1, 0, false);

			// Second child — collapses with first child's margin-end
			const child2 = {
				marginBlockStart: 15,
				marginBlockEnd: 0,
				paddingBlockStart: 5,
				borderBlockStart: 0,
				children: [],
			};
			return margins.computeMarginBefore(child2, {
				isFirstInLoop: false,
				isFirstFragment: true,
				atFragmentainerTop: false,
			});
		});
		expect(result.marginDelta).toBe(25); // max(15, 25)
	});

	test("sibling collapse with negative margins", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			const child1 = {
				marginBlockStart: 10,
				marginBlockEnd: 20,
				paddingBlockStart: 5,
				borderBlockStart: 0,
				children: [],
			};
			margins.computeMarginBefore(child1, {
				isFirstInLoop: true,
				isFirstFragment: true,
				atFragmentainerTop: false,
			});
			margins.applyAfterLayout(child1, 0, false);

			// Negative margin on second child
			const child2 = {
				marginBlockStart: -5,
				marginBlockEnd: 0,
				paddingBlockStart: 5,
				borderBlockStart: 0,
				children: [],
			};
			return margins.computeMarginBefore(child2, {
				isFirstInLoop: false,
				isFirstFragment: true,
				atFragmentainerTop: false,
			});
		});
		expect(result.marginDelta).toBe(15); // max(20) + min(-5) = 20 + (-5) = 15
	});

	test("multi-level through-collapse returns correct collapsedThrough", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			const greatGrandchild = {
				marginBlockStart: 30,
				paddingBlockStart: 1,
				borderBlockStart: 0,
				children: [],
			};
			const grandchild = {
				marginBlockStart: 20,
				paddingBlockStart: 0,
				borderBlockStart: 0,
				children: [greatGrandchild],
			};
			const child = {
				marginBlockStart: 10,
				marginBlockEnd: 0,
				paddingBlockStart: 0,
				borderBlockStart: 0,
				children: [grandchild],
			};
			return margins.computeMarginBefore(child, {
				isFirstInLoop: true,
				isFirstFragment: true,
				atFragmentainerTop: false,
			});
		});
		// max(10, 20, 30) = 30
		expect(result.marginDelta).toBe(30);
		// Through strut = max(20, 30) = 30 (what child's layout will add)
		expect(result.collapsedThrough).toBe(30);
	});

	test("multi-level through-collapse with negative margins", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			const greatGrandchild = {
				marginBlockStart: 25,
				paddingBlockStart: 1,
				borderBlockStart: 0,
				children: [],
			};
			const grandchild = {
				marginBlockStart: -3,
				paddingBlockStart: 0,
				borderBlockStart: 0,
				children: [greatGrandchild],
			};
			const child = {
				marginBlockStart: 10,
				marginBlockEnd: 0,
				paddingBlockStart: 0,
				borderBlockStart: 0,
				children: [grandchild],
			};
			return margins.computeMarginBefore(child, {
				isFirstInLoop: true,
				isFirstFragment: true,
				atFragmentainerTop: false,
			});
		});
		// strut(10, -3, 25).resolve() = max(10, 25) + min(-3) = 22
		expect(result.marginDelta).toBe(22);
		// Through strut = strut(-3, 25).resolve() = 25 + (-3) = 22
		expect(result.collapsedThrough).toBe(22);
	});

	test("collapseAdjustment returns collapsedThrough when not resuming", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			return {
				withThrough: margins.collapseAdjustment(30, false),
				whenResuming: margins.collapseAdjustment(30, true),
				withoutThrough: margins.collapseAdjustment(0, false),
			};
		});
		expect(result.withThrough).toBe(30);
		expect(result.whenResuming).toBe(0);
		expect(result.withoutThrough).toBe(0);
	});

	test("applyAfterLayout returns subtraction and updates state", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			const child = { marginBlockStart: 10, marginBlockEnd: 20, paddingBlockStart: 5, borderBlockStart: 0, children: [] };

			const subtraction = margins.applyAfterLayout(child, 15, false);
			// Now prevMarginEnd should be 20. Check via trailing margin.
			const trailing = margins.trailingMargin(false, true);
			return { subtraction, trailing };
		});
		expect(result.subtraction).toBe(15);
		expect(result.trailing).toBe(20);
	});

	test("applyAfterLayout returns 0 when resuming", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			const child = { marginBlockStart: 10, marginBlockEnd: 20, paddingBlockStart: 5, borderBlockStart: 0, children: [] };
			return margins.applyAfterLayout(child, 15, true);
		});
		expect(result).toBe(0);
	});

	test("trailingMargin returns 0 when break follows", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			const child = { marginBlockStart: 0, marginBlockEnd: 20, paddingBlockStart: 5, borderBlockStart: 0, children: [] };
			margins.applyAfterLayout(child, 0, false);
			return margins.trailingMargin(true, true);
		});
		expect(result).toBe(0);
	});

	test("shouldTruncateChildMarginStart", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			return {
				// Truncate: first child, has break token, positive margin, not forced
				truncate: margins.shouldTruncateChildMarginStart({
					isFirstChild: true, hasBreakToken: true, childMarginBefore: 10, isForcedBreak: false,
				}),
				// Don't truncate: not first child
				notFirst: margins.shouldTruncateChildMarginStart({
					isFirstChild: false, hasBreakToken: true, childMarginBefore: 10, isForcedBreak: false,
				}),
				// Don't truncate: no break token (first fragment)
				noToken: margins.shouldTruncateChildMarginStart({
					isFirstChild: true, hasBreakToken: false, childMarginBefore: 10, isForcedBreak: false,
				}),
				// Don't truncate: forced break (margin preserved)
				forced: margins.shouldTruncateChildMarginStart({
					isFirstChild: true, hasBreakToken: true, childMarginBefore: 10, isForcedBreak: true,
				}),
				// Don't truncate: zero margin
				zeroMargin: margins.shouldTruncateChildMarginStart({
					isFirstChild: true, hasBreakToken: true, childMarginBefore: 0, isForcedBreak: false,
				}),
			};
		});
		expect(result.truncate).toBe(true);
		expect(result.notFirst).toBe(false);
		expect(result.noToken).toBe(false);
		expect(result.forced).toBe(false);
		expect(result.zeroMargin).toBe(false);
	});

	test("shouldTruncateLastChildMarginEnd", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			const child = { marginBlockStart: 0, marginBlockEnd: 15, paddingBlockStart: 5, borderBlockStart: 0, children: [] };
			margins.applyAfterLayout(child, 0, false);
			return {
				withBreak: margins.shouldTruncateLastChildMarginEnd(true),
				withoutBreak: margins.shouldTruncateLastChildMarginEnd(false),
			};
		});
		expect(result.withBreak).toBe(true);
		expect(result.withoutBreak).toBe(false);
	});

	test("body margin collapses with first child — child margin larger", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState(8); // body margin 8px
			const child = {
				marginBlockStart: 16,
				marginBlockEnd: 0,
				paddingBlockStart: 5,
				borderBlockStart: 0,
				children: [],
			};
			return margins.computeMarginBefore(child, {
				isFirstInLoop: true,
				isFirstFragment: true,
				atFragmentainerTop: false,
			});
		});
		// max(8, 16) = 16 — child margin absorbs body margin
		expect(result.marginDelta).toBe(16);
	});

	test("body margin collapses with first child — body margin larger", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState(8);
			const child = {
				marginBlockStart: 0,
				marginBlockEnd: 0,
				paddingBlockStart: 5,
				borderBlockStart: 0,
				children: [],
			};
			return margins.computeMarginBefore(child, {
				isFirstInLoop: true,
				isFirstFragment: true,
				atFragmentainerTop: false,
			});
		});
		// max(8, 0) = 8 — body margin adds 8px
		expect(result.marginDelta).toBe(8);
	});

	test("body margin prevents truncation at fragmentainer top", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState(8);
			const child = {
				marginBlockStart: 5,
				marginBlockEnd: 0,
				paddingBlockStart: 5,
				borderBlockStart: 0,
				children: [],
			};
			return margins.computeMarginBefore(child, {
				isFirstInLoop: true,
				isFirstFragment: true,
				atFragmentainerTop: true,
			});
		});
		// Body margin prevents truncation. max(8, 5) = 8
		expect(result.marginDelta).toBe(8);
	});

	test("no body margin — margin at fragmentainer top preserved on first fragment", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState(0);
			const child = {
				marginBlockStart: 15,
				marginBlockEnd: 0,
				paddingBlockStart: 5,
				borderBlockStart: 0,
				children: [],
			};
			return margins.computeMarginBefore(child, {
				isFirstInLoop: true,
				isFirstFragment: true,
				atFragmentainerTop: true,
			});
		});
		// Browser renders this margin, so the engine preserves it.
		expect(result.marginDelta).toBe(15);
	});

	test("body margin not applied on non-first pages", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState(8);
			const child = {
				marginBlockStart: 0,
				marginBlockEnd: 0,
				paddingBlockStart: 5,
				borderBlockStart: 0,
				children: [],
			};
			return margins.computeMarginBefore(child, {
				isFirstInLoop: true,
				isFirstFragment: false,
				atFragmentainerTop: false,
			});
		});
		// Continuation first child — margin stays 0 regardless of body margin
		expect(result.marginDelta).toBe(0);
	});

	test("preserves margin after forced break (Class A)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			const child = {
				marginBlockStart: 12,
				marginBlockEnd: 0,
				paddingBlockStart: 5,
				borderBlockStart: 0,
				children: [],
			};
			return margins.computeMarginBefore(child, {
				isFirstInLoop: true,
				isFirstFragment: false,
				atFragmentainerTop: true,
				isForcedBreak: true,
			});
		});
		// CSS Frag L3 §5.2: margins adjoining forced breaks are preserved.
		expect(result.marginDelta).toBe(12);
	});

	test("preserves through-collapsed margin after forced break", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			// p.left (margin 12) inside section (margin 0) continuing on a new
			// page after break-before:page. Section has no border/padding →
			// p.left's 12px bubbles up through section.
			const pLeft = {
				marginBlockStart: 12,
				paddingBlockStart: 5,
				borderBlockStart: 0,
				children: [],
			};
			const section = {
				marginBlockStart: 0,
				marginBlockEnd: 0,
				paddingBlockStart: 0,
				borderBlockStart: 0,
				children: [pLeft],
			};
			return margins.computeMarginBefore(section, {
				isFirstInLoop: true,
				isFirstFragment: false,
				atFragmentainerTop: true,
				isForcedBreak: true,
			});
		});
		expect(result.marginDelta).toBe(12);
		expect(result.collapsedThrough).toBe(12);
	});

	test("still truncates margin after unforced break", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			const child = {
				marginBlockStart: 12,
				marginBlockEnd: 0,
				paddingBlockStart: 5,
				borderBlockStart: 0,
				children: [],
			};
			return margins.computeMarginBefore(child, {
				isFirstInLoop: true,
				isFirstFragment: false,
				atFragmentainerTop: true,
				isForcedBreak: false,
			});
		});
		// Class C break → margin truncated
		expect(result.marginDelta).toBe(0);
	});

	test("shouldTruncateLastChildMarginEnd skips truncation for forced breaks", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			const child = {
				marginBlockStart: 0,
				marginBlockEnd: 15,
				paddingBlockStart: 5,
				borderBlockStart: 0,
				children: [],
			};
			margins.applyAfterLayout(child, 0, false);
			return {
				unforced: margins.shouldTruncateLastChildMarginEnd(true, false),
				forced: margins.shouldTruncateLastChildMarginEnd(true, true),
			};
		});
		expect(result.unforced).toBe(true);
		expect(result.forced).toBe(false);
	});

	test("trailingMargin preserves margin before forced break", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			const child = {
				marginBlockStart: 0,
				marginBlockEnd: 20,
				paddingBlockStart: 5,
				borderBlockStart: 0,
				children: [],
			};
			margins.applyAfterLayout(child, 0, false);
			return {
				unforced: margins.trailingMargin(true, true, false),
				forcedPreserved: margins.trailingMargin(true, true, true),
			};
		});
		expect(result.unforced).toBe(0);
		expect(result.forcedPreserved).toBe(20);
	});

	// LAY-3: end-side collapse folds own + through end margins as a collapsing
	// set (max positives + min negatives), not a bare max.
	test("applyAfterLayout folds own+through end margins as a collapsing set (negative)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			const childA = { marginBlockStart: 0, marginBlockEnd: -10, paddingBlockStart: 0, borderBlockStart: 0, collapsedMarginBlockEnd: 0, children: [] };
			margins.computeMarginBefore(childA, { isFirstInLoop: true, isFirstFragment: true });
			margins.applyAfterLayout(childA, 0, false, false);
			const childB = { marginBlockStart: 5, marginBlockEnd: 0, paddingBlockStart: 0, borderBlockStart: 0, collapsedMarginBlockEnd: 0, children: [] };
			return margins.computeMarginBefore(childB, { isFirstInLoop: false, isFirstFragment: true });
		});
		// collapse({-10},{5}) = max(5) + min(-10) = -5
		expect(result.marginDelta).toBe(-5);
	});

	test("applyAfterLayout backs out a negative through end margin (sign-agnostic)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			const child = {
				marginBlockStart: 0, marginBlockEnd: 0,
				paddingBlockStart: 0, borderBlockStart: 0,
				collapsedMarginBlockEnd: -8,
				children: [],
			};
			const subtract = margins.applyAfterLayout(child, 0, false, false);
			const trailing = margins.trailingMargin(false, true);
			return { subtract, trailing };
		});
		// throughMarginEnd = -8 → compensation subtract = -8 (caller does
		// blockOffset -= subtract, i.e. ADDS 8 back, removing the double count).
		expect(result.subtract).toBe(-8);
		expect(result.trailing).toBe(-8);
	});
});

test.describe("collectThroughMargins — BFC + out-of-flow (LAY-5)", () => {
	test("returns [] when the node itself establishes a BFC", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectThroughMargins } = await import("/src/layout/margin-collapsing.js");
			const grandchild = { marginBlockStart: 30, paddingBlockStart: 0, borderBlockStart: 0, children: [] };
			const node = {
				paddingBlockStart: 0, borderBlockStart: 0,
				establishesBlockFormattingContext: true,
				children: [grandchild],
			};
			return collectThroughMargins(node);
		});
		// flow-root / overflow:hidden node — descendants' margins stay contained.
		expect(result).toEqual([]);
	});

	test("collects a BFC first child's own margin but does not descend into it", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectThroughMargins } = await import("/src/layout/margin-collapsing.js");
			const grandchild = { marginBlockStart: 30, paddingBlockStart: 0, borderBlockStart: 0, children: [] };
			const bfcChild = {
				marginBlockStart: 12, paddingBlockStart: 0, borderBlockStart: 0,
				establishesBlockFormattingContext: true, isOutOfFlow: false,
				children: [grandchild],
			};
			const node = { paddingBlockStart: 0, borderBlockStart: 0, establishesBlockFormattingContext: false, children: [bfcChild] };
			return collectThroughMargins(node);
		});
		// bfcChild's own 12 collapses up; the inner 30 stays inside the BFC.
		expect(result).toEqual([12]);
	});

	test("skips an out-of-flow first child", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectThroughMargins } = await import("/src/layout/margin-collapsing.js");
			const abspos = { marginBlockStart: 50, paddingBlockStart: 0, borderBlockStart: 0, isOutOfFlow: true, children: [] };
			const inflow = { marginBlockStart: 10, paddingBlockStart: 5, borderBlockStart: 0, isOutOfFlow: false, children: [] };
			const node = { paddingBlockStart: 0, borderBlockStart: 0, children: [abspos, inflow] };
			return collectThroughMargins(node);
		});
		expect(result).toEqual([10]);
	});
});

test.describe("collectThroughMarginEnd (LAY-5)", () => {
	test("recurses through last in-flow child chain (auto height)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectThroughMarginEnd } = await import("/src/layout/margin-collapsing.js");
			const inner = { marginBlockEnd: 25, paddingBlockEnd: 0, borderBlockEnd: 0, hasAutoBlockSize: true, hasMinBlockSize: false, children: [] };
			const mid = { marginBlockEnd: 0, paddingBlockEnd: 0, borderBlockEnd: 0, hasAutoBlockSize: true, hasMinBlockSize: false, children: [inner] };
			const outer = { marginBlockEnd: 0, paddingBlockEnd: 0, borderBlockEnd: 0, hasAutoBlockSize: true, hasMinBlockSize: false, children: [mid] };
			return collectThroughMarginEnd(outer);
		});
		expect(result).toBe(25);
	});

	test("stops when the parent has a fixed block-size", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectThroughMarginEnd } = await import("/src/layout/margin-collapsing.js");
			const last = { marginBlockEnd: 40, paddingBlockEnd: 0, borderBlockEnd: 0, hasAutoBlockSize: true, hasMinBlockSize: false, children: [] };
			const outer = { marginBlockEnd: 0, paddingBlockEnd: 0, borderBlockEnd: 0, hasAutoBlockSize: false, hasMinBlockSize: false, children: [last] };
			return collectThroughMarginEnd(outer);
		});
		expect(result).toBe(0);
	});

	test("stops when the parent has a non-zero min-block-size", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectThroughMarginEnd } = await import("/src/layout/margin-collapsing.js");
			const last = { marginBlockEnd: 40, paddingBlockEnd: 0, borderBlockEnd: 0, hasAutoBlockSize: true, hasMinBlockSize: false, children: [] };
			const outer = { marginBlockEnd: 0, paddingBlockEnd: 0, borderBlockEnd: 0, hasAutoBlockSize: true, hasMinBlockSize: true, children: [last] };
			return collectThroughMarginEnd(outer);
		});
		// min-height:200px parent → last child's bottom margin does not collapse out.
		expect(result).toBe(0);
	});

	test("collects a BFC last child's own end margin but does not descend", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { collectThroughMarginEnd } = await import("/src/layout/margin-collapsing.js");
			const inner = { marginBlockEnd: 99, paddingBlockEnd: 0, borderBlockEnd: 0, hasAutoBlockSize: true, hasMinBlockSize: false, children: [] };
			const bfcLast = { marginBlockEnd: 35, paddingBlockEnd: 0, borderBlockEnd: 0, hasAutoBlockSize: true, hasMinBlockSize: false, establishesBlockFormattingContext: true, children: [inner] };
			const outer = { marginBlockEnd: 0, paddingBlockEnd: 0, borderBlockEnd: 0, hasAutoBlockSize: true, hasMinBlockSize: false, children: [bfcLast] };
			return collectThroughMarginEnd(outer);
		});
		// bfcLast's own 35 collapses up; the inner 99 stays inside the BFC.
		expect(result).toBe(35);
	});

	test("end-side recursion through real DOM: last child's bottom margin hoists", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:200px";
			container.innerHTML = "<div id=\"outer\" style=\"margin:0;padding:0\"><div id=\"mid\" style=\"margin:0;padding:0\"><div id=\"inner\" style=\"height:20px;margin:0 0 25px 0;padding:0\"></div></div></div>";
			document.body.appendChild(container);
			const outer = new DOMLayoutNode(container.firstElementChild);
			const r = outer.collapsedMarginBlockEnd;
			container.remove();
			return r;
		});
		expect(result).toBe(25);
	});

	test("end-side recursion through real DOM: fixed-height parent does not collapse", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");
			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:200px";
			container.innerHTML = "<div id=\"outer\" style=\"height:200px;margin:0;padding:0\"><div id=\"last\" style=\"height:20px;margin:0 0 40px 0;padding:0\"></div></div>";
			document.body.appendChild(container);
			const outer = new DOMLayoutNode(container.firstElementChild);
			const r = outer.collapsedMarginBlockEnd;
			container.remove();
			return r;
		});
		expect(result).toBe(0);
	});
});

test.describe("MarginState — self-collapsing boxes (LAY-4)", () => {
	// Drive the block-container call sequence: previous sibling A, a
	// self-collapsing empty box E, then the next sibling B. Returns B's
	// marginDelta — the single collapsed gap that should result.
	async function selfCollapseGap(page, { aEnd, eStart, eEnd, bStart }) {
		return page.evaluate(async (args) => {
			const { MarginState } = await import("/src/layout/margin-collapsing.js");
			const margins = new MarginState();
			const leaf = (start, end) => ({
				marginBlockStart: start, marginBlockEnd: end,
				paddingBlockStart: 0, paddingBlockEnd: 0,
				borderBlockStart: 0, borderBlockEnd: 0,
				collapsedMarginBlockEnd: 0, children: [],
			});
			// Sibling A.
			const a = leaf(0, args.aEnd);
			margins.computeMarginBefore(a, { isFirstInLoop: true, isFirstFragment: true });
			margins.applyAfterLayout(a, 0, false, false);
			// Self-collapsing empty box E.
			const e = leaf(args.eStart, args.eEnd);
			const before = margins.computeMarginBefore(e, { isFirstInLoop: false, isFirstFragment: true });
			const backedOut = margins.applyAfterLayout(e, 0, false, false, {
				selfCollapsing: true,
				appliedMarginStart: before.marginDelta,
				consumedPrevMarginEnd: before.consumedPrevMarginEnd,
			});
			// Next sibling B.
			const b = leaf(args.bStart, 0);
			const bBefore = margins.computeMarginBefore(b, { isFirstInLoop: false, isFirstFragment: true });
			return { eMarginDelta: before.marginDelta, backedOut, bMarginDelta: bBefore.marginDelta };
		}, { aEnd, eStart, eEnd, bStart });
	}

	test("symmetric all-positive set collapses to a single gap", async ({ page }) => {
		const r = await selfCollapseGap(page, { aEnd: 20, eStart: 20, eEnd: 20, bStart: 20 });
		// {20,20,20,20} → one 20px gap. E advances 20 then backs it all out;
		// B then re-applies the single 20.
		expect(r.eMarginDelta).toBe(20);
		expect(r.backedOut).toBe(20);
		expect(r.bMarginDelta).toBe(20);
	});

	test("preserves the dominant neighbour margin (the case the naive fold dropped)", async ({ page }) => {
		const r = await selfCollapseGap(page, { aEnd: 50, eStart: 10, eEnd: 10, bStart: 10 });
		// Full set {50,10,10,10} → 50. The previous sibling's 50 must survive the
		// self-collapse fold; a naive collapse(0,e.start,e.end) would give 10.
		expect(r.bMarginDelta).toBe(50);
	});

	test("empty box between two paragraphs yields one collapsed gap (integration)", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/layout/layout-driver.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { DOMLayoutNode } = await import("/src/layout/layout-node.js");

			const container = document.createElement("div");
			container.style.cssText = "position:absolute;left:-9999px;width:200px";
			container.innerHTML = `<div style="margin:0;padding:0">
				<div id="p1" style="height:40px;margin:0 0 20px 0;padding:0"></div>
				<div id="e" style="margin:20px 0;padding:0"></div>
				<div id="p2" style="height:40px;margin:20px 0 0 0;padding:0"></div>
			</div>`;
			document.body.appendChild(container);

			const root = new DOMLayoutNode(container.firstElementChild);
			const pages = createFragments(
				root,
				new ConstraintSpace({
					availableInlineSize: 200,
					availableBlockSize: 1000,
					fragmentainerBlockSize: 1000,
					fragmentationType: "page",
				}),
			);
			const kids = pages[0].childFragments;
			const r = {
				pageCount: pages.length,
				p2BlockOffset: kids[kids.length - 1].blockOffset,
				containerBlockSize: pages[0].blockSize,
			};
			container.remove();
			return r;
		});
		expect(result.pageCount).toBe(1);
		// p1 height 40 + single 20px collapsed gap + e height 0 = 60
		expect(result.p2BlockOffset).toBe(60);
		// container = 40 + 20 + 0 + 40 = 100 (one collapsed gap, not two)
		expect(result.containerBlockSize).toBe(100);
	});
});
