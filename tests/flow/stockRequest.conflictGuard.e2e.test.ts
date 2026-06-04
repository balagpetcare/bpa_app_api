import {
  shouldBlockLegacyOwnerFulfillment,
  enterpriseAllocationOwnsRequestLifecycle,
} from "../../src/api/v1/services/stockRequestStatus.service";

describe("stockRequest.conflictGuard (legacy vs enterprise)", () => {
  beforeEach(() => {
    delete process.env.ALLOW_LEGACY_FULFILL_WITH_ALLOCATION_DRAFT;
  });

  it("shouldBlockLegacyOwnerFulfillment: blocks when DRAFT plan exists (default mode)", () => {
    expect(shouldBlockLegacyOwnerFulfillment({ status: "DRAFT" })).toBe(true);
    expect(shouldBlockLegacyOwnerFulfillment({ status: "CANCELLED" })).toBe(false);
    expect(shouldBlockLegacyOwnerFulfillment(null)).toBe(false);
  });

  it("shouldBlockLegacyOwnerFulfillment: narrow block when env escape hatch set", () => {
    process.env.ALLOW_LEGACY_FULFILL_WITH_ALLOCATION_DRAFT = "true";
    expect(shouldBlockLegacyOwnerFulfillment({ status: "DRAFT" })).toBe(false);
    expect(shouldBlockLegacyOwnerFulfillment({ status: "CONFIRMED" })).toBe(true);
  });

  it("enterpriseAllocationOwnsRequestLifecycle: CONFIRMED+ plans", () => {
    expect(enterpriseAllocationOwnsRequestLifecycle({ status: "CONFIRMED" })).toBe(true);
    expect(enterpriseAllocationOwnsRequestLifecycle({ status: "PICKED" })).toBe(true);
    expect(enterpriseAllocationOwnsRequestLifecycle({ status: "DRAFT" })).toBe(false);
  });
});
