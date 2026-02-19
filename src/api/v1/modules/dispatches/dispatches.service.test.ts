/**
 * Dispatch service tests: send lot validation; receive validation (over-receive, status guard, running total); ledger refType DISPATCH.
 * Run with: npx jest dispatches.service.test.ts
 */
const ledgerService = require("../inventory/ledger.service");

jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    stockDispatch: { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
    stockLotBalance: { findUnique: jest.fn() },
    inventoryLocation: { findUnique: jest.fn() },
  },
}));

jest.mock("../inventory/ledger.service", () => ({
  recordLedgerEntryInTx: jest.fn().mockResolvedValue(undefined),
}));

const prismaMock = require("../../../../infrastructure/db/prismaClient").default;
const { sendDispatch, receiveDispatch } = require("./dispatches.service");

describe("dispatches.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("sendDispatch", () => {
    it("throws when dispatch not found", async () => {
      prismaMock.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          stockDispatch: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
          stockLotBalance: { findUnique: jest.fn() },
        };
        return cb(tx);
      });
      await expect(sendDispatch(999999, 1)).rejects.toThrow("Dispatch not found");
    });

    it("throws when dispatch status is not CREATED or PACKED", async () => {
      prismaMock.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          stockDispatch: {
            findUnique: jest.fn().mockResolvedValue({
              id: 1,
              status: "IN_TRANSIT",
              orgId: 1,
              fromLocationId: 1,
              toLocationId: 2,
              stockRequestId: 1,
              items: [],
            }),
            update: jest.fn(),
          },
          stockLotBalance: { findUnique: jest.fn() },
        };
        return cb(tx);
      });
      await expect(sendDispatch(1, 1)).rejects.toThrow(/cannot be sent in status IN_TRANSIT/);
    });
  });

  describe("receiveDispatch", () => {
    it("throws when dispatch not found", async () => {
      prismaMock.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          stockDispatch: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn(), findMany: jest.fn() },
          stockDispatchItem: { update: jest.fn(), findMany: jest.fn() },
          grn: { findFirst: jest.fn(), create: jest.fn() },
          stockRequest: { findUnique: jest.fn(), update: jest.fn() },
        };
        return cb(tx);
      });
      await expect(
        receiveDispatch(999999, {
          items: [{ variantId: 1, quantityReceived: 5, quantityDamaged: 0, quantityShort: 0 }],
          createdByUserId: 1,
        })
      ).rejects.toThrow("Dispatch not found");
    });

    it("throws Duplicate receive request when idempotency key already used", async () => {
      prismaMock.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          stockDispatch: {
            findUnique: jest.fn().mockResolvedValue({
              id: 1,
              status: "IN_TRANSIT",
              orgId: 1,
              toLocationId: 1,
              stockRequestId: 1,
              items: [{ id: 10, variantId: 1, lotId: 1, quantityDispatched: 10, quantityReceived: 0, quantityDamaged: 0, quantityShort: 0 }],
            }),
            update: jest.fn(),
            findMany: jest.fn(),
          },
          stockDispatchItem: { update: jest.fn(), findMany: jest.fn() },
          grn: { findFirst: jest.fn().mockResolvedValue({ id: 1 }), create: jest.fn() },
          stockRequest: { findUnique: jest.fn(), update: jest.fn() },
        };
        return cb(tx);
      });
      await expect(
        receiveDispatch(1, {
          items: [{ variantId: 1, lotId: 1, quantityReceived: 5, quantityDamaged: 0, quantityShort: 0 }],
          createdByUserId: 1,
          idempotencyKey: "same-key",
        })
      ).rejects.toThrow(/Duplicate receive request \(idempotency key\)/);
    });

    it("throws when dispatch status is not IN_TRANSIT", async () => {
      prismaMock.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          stockDispatch: {
            findUnique: jest.fn().mockResolvedValue({
              id: 1,
              status: "CREATED",
              orgId: 1,
              toLocationId: 1,
              stockRequestId: 1,
              items: [],
            }),
            update: jest.fn(),
            findMany: jest.fn(),
          },
          stockDispatchItem: { update: jest.fn(), findMany: jest.fn() },
          grn: { create: jest.fn() },
          stockRequest: { findUnique: jest.fn(), update: jest.fn() },
        };
        return cb(tx);
      });
      await expect(
        receiveDispatch(1, {
          items: [{ variantId: 1, quantityReceived: 5, quantityDamaged: 0, quantityShort: 0 }],
          createdByUserId: 1,
        })
      ).rejects.toThrow(/can only be received when IN_TRANSIT/);
    });

    it("throws when received total exceeds dispatched for a line", async () => {
      prismaMock.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          stockDispatch: {
            findUnique: jest.fn().mockResolvedValue({
              id: 1,
              status: "IN_TRANSIT",
              orgId: 1,
              toLocationId: 1,
              stockRequestId: 1,
              items: [
                {
                  id: 10,
                  variantId: 1,
                  lotId: 1,
                  quantityDispatched: 10,
                  quantityReceived: 0,
                  quantityDamaged: 0,
                  quantityShort: 0,
                },
              ],
            }),
            update: jest.fn(),
            findMany: jest.fn(),
          },
          stockDispatchItem: { update: jest.fn(), findMany: jest.fn() },
          grn: { create: jest.fn() },
          stockRequest: { findUnique: jest.fn(), update: jest.fn() },
        };
        return cb(tx);
      });
      await expect(
        receiveDispatch(1, {
          items: [
            {
              variantId: 1,
              lotId: 1,
              quantityReceived: 15,
              quantityDamaged: 0,
              quantityShort: 0,
            },
          ],
          createdByUserId: 1,
        })
      ).rejects.toThrow(/cannot exceed dispatched/);
    });

    it("throws when running total would exceed dispatched (additive receive)", async () => {
      prismaMock.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          stockDispatch: {
            findUnique: jest.fn().mockResolvedValue({
              id: 1,
              status: "IN_TRANSIT",
              orgId: 1,
              toLocationId: 1,
              stockRequestId: 1,
              items: [
                {
                  id: 10,
                  variantId: 1,
                  lotId: 1,
                  quantityDispatched: 10,
                  quantityReceived: 8,
                  quantityDamaged: 0,
                  quantityShort: 0,
                },
              ],
            }),
            update: jest.fn(),
            findMany: jest.fn(),
          },
          stockDispatchItem: { update: jest.fn(), findMany: jest.fn() },
          grn: { create: jest.fn() },
          stockRequest: { findUnique: jest.fn(), update: jest.fn() },
        };
        return cb(tx);
      });
      await expect(
        receiveDispatch(1, {
          items: [
            {
              variantId: 1,
              lotId: 1,
              quantityReceived: 3,
              quantityDamaged: 0,
              quantityShort: 0,
            },
          ],
          createdByUserId: 1,
        })
      ).rejects.toThrow(/Running total would exceed dispatched/);
    });

    it("throws when item variant not found in dispatch", async () => {
      prismaMock.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          stockDispatch: {
            findUnique: jest.fn().mockResolvedValue({
              id: 1,
              status: "IN_TRANSIT",
              orgId: 1,
              toLocationId: 1,
              stockRequestId: 1,
              items: [
                {
                  id: 10,
                  variantId: 1,
                  lotId: 1,
                  quantityDispatched: 10,
                  quantityReceived: 0,
                  quantityDamaged: 0,
                  quantityShort: 0,
                },
              ],
            }),
            update: jest.fn(),
            findMany: jest.fn(),
          },
          stockDispatchItem: { update: jest.fn(), findMany: jest.fn() },
          grn: { create: jest.fn() },
          stockRequest: { findUnique: jest.fn(), update: jest.fn() },
        };
        return cb(tx);
      });
      await expect(
        receiveDispatch(1, {
          items: [
            {
              variantId: 99,
              quantityReceived: 5,
              quantityDamaged: 0,
              quantityShort: 0,
            },
          ],
          createdByUserId: 1,
        })
      ).rejects.toThrow(/not found in dispatch/);
    });

    it("calls recordLedgerEntryInTx with TRANSFER_IN and DISPATCH ref when receive valid partial qty", async () => {
      const dispatchFixture = {
        id: 1,
        status: "IN_TRANSIT",
        orgId: 1,
        toLocationId: 2,
        stockRequestId: 1,
        items: [
          {
            id: 10,
            variantId: 1,
            lotId: 1,
            quantityDispatched: 10,
            quantityReceived: 0,
            quantityDamaged: 0,
            quantityShort: 0,
          },
        ],
      };
      prismaMock.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          stockDispatch: {
            findUnique: jest.fn().mockResolvedValue(dispatchFixture),
            update: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([{ status: "DELIVERED" }]),
          },
          stockDispatchItem: {
            update: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([
              {
                quantityReceived: 5,
                quantityDamaged: 0,
                quantityShort: 0,
                quantityDispatched: 10,
              },
            ]),
          },
          grn: { create: jest.fn().mockResolvedValue({ id: 1, lines: [] }) },
          stockRequest: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
        };
        return cb(tx);
      });
      await receiveDispatch(1, {
        items: [
          {
            variantId: 1,
            lotId: 1,
            quantityReceived: 5,
            quantityDamaged: 0,
            quantityShort: 0,
          },
        ],
        createdByUserId: 1,
      });
      expect(ledgerService.recordLedgerEntryInTx).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          orgId: 1,
          locationId: 2,
          variantId: 1,
          lotId: 1,
          type: "TRANSFER_IN",
          quantityDelta: 5,
          refType: "DISPATCH",
          refId: "1",
          createdByUserId: 1,
        })
      );
    });

    it("calls recordLedgerEntryInTx with DAMAGE when quantityDamaged > 0", async () => {
      prismaMock.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          stockDispatch: {
            findUnique: jest.fn().mockResolvedValue({
              id: 1,
              status: "IN_TRANSIT",
              orgId: 1,
              toLocationId: 2,
              stockRequestId: 1,
              items: [
                {
                  id: 10,
                  variantId: 1,
                  lotId: 1,
                  quantityDispatched: 10,
                  quantityReceived: 0,
                  quantityDamaged: 0,
                  quantityShort: 0,
                },
              ],
            }),
            update: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([]),
          },
          stockDispatchItem: {
            update: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([
              {
                quantityReceived: 8,
                quantityDamaged: 2,
                quantityShort: 0,
                quantityDispatched: 10,
              },
            ]),
          },
          grn: { create: jest.fn().mockResolvedValue({ id: 1, lines: [] }) },
          stockRequest: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
        };
        return cb(tx);
      });
      await receiveDispatch(1, {
        items: [
          {
            variantId: 1,
            lotId: 1,
            quantityReceived: 8,
            quantityDamaged: 2,
            quantityShort: 0,
          },
        ],
        createdByUserId: 1,
      });
      expect(ledgerService.recordLedgerEntryInTx).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: "DAMAGE",
          quantityDelta: -2,
          refType: "DISPATCH",
          refId: "1",
        })
      );
    });

    it("updates StockRequest only to PARTIALLY_RECEIVED or RECEIVED", async () => {
      const stockRequestUpdate = jest.fn().mockResolvedValue({});
      prismaMock.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          stockDispatch: {
            findUnique: jest.fn().mockResolvedValue({
              id: 1,
              status: "IN_TRANSIT",
              orgId: 1,
              toLocationId: 2,
              stockRequestId: 100,
              items: [
                {
                  id: 10,
                  variantId: 1,
                  lotId: 1,
                  quantityDispatched: 10,
                  quantityReceived: 0,
                  quantityDamaged: 0,
                  quantityShort: 0,
                },
              ],
            }),
            update: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([{ status: "DELIVERED" }]),
          },
          stockDispatchItem: {
            update: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([
              { quantityReceived: 10, quantityDamaged: 0, quantityShort: 0, quantityDispatched: 10 },
            ]),
          },
          grn: { findFirst: jest.fn(), create: jest.fn().mockResolvedValue({ id: 1, lines: [] }) },
          stockRequest: {
            findUnique: jest.fn().mockResolvedValue({ id: 100, items: [] }),
            update: stockRequestUpdate,
          },
        };
        return cb(tx);
      });
      await receiveDispatch(1, {
        items: [
          { variantId: 1, lotId: 1, quantityReceived: 10, quantityDamaged: 0, quantityShort: 0 },
        ],
        createdByUserId: 1,
      });
      expect(stockRequestUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 100 },
          data: expect.objectContaining({
            status: expect.stringMatching(/^(PARTIALLY_RECEIVED|RECEIVED)$/),
          }),
        })
      );
    });
  });
});
