import {
  deriveRequestStatus,
  canTransitionTo,
  isWarehouseActionable,
  isBranchInboundActionable,
  getWarehouseFulfillmentSegment,
  getStatusDisplay,
} from "../../src/api/v1/services/stockRequestStatus.service";

describe("stockRequest.statusDerivation", () => {
  it("deriveRequestStatus: CONFIRMED plan maps SUBMITTED to APPROVED for display", () => {
    const d = deriveRequestStatus(
      { status: "SUBMITTED" },
      { status: "CONFIRMED", totalAllocatedQty: 10, shortageQty: 0 },
      []
    );
    expect(d).toBe("APPROVED");
  });

  it("deriveRequestStatus: respects terminal CLOSED", () => {
    expect(
      deriveRequestStatus(
        { status: "CLOSED" },
        { status: "CONFIRMED", totalAllocatedQty: 1, shortageQty: 0 },
        []
      )
    ).toBe("CLOSED");
  });

  it("canTransitionTo: allows APPROVED from SUBMITTED when allocation confirmed", () => {
    const r = canTransitionTo("SUBMITTED", "APPROVED", {
      hasAllocationPlan: true,
      allocationPlanConfirmed: true,
    });
    expect(r.allowed).toBe(true);
  });

  it("canTransitionTo: blocks APPROVED without allocation confirmation context", () => {
    const r = canTransitionTo("SUBMITTED", "APPROVED", {});
    expect(r.allowed).toBe(false);
  });

  it("isWarehouseActionable: true when plan CONFIRMED", () => {
    expect(isWarehouseActionable({ status: "SUBMITTED" }, { status: "CONFIRMED" })).toBe(true);
  });

  it("isBranchInboundActionable: APPROVED with inbound context", () => {
    expect(isBranchInboundActionable({ status: "APPROVED" }, true)).toBe(true);
  });

  it("getWarehouseFulfillmentSegment: PROCUREMENT vs INTERNAL_TRANSFER", () => {
    expect(getWarehouseFulfillmentSegment({ requestIntent: "PROCUREMENT" })).toBe("PROCUREMENT");
    expect(getWarehouseFulfillmentSegment({ requestIntent: "INTERNAL_TRANSFER" })).toBe("INTERNAL_TRANSFER");
  });

  it("getStatusDisplay: APPROVED label Ready to Fulfill", () => {
    expect(getStatusDisplay("APPROVED").label).toMatch(/Fulfill/i);
  });
});
