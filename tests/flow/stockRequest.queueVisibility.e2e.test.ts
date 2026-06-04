/**
 * Regression: queue visibility rules without hitting DB (pure service predicates).
 */
import { listWarehouseFulfillmentQueue } from "../../src/api/v1/services/warehouseFulfillmentQueue.service";
import { isWarehouseActionable, isBranchInboundActionable } from "../../src/api/v1/services/stockRequestStatus.service";

jest.mock("../../src/infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: {},
}));

describe("stockRequest.queueVisibility", () => {
  it("isWarehouseActionable matches documented bridge states", () => {
    expect(isWarehouseActionable({ status: "APPROVED", requestIntent: "INTERNAL_TRANSFER" }, { status: "CONFIRMED" })).toBe(
      true
    );
    expect(isWarehouseActionable({ status: "OWNER_REVIEW", requestIntent: "PROCUREMENT" }, null)).toBe(true);
  });

  it("isBranchInboundActionable allows DISPATCHED with inbound", () => {
    expect(isBranchInboundActionable({ status: "DISPATCHED" }, true)).toBe(true);
  });

  it("listWarehouseFulfillmentQueue returns empty without orgIds", async () => {
    const rows = await listWarehouseFulfillmentQueue([]);
    expect(rows).toEqual([]);
  });
});
