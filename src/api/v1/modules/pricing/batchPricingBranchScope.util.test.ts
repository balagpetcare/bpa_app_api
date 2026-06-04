import { batchPricingRuleAppliesToBranch } from "./batchPricingBranchScope.util";

describe("batchPricingRuleAppliesToBranch", () => {
  it("allows org-wide rules", () => {
    expect(batchPricingRuleAppliesToBranch(null, 12)).toBe(true);
    expect(batchPricingRuleAppliesToBranch(undefined, 12)).toBe(true);
  });
  it("matches branch-scoped rules", () => {
    expect(batchPricingRuleAppliesToBranch(5, 5)).toBe(true);
    expect(batchPricingRuleAppliesToBranch(5, 99)).toBe(false);
  });
});
