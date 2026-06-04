jest.mock("../../src/infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: {},
}));

import {
  computeLineSummary,
  computeRequestSummary,
} from "../../src/api/v1/services/stockRequestQuantity.service";

describe("stockRequest.quantityDerivation", () => {
  const baseLine = {
    id: 1,
    variantId: 100,
    requestedQty: 10,
    fulfilledQty: 3,
    cancelledQty: 1,
    lineKind: "REQUESTED" as const,
    backorderStatus: "NONE",
  };

  it("computeLineSummary: remainingQty = requested - fulfilled - cancelled", () => {
    const s = computeLineSummary(baseLine, 5);
    expect(s.remainingQty).toBe(6);
    expect(s.canDispatchNow).toBe(true);
  });

  it("computeLineSummary: EXTRA line kind", () => {
    const s = computeLineSummary(
      { ...baseLine, lineKind: "EXTRA", requestedQty: 0, fulfilledQty: 2, cancelledQty: 0 },
      0
    );
    expect(s.lineStatus).toBe("EXTRA");
  });

  it("computeRequestSummary: aggregates requested lines", () => {
    const lines = [
      computeLineSummary(baseLine, 10),
      computeLineSummary(
        { ...baseLine, id: 2, variantId: 101, requestedQty: 5, fulfilledQty: 0, cancelledQty: 0 },
        5
      ),
    ];
    const r = computeRequestSummary(lines);
    expect(r.totalRemainingQty).toBe(6 + 5);
    expect(r.hasPendingDispatch).toBe(true);
  });

  it("computeLineSummary: fulfilled covers remaining → canDispatchNow false", () => {
    const s = computeLineSummary(
      { ...baseLine, fulfilledQty: 9, cancelledQty: 1 },
      100
    );
    expect(s.remainingQty).toBe(0);
    expect(s.canDispatchNow).toBe(false);
  });
});
