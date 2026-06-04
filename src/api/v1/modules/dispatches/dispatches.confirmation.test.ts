/**
 * Dispatch receive confirmation + ledger posting tests (mocked Prisma tx).
 * Run: npx jest dispatches.confirmation.test.ts
 */

const prismaMock = {
  $transaction: jest.fn(),
  dispatchReceiveSession: {
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  stockDispatch: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  stockDispatchItem: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  grn: {
    create: jest.fn(),
    findFirst: jest.fn(),
  },
  stockRequest: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: prismaMock,
}));

jest.mock("../inventory/ledger.service", () => ({
  recordLedgerEntryInTx: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../warehouse/warehouseAudit.service", () => ({
  logWarehouseAudit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../stock_requests/stock_requests.service", () => ({
  markStockRequestStatusFromDispatchReceive: jest.fn().mockResolvedValue(undefined),
}));

const dispatchService = require("./dispatches.service");

function dispatchItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    variantId: 1,
    lotId: 1,
    quantityDispatched: 10,
    quantityReceived: 0,
    quantityDamaged: 0,
    quantityShort: 0,
    ...overrides,
  };
}

/** Minimal tx mock for receiveDispatchLedgerInTx (full receive vs partial). */
function makeLedgerTx(partialQty: number | null) {
  const line = dispatchItem();
  const afterLine =
    partialQty == null
      ? dispatchItem({ quantityReceived: 10 })
      : dispatchItem({ quantityReceived: partialQty });

  const initialDispatch = {
    id: 1,
    status: "IN_TRANSIT",
    orgId: 1,
    stockRequestId: null,
    medicineRequisitionId: null,
    fromLocationId: 1,
    toLocationId: 2,
    items: [line],
  };

  const finalDispatch = {
    ...initialDispatch,
    status: partialQty == null ? "DELIVERED" : "IN_TRANSIT",
    items: [afterLine],
  };

  return {
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    stockDispatch: {
      findUnique: jest.fn().mockResolvedValueOnce(initialDispatch).mockResolvedValue(finalDispatch),
      update: jest.fn(),
    },
    stockDispatchItem: {
      findMany: jest.fn().mockResolvedValue([afterLine]),
      update: jest.fn(),
    },
    grn: {
      create: jest.fn().mockResolvedValue({ id: 1, lines: [] }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    stockDispatchDiscrepancy: {
      create: jest.fn().mockResolvedValue({}),
    },
    medicineRequisition: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
}

describe("Dispatch Receive Confirmation Safety", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("confirmDispatchReceiveFromSession", () => {
    it("rejects when no saved session and no items in payload", async () => {
      prismaMock.dispatchReceiveSession.findUnique.mockResolvedValue(null);

      await expect(dispatchService.confirmDispatchReceiveFromSession(1, {})).rejects.toThrow(
        /No receive session to confirm/
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("rejects when session already POSTED", async () => {
      prismaMock.dispatchReceiveSession.findUnique.mockResolvedValue({
        id: 10,
        stockDispatchId: 1,
        status: "POSTED",
        orgId: 1,
        notes: null,
        lines: [
          {
            quantityReceived: 1,
            quantityDamaged: 0,
            quantityShort: 0,
            reasonCode: null,
            lineNote: null,
            stockDispatchItem: { variantId: 1, lotId: 1 },
          },
        ],
      });

      await expect(dispatchService.confirmDispatchReceiveFromSession(1, { createdByUserId: 1 })).rejects.toThrow(
        /Cannot confirm in status POSTED/
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("locks session row and completes when AWAITING_CONFIRMATION with lines", async () => {
      prismaMock.dispatchReceiveSession.findUnique.mockResolvedValue({
        id: 10,
        stockDispatchId: 1,
        status: "AWAITING_CONFIRMATION",
        orgId: 1,
        notes: null,
        lines: [
          {
            quantityReceived: 10,
            quantityDamaged: 0,
            quantityShort: 0,
            reasonCode: null,
            lineNote: null,
            stockDispatchItem: { variantId: 1, lotId: 1 },
          },
        ],
      });

      const innerTx = {
        ...makeLedgerTx(null),
        dispatchReceiveSession: {
          findUnique: jest.fn().mockResolvedValue({
            id: 10,
            status: "AWAITING_CONFIRMATION",
            orgId: 1,
            notes: null,
          }),
          update: jest.fn(),
        },
        dispatchReceiveSessionLine: {
          deleteMany: jest.fn(),
        },
      };

      prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(innerTx));

      await dispatchService.confirmDispatchReceiveFromSession(1, { createdByUserId: 1 });

      expect(innerTx.$executeRaw).toHaveBeenCalled();
      expect(innerTx.dispatchReceiveSession.update).toHaveBeenCalled();
      expect(innerTx.grn.create).toHaveBeenCalled();
    });
  });

  describe("receiveDispatchLedgerInTx", () => {
    it("row-locks dispatch before loading", async () => {
      const mockTx = makeLedgerTx(null);
      await dispatchService.receiveDispatchLedgerInTx(mockTx, 1, {
        items: [{ variantId: 1, lotId: 1, quantityReceived: 10, quantityDamaged: 0, quantityShort: 0 }],
      });
      expect(mockTx.$executeRaw).toHaveBeenCalled();
      expect(mockTx.stockDispatch.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: { items: true },
      });
      expect(mockTx.stockDispatch.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({ status: "DELIVERED" }),
      });
      expect(mockTx.grn.create).toHaveBeenCalled();
    });

    it("rejects when dispatch is not IN_TRANSIT", async () => {
      const mockTx = {
        $executeRaw: jest.fn().mockResolvedValue(undefined),
        stockDispatch: {
          findUnique: jest.fn().mockResolvedValue({
            id: 1,
            status: "DELIVERED",
            orgId: 1,
            fromLocationId: 1,
            toLocationId: 2,
            items: [],
          }),
        },
      };

      await expect(
        dispatchService.receiveDispatchLedgerInTx(mockTx, 1, {
          items: [{ variantId: 1, lotId: 1, quantityReceived: 10, quantityDamaged: 0, quantityShort: 0 }],
        })
      ).rejects.toThrow(/IN_TRANSIT/);
    });

    it("records TRANSFER_IN with quantityDelta", async () => {
      const ledgerService = require("../inventory/ledger.service");
      const mockTx = makeLedgerTx(null);
      await dispatchService.receiveDispatchLedgerInTx(mockTx, 1, {
        items: [{ variantId: 1, lotId: 1, quantityReceived: 10, quantityDamaged: 0, quantityShort: 0 }],
      });
      expect(ledgerService.recordLedgerEntryInTx).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          type: "TRANSFER_IN",
          locationId: 2,
          variantId: 1,
          lotId: 1,
          quantityDelta: 10,
          refType: "DISPATCH",
          refId: "1",
        })
      );
    });

    it("legacy-relaxed partial receive does not mark dispatch DELIVERED", async () => {
      const mockTx = makeLedgerTx(7);
      await dispatchService.receiveDispatchLedgerInTx(
        mockTx,
        1,
        {
          items: [
            {
              variantId: 1,
              lotId: 1,
              quantityReceived: 7,
              quantityDamaged: 0,
              quantityShort: 0,
              lineNote: "Receiving first installment from vehicle today; balance on next trip.",
            },
          ],
        },
        { relaxRemainingPartition: true }
      );
      expect(mockTx.stockDispatch.update).not.toHaveBeenCalled();
      expect(mockTx.stockDispatchItem.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { quantityReceived: 7, quantityDamaged: 0, quantityShort: 0 },
      });
    });
  });
});
