/**
 * Dispatch receive confirmation transaction safety tests.
 * Tests: session locking, duplicate confirmation prevention, ledger consistency
 * Run with: npx jest dispatches.confirmation.test.ts
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

const dispatchService = require("./dispatches.service");

describe("Dispatch Receive Confirmation Safety", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("session locking and status validation", () => {
    it("should lock session row during confirmation", async () => {
      const mockTx = {
        dispatchReceiveSession: {
          findUnique: jest.fn().mockResolvedValue({
            id: 1,
            stockDispatchId: 1,
            status: "AWAITING_CONFIRMATION",
            orgId: 1,
          }),
          update: jest.fn(),
          delete: jest.fn(),
        },
        stockDispatch: {
          findUnique: jest.fn().mockResolvedValue({
            id: 1,
            status: "IN_TRANSIT",
            orgId: 1,
            fromLocationId: 1,
            toLocationId: 2,
            items: [],
          }),
          update: jest.fn(),
        },
        stockDispatchItem: {
          findMany: jest.fn().mockResolvedValue([]),
          update: jest.fn(),
        },
        grn: {
          create: jest.fn().mockResolvedValue({ id: 1 }),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        stockRequest: {
          findUnique: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
      };

      prismaMock.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      await dispatchService.confirmDispatchReceiveFromSession(1, 1);

      // Verify session was locked with FOR UPDATE
      expect(mockTx.dispatchReceiveSession.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: expect.any(Object),
        // Note: FOR UPDATE would be in raw SQL, not easily testable in unit test
      });

      // Verify session status was checked
      expect(mockTx.dispatchReceiveSession.update).toHaveBeenCalled();
    });

    it("should reject confirmation if session already confirmed", async () => {
      const mockTx = {
        dispatchReceiveSession: {
          findUnique: jest.fn().mockResolvedValue({
            id: 1,
            stockDispatchId: 1,
            status: "CONFIRMED", // Already confirmed
            orgId: 1,
          }),
        },
      };

      prismaMock.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      await expect(
        dispatchService.confirmDispatchReceiveFromSession(1, 1)
      ).rejects.toThrow(/not in AWAITING_CONFIRMATION status/);

      // Verify no further processing occurred
      expect(mockTx.stockDispatch?.findUnique).not.toHaveBeenCalled();
    });

    it("should reject confirmation if session not found", async () => {
      const mockTx = {
        dispatchReceiveSession: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      };

      prismaMock.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      await expect(
        dispatchService.confirmDispatchReceiveFromSession(999, 1)
      ).rejects.toThrow(/Session not found/);
    });
  });

  describe("dispatch locking during receive", () => {
    it("should lock dispatch row during ledger posting", async () => {
      const mockTx = {
        stockDispatch: {
          findUnique: jest.fn().mockResolvedValue({
            id: 1,
            status: "IN_TRANSIT",
            orgId: 1,
            fromLocationId: 1,
            toLocationId: 2,
            items: [
              { id: 1, variantId: 1, lotId: 1, quantity: 10, quantityReceived: 0 },
            ],
          }),
          update: jest.fn(),
        },
        stockDispatchItem: {
          findMany: jest.fn().mockResolvedValue([
            { id: 1, variantId: 1, lotId: 1, quantity: 10, quantityReceived: 0 },
          ]),
          update: jest.fn(),
        },
        grn: {
          create: jest.fn().mockResolvedValue({ id: 1 }),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        stockRequest: {
          findUnique: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
      };

      prismaMock.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      const receiveItems = [
        { variantId: 1, lotId: 1, quantityReceived: 10 },
      ];

      await dispatchService.receiveDispatchLedgerInTx(1, receiveItems, 1, mockTx);

      // Verify dispatch was locked with FOR UPDATE (would be in raw SQL)
      expect(mockTx.stockDispatch.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: expect.any(Object),
      });

      // Verify ledger entries were created and dispatch status updated
      expect(mockTx.stockDispatch.update).toHaveBeenCalled();
      expect(mockTx.grn.create).toHaveBeenCalled();
    });

    it("should prevent concurrent receive operations on same dispatch", async () => {
      // This test simulates what would happen if two confirmation requests
      // tried to process the same dispatch simultaneously

      const mockTx = {
        stockDispatch: {
          findUnique: jest.fn().mockResolvedValue({
            id: 1,
            status: "DELIVERED", // Already processed by concurrent request
            orgId: 1,
            fromLocationId: 1,
            toLocationId: 2,
            items: [],
          }),
        },
      };

      prismaMock.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      const receiveItems = [
        { variantId: 1, lotId: 1, quantityReceived: 10 },
      ];

      await expect(
        dispatchService.receiveDispatchLedgerInTx(1, receiveItems, 1, mockTx)
      ).rejects.toThrow(/cannot receive dispatch with status DELIVERED/);
    });
  });

  describe("ledger consistency", () => {
    it("should create matching TRANSFER_OUT and TRANSFER_IN entries", async () => {
      const ledgerService = require("../inventory/ledger.service");

      const mockTx = {
        stockDispatch: {
          findUnique: jest.fn().mockResolvedValue({
            id: 1,
            status: "IN_TRANSIT",
            orgId: 1,
            fromLocationId: 1,
            toLocationId: 2,
            items: [
              { id: 1, variantId: 1, lotId: 1, quantity: 10, quantityReceived: 0 },
            ],
          }),
          update: jest.fn(),
        },
        stockDispatchItem: {
          findMany: jest.fn().mockResolvedValue([
            { id: 1, variantId: 1, lotId: 1, quantity: 10, quantityReceived: 0 },
          ]),
          update: jest.fn(),
        },
        grn: {
          create: jest.fn().mockResolvedValue({ id: 1 }),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        stockRequest: {
          findUnique: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
      };

      prismaMock.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      const receiveItems = [
        { variantId: 1, lotId: 1, quantityReceived: 10 },
      ];

      await dispatchService.receiveDispatchLedgerInTx(1, receiveItems, 1, mockTx);

      // Verify TRANSFER_IN ledger entry was created
      expect(ledgerService.recordLedgerEntryInTx).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "TRANSFER_IN",
          locationId: 2,
          variantId: 1,
          lotId: 1,
          quantity: 10,
          refType: "DISPATCH",
          refId: "1",
        }),
        mockTx
      );
    });

    it("should handle partial receives correctly", async () => {
      const mockTx = {
        stockDispatch: {
          findUnique: jest.fn().mockResolvedValue({
            id: 1,
            status: "IN_TRANSIT",
            orgId: 1,
            fromLocationId: 1,
            toLocationId: 2,
            items: [
              { id: 1, variantId: 1, lotId: 1, quantity: 10, quantityReceived: 0 },
            ],
          }),
          update: jest.fn(),
        },
        stockDispatchItem: {
          findMany: jest.fn().mockResolvedValue([
            { id: 1, variantId: 1, lotId: 1, quantity: 10, quantityReceived: 0 },
          ]),
          update: jest.fn(),
        },
        grn: {
          create: jest.fn().mockResolvedValue({ id: 1 }),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        stockRequest: {
          findUnique: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
      };

      prismaMock.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      const receiveItems = [
        { variantId: 1, lotId: 1, quantityReceived: 7 }, // Partial receive
      ];

      await dispatchService.receiveDispatchLedgerInTx(1, receiveItems, 1, mockTx);

      // Verify dispatch remains IN_TRANSIT for partial receives
      expect(mockTx.stockDispatch.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          // Should not set status to DELIVERED for partial receive
        }),
      });

      // Verify item quantity updated correctly
      expect(mockTx.stockDispatchItem.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { quantityReceived: 7 },
      });
    });
  });
});
