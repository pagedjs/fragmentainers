import { describe, it, expect } from "vitest";
import { resolveColumnDimensions } from "../src/layout/multicol-container.js";

describe("resolveColumnDimensions", () => {
  it("both auto → single column at full width", () => {
    const { count, width } = resolveColumnDimensions(600, null, null, 0);
    expect(count).toBe(1);
    expect(width).toBe(600);
  });

  it("column-count only, no gap", () => {
    const { count, width } = resolveColumnDimensions(600, null, 3, 0);
    expect(count).toBe(3);
    expect(width).toBe(200);
  });

  it("column-count only, with gap", () => {
    const { count, width } = resolveColumnDimensions(620, null, 3, 10);
    expect(count).toBe(3);
    expect(width).toBe(200); // (620 - 2*10) / 3
  });

  it("column-width only — width is a minimum", () => {
    // 600px container, 150px min width, 0 gap → 4 columns of 150px
    const { count, width } = resolveColumnDimensions(600, 150, null, 0);
    expect(count).toBe(4);
    expect(width).toBe(150);
  });

  it("column-width only — columns expand to fill space", () => {
    // 500px container, 150px min width, 0 gap → 3 cols of 166.67px
    const { count, width } = resolveColumnDimensions(500, 150, null, 0);
    expect(count).toBe(3);
    expect(Math.abs(width - 500 / 3) < 0.01).toBeTruthy();
  });

  it("column-width only, with gap", () => {
    // 640px container, 150px min width, 10px gap
    // N = floor((640+10)/(150+10)) = floor(650/160) = 4
    // W = (640 - 3*10) / 4 = 610/4 = 152.5
    const { count, width } = resolveColumnDimensions(640, 150, null, 10);
    expect(count).toBe(4);
    expect(width).toBe(152.5);
  });

  it("both specified — column-count caps the number", () => {
    // 600px, 100px min width, count=3, 0 gap
    // Without cap: floor((600+0)/(100+0)) = 6 columns
    // Capped to 3: W = 600/3 = 200
    const { count, width } = resolveColumnDimensions(600, 100, 3, 0);
    expect(count).toBe(3);
    expect(width).toBe(200);
  });

  it("both specified — count not reached when width too large", () => {
    // 600px, 250px min width, count=4, 0 gap
    // N = min(4, floor(600/250)) = min(4, 2) = 2
    const { count, width } = resolveColumnDimensions(600, 250, 4, 0);
    expect(count).toBe(2);
    expect(width).toBe(300);
  });

  it("both specified with gap", () => {
    // 630px, 150px min width, count=3, 10px gap
    // N = min(3, floor(640/160)) = min(3, 4) = 3
    // W = (630 - 2*10) / 3 = 610/3 ≈ 203.33
    const { count, width } = resolveColumnDimensions(630, 150, 3, 10);
    expect(count).toBe(3);
    expect(Math.abs(width - 610 / 3) < 0.01).toBeTruthy();
  });

  it("minimum 1 column", () => {
    // Container narrower than column-width
    const { count, width } = resolveColumnDimensions(100, 200, null, 0);
    expect(count).toBe(1);
    expect(width).toBe(100);
  });

  it("zero container width", () => {
    const { count, width } = resolveColumnDimensions(0, null, 3, 0);
    expect(count).toBe(3);
    expect(width).toBe(0);
  });
});
