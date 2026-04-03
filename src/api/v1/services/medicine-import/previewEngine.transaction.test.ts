import { MEDICINE_PREVIEW_ROW_UPDATE_CHUNK, runMedicineImportPreview } from "./previewEngine";
import { medicineImportInteractiveTx } from "./transactionOptions";

describe("runMedicineImportPreview transaction chunking", () => {
  it("uses sequential batch $transaction (array ops) per row chunk, not interactive tx callbacks", async () => {
    const validRaw = {
      genericName: "Amox",
      brandName: "BrandX",
      dosageType: "Tablet",
      strength: "500mg",
      manufacturer: "Acme",
      packageMark: "10s",
    };
    const rows = Array.from({ length: MEDICINE_PREVIEW_ROW_UPDATE_CHUNK * 2 + 10 }, (_, i) => ({
      id: i + 1,
      rowNumber: i + 1,
      rawPayloadJson: validRaw,
    }));

    const findManyEmpty = { findMany: jest.fn().mockResolvedValue([]) };
    const rowUpdate = jest.fn().mockReturnValue(Promise.resolve({}));
    const batchUpdate = jest.fn().mockResolvedValue({});

    const $transaction = jest.fn(async (arg1: unknown, opts?: unknown) => {
      expect(Array.isArray(arg1)).toBe(true);
      expect(opts).toEqual(medicineImportInteractiveTx);
      return;
    });

    const prisma = {
      medicineImportBatch: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          countryId: 1,
          previewVersion: 0,
          status: "UPLOADED",
          rows,
        }),
        update: batchUpdate,
      },
      medicineImportRow: { update: rowUpdate },
      medicineGeneric: findManyEmpty,
      medicineDosageForm: findManyEmpty,
      medicineManufacturer: findManyEmpty,
      medicineBrand: { findMany: jest.fn().mockResolvedValue([]) },
      medicinePresentation: findManyEmpty,
      countryMedicineBrand: findManyEmpty,
      $transaction,
    };

    await runMedicineImportPreview(prisma as never, 1);

    const expectedRowTxns = Math.ceil(rows.length / MEDICINE_PREVIEW_ROW_UPDATE_CHUNK);
    expect($transaction).toHaveBeenCalledTimes(expectedRowTxns);
    expect(batchUpdate).toHaveBeenCalledTimes(1);
  });
});
