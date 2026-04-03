import { buildImportFingerprint } from "./fingerprint";
import { normalizeKey } from "./normalize";
import { coerceMedicineImportRow, extractMedicineFields } from "./extractRaw";
import { parseDataRow } from "./rowModel";

describe("medicine import logic", () => {
  it("normalizeKey collapses case and spaces", () => {
    expect(normalizeKey("  Amoxicillin  ")).toBe("amoxicillin");
    expect(normalizeKey("Tablet\t 500")).toBe("tablet 500");
  });

  it("extractMedicineFields maps flexible headers", () => {
    const row = {
      GenericName: "Amox",
      Brand_Name: "BrandX",
      dosageType: "Tablet",
      strength: "500mg",
      manufacturer: "Acme",
      packageMark: "10s",
    };
    const f = extractMedicineFields(row);
    expect(f.genericName).toBe("Amox");
    expect(f.brandName).toBe("BrandX");
    expect(f.dosageType).toBe("Tablet");
    expect(f.strength).toBe("500mg");
    expect(f.manufacturer).toBe("Acme");
    expect(f.packageMark).toBe("10s");
  });

  it("parseDataRow produces stable fingerprint for same logical row", () => {
    const raw = {
      genericName: "Amox",
      brandName: "BrandX",
      dosageType: "Tablet",
      strength: "500mg",
      manufacturer: "Acme",
      packageMark: "10s",
    };
    const a = parseDataRow(raw, 1);
    const b = parseDataRow(raw, 1);
    expect(a.normalized).toBeTruthy();
    expect(b.normalized).toBeTruthy();
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("fingerprint differs by country", () => {
    const n = {
      genericDisplay: "g",
      genericKey: "g",
      brandDisplay: "b",
      brandKey: "b",
      dosageFormDisplay: "t",
      dosageFormKey: "t",
      strengthDisplay: "s",
      strengthKey: "s",
      manufacturerDisplay: "m",
      manufacturerKey: "m",
      packageMarkDisplay: "",
      packageKey: "",
    };
    const f1 = buildImportFingerprint(1, n);
    const f2 = buildImportFingerprint(2, n);
    expect(f1).not.toBe(f2);
  });

  it("invalid row has blocking issues and null normalized", () => {
    const r = parseDataRow({ genericName: "", brandName: "B" }, 1);
    expect(r.normalized).toBeNull();
    expect(r.issues.some((i) => i.severity === "blocking")).toBe(true);
  });

  it("coerceMedicineImportRow stringifies numeric CSV cells", () => {
    const c = coerceMedicineImportRow({ strength: 500 as unknown as number, genericName: "X" });
    expect(c.strength).toBe("500");
    expect(c.genericName).toBe("X");
  });
});
