/**
 * Integration-style unit tests: GRN → sync procurement demand fulfilled qty from PO line received totals.
 */
const { syncProcurementDemandsFromPurchaseOrderLines } = require("./procurementDemand.service");

jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: {},
}));

describe("syncProcurementDemandsFromPurchaseOrderLines", () => {
  it("sets fulfilledQty and FULFILLED when received covers demand", async () => {
    const procurementUpdates: Array<{ where: { id: number }; data: { fulfilledQty: number; status: string } }> = [];

    const tx = {
      purchaseOrderLine: {
        findMany: jest.fn().mockResolvedValue([{ id: 101, receivedQty: 10 }]),
      },
      procurementDemandLine: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: 7,
              orgId: 1,
              purchaseOrderLineId: 101,
              status: "PO_LINKED",
              demandQty: 10,
              fulfilledQty: 0,
              stockRequestItemId: 500,
            },
          ])
          .mockResolvedValue([{ status: "FULFILLED", fulfillmentDispatchId: null }]),
        update: jest.fn(async (args: { where: { id: number }; data: any }) => {
          procurementUpdates.push(args);
          return args;
        }),
      },
      stockRequestItem: {
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const out = await syncProcurementDemandsFromPurchaseOrderLines(tx, { orgId: 1, purchaseOrderId: 900 });
    expect(out.updatedIds).toContain(7);
    expect(procurementUpdates).toHaveLength(1);
    expect(procurementUpdates[0].data).toEqual(
      expect.objectContaining({ fulfilledQty: 10, status: "FULFILLED" })
    );
    expect(tx.stockRequestItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 500 },
        data: expect.objectContaining({ backorderStatus: "READY_TO_FULFILL" }),
      })
    );
  });

  it("FIFO splits received across two demands on the same PO line", async () => {
    const procurementUpdates: Array<{ data: { fulfilledQty: number; status: string } }> = [];
    const tx = {
      purchaseOrderLine: {
        findMany: jest.fn().mockResolvedValue([{ id: 202, receivedQty: 12 }]),
      },
      procurementDemandLine: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: 1,
              orgId: 1,
              purchaseOrderLineId: 202,
              status: "PO_LINKED",
              demandQty: 10,
              fulfilledQty: 0,
              stockRequestItemId: 10,
            },
            {
              id: 2,
              orgId: 1,
              purchaseOrderLineId: 202,
              status: "PO_LINKED",
              demandQty: 8,
              fulfilledQty: 0,
              stockRequestItemId: 20,
            },
          ])
          .mockResolvedValueOnce([{ status: "FULFILLED", fulfillmentDispatchId: null }])
          .mockResolvedValueOnce([{ status: "PARTIALLY_RECEIVED", fulfillmentDispatchId: null }]),
        update: jest.fn(async (args: { data: any }) => {
          procurementUpdates.push(args);
          return args;
        }),
      },
      stockRequestItem: {
        update: jest.fn().mockResolvedValue({}),
      },
    };

    await syncProcurementDemandsFromPurchaseOrderLines(tx, { orgId: 1, purchaseOrderId: 1 });

    expect(procurementUpdates.map((u) => u.data)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fulfilledQty: 10, status: "FULFILLED" }),
        expect.objectContaining({ fulfilledQty: 2, status: "PARTIALLY_RECEIVED" }),
      ])
    );
  });
});
