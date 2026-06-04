import { computeSmsSegments, estimateSmsCostBdt } from "./smsCost";

describe("smsCost", () => {
  beforeEach(() => {
    process.env.SMS_CHARS_PER_SEGMENT = "160";
    process.env.SMS_COST_PER_SEGMENT_BDT = "0.25";
  });

  it("computes single segment for short OTP message", () => {
    const msg = "Your BPA vaccination code: 123456. Valid for 5 minutes.";
    expect(computeSmsSegments(msg)).toBe(1);
    expect(estimateSmsCostBdt(msg).estimatedCostBdt).toBe(0.25);
  });

  it("computes multiple segments for long campaign SMS", () => {
    const msg = "x".repeat(161);
    expect(computeSmsSegments(msg)).toBe(2);
    expect(estimateSmsCostBdt(msg).estimatedCostBdt).toBe(0.5);
  });
});
