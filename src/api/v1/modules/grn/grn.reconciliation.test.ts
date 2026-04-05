/**
 * GRN real-world receive reconciliation tests.
 *
 * Business rule (final confirm only):
 *   acceptedQty + damagedQty + shortQty = expectedQty + extraQty
 *
 * Stock posting: acceptedQty + extraQty (damaged excluded)
 *
 * Run: npx jest grn.reconciliation.test.ts
 */

const makeTx = (lines: any[]) => ({
  $executeRaw: jest.fn(),
  grn: {
    findFirst: jest.fn().mockResolvedValue({
      id: 1,
      orgId: 1,
      status: "DRAFT",
      purchaseOrderId: null,
      locationId: 10,
      vendorId: 5,
      stockDispatchId: null,
      inboundShipmentId: null,
      vendorReceiveSession: { status: "AWAITING_CONFIRMATION" },
      lines,
    }),
    update: jest.fn().mockResolvedValue({}),
  },
  productVariant: {
    findUnique: jest.fn().mockResolvedValue({ requiresExpiry: false, requiresMfg: false }),
  },
  grnLine: {
    update: jest.fn().mockResolvedValue({}),
  },
  purchaseOrder: { findFirst: jest.fn().mockResolvedValue(null) },
  inboundDiscrepancy: { upsert: jest.fn().mockResolvedValue({}) },
});

const prismaMock = {
  $transaction: jest.fn(),
  grn: { findFirst: jest.fn() },
};

jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: prismaMock,
}));

const grnService = require("./grn.service");

/** Helper: run applyManagerConfirmLineEdits with a single line against a known ordered qty. */
async function runConfirm(
  orderedQty: number,
  line: { acceptedQty: number; damagedQty: number; shortQty?: number; extraQty: number },
  opts?: { allowZeroTotalStock?: boolean }
) {
  const tx = makeTx([
    {
      id: 10,
      variantId: 5,
      purchaseOrderLineId: null,
      quantity: orderedQty,
      quantityDamaged: 0,
      quantityShort: 0,
      quantityExtra: 0,
      lotCode: null,
      expDate: null,
      mfgDate: null,
    },
  ]);
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));

  return grnService.applyManagerConfirmLineEdits(
    1,
    1,
    [{ lineId: 10, ...line }],
    opts
  );
}

