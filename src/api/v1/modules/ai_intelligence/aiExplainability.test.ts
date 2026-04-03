import { clamp, linearRegressionSlope } from "./aiExplainability";

describe("aiExplainability", () => {
  it("clamps values", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it("linear regression slope for simple line y=2x", () => {
    const xs = [0, 1, 2];
    const ys = [0, 2, 4];
    expect(linearRegressionSlope(xs, ys)).toBeCloseTo(2, 5);
  });
});
