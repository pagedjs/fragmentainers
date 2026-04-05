import { test, expect } from "../browser-fixture.js";

test.describe("resolveColumnDimensions", () => {
  test("both auto → single column at full width", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { resolveColumnDimensions } = await import("/src/layout/multicol-container.js");
      return resolveColumnDimensions(600, null, null, 0);
    });
    expect(result.count).toBe(1);
    expect(result.width).toBe(600);
  });

  test("column-count only, no gap", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { resolveColumnDimensions } = await import("/src/layout/multicol-container.js");
      return resolveColumnDimensions(600, null, 3, 0);
    });
    expect(result.count).toBe(3);
    expect(result.width).toBe(200);
  });

  test("column-count only, with gap", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { resolveColumnDimensions } = await import("/src/layout/multicol-container.js");
      return resolveColumnDimensions(620, null, 3, 10);
    });
    expect(result.count).toBe(3);
    expect(result.width).toBe(200);
  });

  test("column-width only — width is a minimum", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { resolveColumnDimensions } = await import("/src/layout/multicol-container.js");
      return resolveColumnDimensions(600, 150, null, 0);
    });
    expect(result.count).toBe(4);
    expect(result.width).toBe(150);
  });

  test("column-width only — columns expand to fill space", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { resolveColumnDimensions } = await import("/src/layout/multicol-container.js");
      return resolveColumnDimensions(500, 150, null, 0);
    });
    expect(result.count).toBe(3);
    expect(Math.abs(result.width - 500 / 3) < 0.01).toBeTruthy();
  });

  test("column-width only, with gap", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { resolveColumnDimensions } = await import("/src/layout/multicol-container.js");
      return resolveColumnDimensions(640, 150, null, 10);
    });
    expect(result.count).toBe(4);
    expect(result.width).toBe(152.5);
  });

  test("both specified — column-count caps the number", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { resolveColumnDimensions } = await import("/src/layout/multicol-container.js");
      return resolveColumnDimensions(600, 100, 3, 0);
    });
    expect(result.count).toBe(3);
    expect(result.width).toBe(200);
  });

  test("both specified — count not reached when width too large", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { resolveColumnDimensions } = await import("/src/layout/multicol-container.js");
      return resolveColumnDimensions(600, 250, 4, 0);
    });
    expect(result.count).toBe(2);
    expect(result.width).toBe(300);
  });

  test("both specified with gap", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { resolveColumnDimensions } = await import("/src/layout/multicol-container.js");
      return resolveColumnDimensions(630, 150, 3, 10);
    });
    expect(result.count).toBe(3);
    expect(Math.abs(result.width - 610 / 3) < 0.01).toBeTruthy();
  });

  test("minimum 1 column", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { resolveColumnDimensions } = await import("/src/layout/multicol-container.js");
      return resolveColumnDimensions(100, 200, null, 0);
    });
    expect(result.count).toBe(1);
    expect(result.width).toBe(100);
  });

  test("zero container width", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { resolveColumnDimensions } = await import("/src/layout/multicol-container.js");
      return resolveColumnDimensions(0, null, 3, 0);
    });
    expect(result.count).toBe(3);
    expect(result.width).toBe(0);
  });
});
