import { medicineImportInteractiveTx } from "./transactionOptions";
import { runMedicineImportApply } from "./applyEngine";

describe("runMedicineImportApply skip row batching", () => {
  it("flushes SKIPPED row updates in chunked sequential batch $transaction arrays with explicit timeout", async () => {
    const invalidRows = Array.from({ length: 205 }, (_, i) => ({
      id: i + 1,
      rowNumber: i + 1,
      classification: "INVALID" as const,
      normalizedPayloadJson: null,
      rowFingerprint: "a".repeat(64),
    }));

    const rowUpdate = jest.fn().mockReturnValue(Promise.resolve({}));
    const $transaction = jest.fn(async (arg1: unknown, opts?: unknown) => {
      expect(opts).toEqual(medicineImportInteractiveTx);
      expect(Array.isArray(arg1)).toBe(true);
      return;
    });

    const prisma = {
      medicineImportBatch: {
        findUnique: jest.fn().mockResolvedValue({ id: 1, countryId: 1, status: "CONFIRMED" }),
        update: jest.fn().mockResolvedValue({}),
      },
      medicineImportRow: {
        findMany: jest.fn().mockResolvedValue(invalidRows),
        update: rowUpdate,
      },
      $transaction,
    };

    await runMedicineImportApply(prisma as never, 1, 99);

    // 100 + 100 + 5 row updates => 3 interactive transactions
    expect($transaction).toHaveBeenCalledTimes(3);
  });
});
