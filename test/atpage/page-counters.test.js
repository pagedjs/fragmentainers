import { test, expect } from "../browser-fixture.js";

test.describe("Page counters", () => {
	test("assigns canonical page and pages values only to paged flows", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { ConstraintSpace } = await import("/src/fragmentation/constraint-space.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			const root = () =>
				blockNode({
					children: Array.from({ length: 3 }, () => blockNode({ blockSize: 100 })),
				});
			const size = { inlineSize: 300, blockSize: 100 };
			const paged = createFragments(root(), new PageResolver([], size));
			const columns = createFragments(
				root(),
				new ConstraintSpace({
					availableInlineSize: 300,
					availableBlockSize: 100,
					fragmentainerBlockSize: 100,
					fragmentationType: "column",
				}),
			);
			return {
				paged: paged.map((fragment) => ({ page: fragment.page, pages: fragment.pages })),
				columns: columns.map((fragment) => ({ page: fragment.page, pages: fragment.pages })),
			};
		});

		expect(result.paged).toEqual([
			{ page: 1, pages: 3 },
			{ page: 2, pages: 3 },
			{ page: 3, pages: 3 },
		]);
		expect(result.columns).toEqual([
			{ page: null, pages: null },
			{ page: null, pages: null },
			{ page: null, pages: null },
		]);
	});

	test("uses the default increment only when counter-increment is absent", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			const size = { inlineSize: 300, blockSize: 100 };
			const values = (counterIncrement) => {
				const root = blockNode({
					children: Array.from({ length: 3 }, () => blockNode({ blockSize: 100 })),
				});
				const rules = counterIncrement === undefined ? [] : [{ counterIncrement }];
				return createFragments(root, new PageResolver(rules, size)).map(
					(fragment) => fragment.page,
				);
			};
			return {
				absent: values(undefined),
				two: values("page 2"),
				zero: values("page 0"),
				negative: values("page -1"),
				none: values("none"),
				otherCounter: values("chapter 2"),
			};
		});

		expect(result.absent).toEqual([1, 2, 3]);
		expect(result.two).toEqual([2, 4, 6]);
		expect(result.zero).toEqual([0, 0, 0]);
		expect(result.negative).toEqual([-1, -2, -3]);
		expect(result.none).toEqual([0, 0, 0]);
		expect(result.otherCounter).toEqual([0, 0, 0]);
	});

	test("applies page resets before increments and ignores pages directives", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			const root = blockNode({
				children: Array.from({ length: 3 }, () => blockNode({ blockSize: 100 })),
			});
			const resolver = new PageResolver(
				[
					{ counterIncrement: "page 2 pages 100" },
					{ pseudo: ["first"], counterReset: "page 4 pages 99" },
				],
				{ inlineSize: 300, blockSize: 100 },
			);
			return createFragments(root, resolver).map((fragment) => ({
				page: fragment.page,
				pages: fragment.pages,
			}));
		});

		expect(result).toEqual([
			{ page: 6, pages: 3 },
			{ page: 8, pages: 3 },
			{ page: 10, pages: 3 },
		]);
	});

	test("applies named-page resets to the matching page", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			const root = blockNode({
				children: [
					blockNode({ blockSize: 100, page: "front" }),
					blockNode({ blockSize: 100, page: "front" }),
					blockNode({ blockSize: 100, page: "body-start" }),
					blockNode({ blockSize: 100, page: "body" }),
				],
			});
			const resolver = new PageResolver(
				[
					{ counterIncrement: "page 1" },
					{ name: "body-start", counterReset: "page 0" },
				],
				{ inlineSize: 300, blockSize: 100 },
			);
			return createFragments(root, resolver).map((fragment) => ({
				name: fragment.constraints.namedPage,
				page: fragment.page,
			}));
		});

		expect(result).toEqual([
			{ name: "front", page: 1 },
			{ name: "front", page: 2 },
			{ name: "body-start", page: 1 },
			{ name: "body", page: 2 },
		]);
	});

	test("blank pages consume page increments", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			const root = blockNode({
				children: [
					blockNode({ blockSize: 50 }),
					blockNode({ blockSize: 50, breakBefore: "right" }),
				],
			});
			const fragments = createFragments(
				root,
				new PageResolver([], { inlineSize: 300, blockSize: 100 }),
			);
			return fragments.map((fragment) => ({
				blank: fragment.isBlank,
				page: fragment.page,
				pages: fragment.pages,
			}));
		});

		expect(result).toEqual([
			{ blank: false, page: 1, pages: 3 },
			{ blank: true, page: 2, pages: 3 },
			{ blank: false, page: 3, pages: 3 },
		]);
	});

	test("seeds continuation page values from the fragmentainer index", async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createFragments } = await import("/src/fragmentation/create-fragments.js");
			const { PageResolver } = await import("/src/resolvers/page-resolver.js");
			const { blockNode } = await import("/test/fixtures/nodes.js");
			const root = blockNode({
				children: [blockNode({ blockSize: 100 }), blockNode({ blockSize: 100 })],
			});
			const { fragments } = createFragments(
				root,
				new PageResolver([], { inlineSize: 300, blockSize: 100 }),
				{ fragmentainerIndex: 5, blockOffset: 0 },
			);
			return fragments.map((fragment) => ({ page: fragment.page, pages: fragment.pages }));
		});

		expect(result).toEqual([
			{ page: 6, pages: 7 },
			{ page: 7, pages: 7 },
		]);
	});
});
