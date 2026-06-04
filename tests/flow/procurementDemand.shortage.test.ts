/**
 * Procurement demand from allocation shortage (logic + idempotency).
 */
jest.mock("../../src/infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: {},
}));

jest.mock("../../src/api/v1/modules/warehouse/warehouseAudit.service", () => ({
  logWarehouseAudit: jest.fn().mockResolvedValue({}),
}));

const {
  createProcurementDemandLinesFromShortage,
} = require("../../src/api/v1/modules/procurement_demand/procurementDemand.service");

function buildTx(planPayload: Record<string, unknown>) {
  const creates: unknown[] = [];
  const updates: unknown[] = [];
  const tx = {
    allocationPlan: {
      findFirst: jest.fn().mockResolvedValue(planPayload),
    },
    procurementDemandLine: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async (args: { data: unknown }) => {
        creates.push(args.data);
        return args;
      }),
    },
    stockRequestItem: {
      update: jest.fn(async (args: unknown) => {
        updates.push(args);
        return args;
      }),
    },
  };
  return { tx, creates, updates };
}

describe("createProcurementDemandLinesFromShortage", () => {
  it("creates demand lines when two REQUESTED lines share a variant and FEFO is short (aggregated demand)", async () => {
    const variantId = 9001;
    const planId = 501;
    const stockRequestId = 42;
    const items = [
      {
        id: 101,
        variantId,
        requestedQty: 5,
        fulfilledQty: 0,
        cancelledQty: 0,
        lineKind: "REQUESTED",
        backorderStatus: "NONE",
      },
      {
        id: 102,
        variantId,
        requestedQty: 5,
        fulfilledQty: 0,
        cancelledQty: 0,
        lineKind: "REQUESTED",
        backorderStatus: "NONE",
      },
    ];
    const planLines = [
      {
        id: 201,
        variantId,
        quantityAllocated: 3,
        demandQty: 10,
        quantityShort: 7,
        lotId: 1,
        locationId: 10,
      },
    ];

    const { tx, creates } = buildTx({
      id: planId,
      orgId: 1,
      stockRequestId,
      shortageQty: 7,
      warehouseId: null,
      stockRequest: {
        id: stockRequestId,
        requestIntent: "INTERNAL_TRANSFER",
        approvedItems: null,
        extraItems: null,
        items,
      },
      lines: planLines,
    });

    const out = await createProcurementDemandLinesFromShortage(tx as any, {
      planId,
      orgId: 1,
      actorUserId: 1,
    });

    expect(out.created).toBeGreaterThanOrEqual(1);
    const totalDemand = (creates as Array<{ demandQty: number }>).reduce((s, r) => s + r.demandQty, 0);
    expect(totalDemand).toBe(7);
    expect((creates as Array<{ stockRequestItemId: number }>).map((r) => r.stockRequestItemId).sort()).toEqual(
      [101, 102].sort()
    );
  });

  it("skips create when demand row already exists (idempotent)", async () => {
    const variantId = 9002;
    const planId = 502;
    const stockRequestId = 43;
    const items = [
      {
        id: 201,
        variantId,
        requestedQty: 10,
        fulfilledQty: 0,
        cancelledQty: 0,
        lineKind: "REQUESTED",
        backorderStatus: "NONE",
      },
    ];
    const planLines = [
      {
        id: 301,
        variantId,
        quantityAllocated: 2,
        demandQty: 10,
        quantityShort: 8,
        lotId: 1,
        locationId: 10,
      },
    ];

    const { tx, creates } = buildTx({
      id: planId,
      orgId: 1,
      stockRequestId,
      /** Zero plan shortage avoids fallback + unresolved warning when idempotency skips all creates. */
      shortageQty: 0,
      warehouseId: null,
      stockRequest: {
        id: stockRequestId,
        requestIntent: "INTERNAL_TRANSFER",
        approvedItems: null,
        extraItems: null,
        items,
      },
      lines: planLines,
    });

    (tx.procurementDemandLine.count as jest.Mock).mockResolvedValue(1);

    const out = await createProcurementDemandLinesFromShortage(tx as any, { planId, orgId: 1, actorUserId: 1 });

    expect(out.created).toBe(0);
    expect(creates).toHaveLength(0);
  });
});
