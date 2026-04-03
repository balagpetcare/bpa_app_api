/**
 * Cycle count posting: idempotent POSTED; single ledger path per variance line.
 * Run: npx jest stockCount.service.test.ts
 */
jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    stockCountSession: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("./ledger.service", () => ({
  recordLedgerEntryInTx: jest.fn().mockResolvedValue({ id: 1 }),
}));

const prismaMock = require("../../../../infrastructure/db/prismaClient").default;
const ledgerService = require("./ledger.service");
const { postStockCount } = require("./stockCount.service");

describe("stockCount.service postStockCount", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns session without ledger when already POSTED (idempotent)", async () => {
    const posted = { id: 10, status: "POSTED", orgId: 1, lines: [], location: { id: 1 } };
    prismaMock.stockCountSession.findUnique.mockResolvedValue(posted);

    const out = await postStockCount(10, 1, 99);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(ledgerService.recordLedgerEntryInTx).not.toHaveBeenCalled();
    expect(prismaMock.stockCountSession.findUnique).toHaveBeenCalledTimes(2);
    expect(out).toEqual(posted);
  });

  it("posts one ADJUSTMENT per line with non-zero variance (positive and negative)", async () => {
    const frozen = {
      id: 2,
      orgId: 1,
      status: "FROZEN",
      locationId: 5,
      lines: [
        { id: 1, variantId: 100, lotId: null, varianceQty: 3 },
        { id: 2, variantId: 200, lotId: 7, varianceQty: -2 },
      ],
      location: { id: 5 },
    };
    const afterPost = { id: 2, status: "POSTED", lines: frozen.lines };

    prismaMock.stockCountSession.findUnique.mockResolvedValueOnce(frozen).mockResolvedValueOnce(afterPost);

    prismaMock.$transaction.mockImplementation(async (cb: (tx: { stockCountSession: { update: jest.Mock } }) => Promise<void>) => {
      const tx = {
        stockCountSession: { update: jest.fn().mockResolvedValue({}) },
      };
      await cb(tx);
    });

    await postStockCount(2, 1, 42);

    expect(ledgerService.recordLedgerEntryInTx).toHaveBeenCalledTimes(2);
    expect(ledgerService.recordLedgerEntryInTx).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        orgId: 1,
        locationId: 5,
        variantId: 100,
        quantityDelta: 3,
        refType: "STOCK_COUNT",
        refId: "2",
      })
    );
    expect(ledgerService.recordLedgerEntryInTx).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        variantId: 200,
        lotId: 7,
        quantityDelta: -2,
      })
    );
  });
});
