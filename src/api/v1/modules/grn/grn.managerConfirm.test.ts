/**
 * Manager confirm line edits — validation entry points.
 * Run: npx jest grn.managerConfirm.test.ts
 */
const prismaMock = {
  $transaction: jest.fn(),
  grn: { findFirst: jest.fn() },
};

jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: prismaMock,
}));

const grnService = require("./grn.service");

describe("applyManagerConfirmLineEdits", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects empty lines array before touching the database", async () => {
    await expect(grnService.applyManagerConfirmLineEdits(1, 1, [])).rejects.toThrow("lines[] is required");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects when accepted and extra are all zero", async () => {
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $executeRaw: jest.fn(),
        grn: {
          findFirst: jest.fn().mockResolvedValue({
            id: 1,
            orgId: 1,
            status: "DRAFT",
            purchaseOrderId: null,
            locationId: 1,
            vendorId: 1,
            stockDispatchId: null,
            inboundShipmentId: null,
            lines: [
              {
                id: 10,
                variantId: 5,
                purchaseOrderLineId: null,
                quantity: 0,
                quantityDamaged: 0,
                quantityShort: 0,
                quantityExtra: 0,
                lotCode: null,
                expDate: null,
                mfgDate: null,
              },
            ],
            vendorReceiveSession: { status: "AWAITING_CONFIRMATION" },
          }),
        },
      };
      return fn(tx);
    });

    await expect(
      grnService.applyManagerConfirmLineEdits(1, 1, [
        { lineId: 10, acceptedQty: 0, damagedQty: 0, extraQty: 0 },
      ])
    ).rejects.toThrow(/at least one line must have accepted or extra/i);
  });

  it("allows all-zero accepted+extra when allowZeroTotalStock is true (draft save)", async () => {
    const tx = {
      $executeRaw: jest.fn(),
      grn: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          orgId: 1,
          status: "DRAFT",
          purchaseOrderId: null,
          locationId: 1,
          vendorId: 1,
          stockDispatchId: null,
          inboundShipmentId: null,
          lines: [
            {
              id: 10,
              variantId: 5,
              purchaseOrderLineId: null,
              quantity: 0,
              quantityDamaged: 0,
              quantityShort: 0,
              quantityExtra: 0,
              lotCode: null,
              expDate: null,
              mfgDate: null,
            },
          ],
          vendorReceiveSession: { status: "AWAITING_CONFIRMATION" },
        }),
      },
      productVariant: {
        findUnique: jest.fn().mockResolvedValue({ requiresExpiry: false, requiresMfg: false }),
      },
      grnLine: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    prismaMock.$transaction.mockImplementation(async (fn: (inner: unknown) => Promise<unknown>) => fn(tx));

    prismaMock.grn.findFirst = jest.fn().mockResolvedValue({
      id: 1,
      orgId: 1,
      status: "DRAFT",
      lines: [],
      vendorReceiveSession: { status: "AWAITING_CONFIRMATION" },
    });

    await expect(
      grnService.applyManagerConfirmLineEdits(
        1,
        1,
        [{ lineId: 10, acceptedQty: 0, damagedQty: 0, extraQty: 0 }],
        { allowZeroTotalStock: true }
      )
    ).resolves.toBeDefined();

    expect(tx.grnLine.update).toHaveBeenCalled();
  });
});