describe("GRN Reconciliation Rule: accepted + damaged + short = expected + extra", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── VALID CASES ──────────────────────────────────────────────────────────────

  it("exact receive: accepted=1500, expected=1500 — passes", async () => {
    await expect(
      runConfirm(1500, { acceptedQty: 1500, damagedQty: 0, shortQty: 0, extraQty: 0 })
    ).resolves.not.toThrow?.();
    await runConfirm(1500, { acceptedQty: 1500, damagedQty: 0, shortQty: 0, extraQty: 0 });
  });

  it("short receive: accepted=1497, short=3, expected=1500 — passes", async () => {
    await runConfirm(1500, { acceptedQty: 1497, damagedQty: 0, shortQty: 3, extraQty: 0 });
  });

  it("damaged receive: accepted=1490, damaged=10, expected=1500 — passes", async () => {
    await runConfirm(1500, { acceptedQty: 1490, damagedQty: 10, shortQty: 0, extraQty: 0 });
  });

  it("partial + damaged: accepted=1485, damaged=5, short=10, expected=1500 — passes", async () => {
    await runConfirm(1500, { acceptedQty: 1485, damagedQty: 5, shortQty: 10, extraQty: 0 });
  });

  it("extra delivered: accepted=1502, extra=2, expected=1500 — passes", async () => {
    await runConfirm(1500, { acceptedQty: 1502, damagedQty: 0, shortQty: 0, extraQty: 2 });
  });

  it("extra + damaged: accepted=1501, damaged=1, extra=2, expected=1500 — passes", async () => {
    await runConfirm(1500, { acceptedQty: 1501, damagedQty: 1, shortQty: 0, extraQty: 2 });
  });

  // ── INVALID CASES ────────────────────────────────────────────────────────────

  it("impossible math: accepted=100 only, expected=1500 — blocked (reconciliation fails)", async () => {
    await expect(
      runConfirm(1500, { acceptedQty: 100, damagedQty: 0, shortQty: 0, extraQty: 0 })
    ).rejects.toThrow(/reconciliation failed/i);
  });

  it("over-acceptance: accepted=1600, expected=1500 — blocked", async () => {
    await expect(
      runConfirm(1500, { acceptedQty: 1600, damagedQty: 0, shortQty: 0, extraQty: 0 })
    ).rejects.toThrow(/reconciliation failed/i);
  });

  it("negative accepted — blocked", async () => {
    const tx = makeTx([
      {
        id: 10,
        variantId: 5,
        purchaseOrderLineId: null,
        quantity: 1500,
        quantityDamaged: 0,
        quantityShort: 0,
        quantityExtra: 0,
        lotCode: null,
        expDate: null,
        mfgDate: null,
      },
    ]);
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await expect(
      grnService.applyManagerConfirmLineEdits(1, 1, [
        { lineId: 10, acceptedQty: -1, damagedQty: 0, shortQty: 0, extraQty: 0 },
      ])
    ).rejects.toThrow(/negative|invalid/i);
  });

  it("all-zero (no stock to post) — blocked on confirm", async () => {
    await expect(
      runConfirm(1500, { acceptedQty: 0, damagedQty: 0, shortQty: 0, extraQty: 0 })
    ).rejects.toThrow(/accepted or extra|reconciliation/i);
  });

  // ── DRAFT SAVE BYPASSES RECONCILIATION ───────────────────────────────────────

  it("draft save (allowZeroTotalStock) bypasses reconciliation rule — succeeds with mismatched values", async () => {
    await runConfirm(
      1500,
      { acceptedQty: 100, damagedQty: 0, shortQty: 0, extraQty: 0 },
      { allowZeroTotalStock: true }
    );
  });

  it("draft save with all zeros — succeeds", async () => {
    await runConfirm(
      1500,
      { acceptedQty: 0, damagedQty: 0, shortQty: 0, extraQty: 0 },
      { allowZeroTotalStock: true }
    );
  });

  // ── STOCK POSTING FORMULA ────────────────────────────────────────────────────

  it("grnLine.update is called with accepted qty when confirmed", async () => {
    const tx = makeTx([
      {
        id: 10,
        variantId: 5,
        purchaseOrderLineId: null,
        quantity: 1500,
        quantityDamaged: 0,
        quantityShort: 0,
        quantityExtra: 0,
        lotCode: null,
        expDate: null,
        mfgDate: null,
      },
    ]);
    prismaMock.$transaction.mockImplementation(async (fn: (inner: unknown) => Promise<unknown>) => fn(tx));

    await grnService.applyManagerConfirmLineEdits(1, 1, [
      { lineId: 10, acceptedQty: 1490, damagedQty: 10, shortQty: 0, extraQty: 0 },
    ]);

    expect(tx.grnLine.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 1490,
          quantityDamaged: 10,
          quantityShort: 0,
          quantityExtra: 0,
        }),
      })
    );
  });

  it("extraQty is stored on grnLine (stock = accepted + extra)", async () => {
    const tx = makeTx([
      {
        id: 10,
        variantId: 5,
        purchaseOrderLineId: null,
        quantity: 1500,
        quantityDamaged: 0,
        quantityShort: 0,
        quantityExtra: 0,
        lotCode: null,
        expDate: null,
        mfgDate: null,
      },
    ]);
    prismaMock.$transaction.mockImplementation(async (fn: (inner: unknown) => Promise<unknown>) => fn(tx));

    await grnService.applyManagerConfirmLineEdits(1, 1, [
      { lineId: 10, acceptedQty: 1502, damagedQty: 0, shortQty: 0, extraQty: 2 },
    ]);

    expect(tx.grnLine.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 1502,
          quantityExtra: 2,
        }),
      })
    );
  });

  // ── SHORTQTY AUTO-CALCULATION ─────────────────────────────────────────────────

  it("shortQty is auto-calculated when not supplied and orderedQty is available via grnLine.quantity", async () => {
    const tx = makeTx([
      {
        id: 10,
        variantId: 5,
        purchaseOrderLineId: null,
        quantity: 1500,
        quantityDamaged: 0,
        quantityShort: 0,
        quantityExtra: 0,
        lotCode: null,
        expDate: null,
        mfgDate: null,
      },
    ]);
    prismaMock.$transaction.mockImplementation(async (fn: (inner: unknown) => Promise<unknown>) => fn(tx));

    await grnService.applyManagerConfirmLineEdits(1, 1, [
      { lineId: 10, acceptedQty: 1490, damagedQty: 10, extraQty: 0 },
    ]);

    expect(tx.grnLine.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 1490,
          quantityDamaged: 10,
          quantityShort: 0,
        }),
      })
    );
  });
});
