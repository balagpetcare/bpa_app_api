import { shouldPosUseEnterpriseListPriceResolution } from "./posPricingPolicy.util";

describe("shouldPosUseEnterpriseListPriceResolution", () => {
  it("is true when POS governance is enabled", () => {
    expect(shouldPosUseEnterpriseListPriceResolution({ posPricingGovernanceEnabled: true, posUseEnterpriseListResolution: false })).toBe(
      true
    );
  });
  it("is true when opt-in enterprise list is enabled", () => {
    expect(shouldPosUseEnterpriseListPriceResolution({ posPricingGovernanceEnabled: false, posUseEnterpriseListResolution: true })).toBe(
      true
    );
  });
  it("is false when both are off", () => {
    expect(shouldPosUseEnterpriseListPriceResolution({ posPricingGovernanceEnabled: false, posUseEnterpriseListResolution: false })).toBe(
      false
    );
  });
});
