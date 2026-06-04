/**
 * Legacy StockTransfer / fulfill paths must not run when an allocation plan owns the stock request.
 */
jest.mock("../../src/infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: {
    stockRequest: { findUnique: jest.fn() },
    allocationPlan: { findUnique: jest.fn() },
    stockRequestItem: { findMany: jest.fn() },
    stockTransfer: { create: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../src/api/v1/modules/warehouse/warehouseAudit.service", () => ({
  logWarehouseAudit: jest.fn().mockResolvedValue(undefined),
}));

const prisma = require("../../src/infrastructure/db/prismaClient").default;
const { logWarehouseAudit } = require("../../src/api/v1/modules/warehouse/warehouseAudit.service");
const transfersService = require("../../src/api/v1/modules/transfers/transfers.service");
const {
  assertLegacyFulfillmentAllowedForStockRequest,
} = require("../../src/api/v1/services/legacyFulfillmentGuard.service");

describe("legacy fulfillment vs enterprise allocation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.DISABLE_LEGACY_STOCK_REQUEST_FULFILL;
    delete process.env.DISABLE_LEGACY_STOCK_TRANSFER;
    delete process.env.ALLOW_LEGACY_FULFILL_WITH_ALLOCATION_DRAFT;
  });

  it("assertLegacyFulfillmentAllowedForStockRequest blocks when a non-cancelled plan exists and audits", async () => {
    prisma.stockRequest.findUnique.mockResolvedValue({ orgId: 1 });
    prisma.allocationPlan.findUnique.mockResolvedValue({ status: "DRAFT" });

    await expect(
      assertLegacyFulfillmentAllowedForStockRequest(10, { source: "test", actorUserId: 7 })
    ).rejects.toThrow(/ALLOCATION_PLAN_BLOCKS_LEGACY/);

    expect(logWarehouseAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LEGACY_FULFILLMENT_BLOCKED",
        entityType: "StockRequest",
        entityId: "10",
        metadata: expect.objectContaining({
          reason: "ALLOCATION_PLAN",
          source: "test",
          planStatus: "DRAFT",
        }),
        actorUserId: 7,
      })
    );
  });

  it("allocation exists → legacy transfer create with stockRequestItemId must fail before StockTransfer.create", async () => {
    prisma.stockRequestItem.findMany.mockResolvedValue([{ stockRequestId: 99 }]);
    prisma.stockRequest.findUnique.mockResolvedValue({ orgId: 1 });
    prisma.allocationPlan.findUnique.mockResolvedValue({ status: "CONFIRMED" });

    await expect(
      transfersService.createTransfer({
        fromLocationId: 1,
        toLocationId: 2,
        items: [{ variantId: 1, quantity: 1, lotId: 1, stockRequestItemId: 55 }],
        createdByUserId: 3,
      })
    ).rejects.toThrow(/ALLOCATION_PLAN_BLOCKS_LEGACY/);

    expect(prisma.stockTransfer.create).not.toHaveBeenCalled();
    expect(logWarehouseAudit).toHaveBeenCalled();
  });
});
