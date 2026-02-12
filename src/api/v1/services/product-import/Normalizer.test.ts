/**
 * Unit tests for Normalizer – alias resolution, price parsing, unit normalization.
 */
import { normalizeRow } from "./Normalizer";

describe("Normalizer", () => {
  it("maps canonical keys from name/sku/price", () => {
    const raw = { name: "  Product A  ", sku: "SKU-1", price: "100" };
    const out = normalizeRow(raw);
    expect(out.name).toBe("Product A");
    expect(out.sku).toBe("SKU-1");
    expect(out.price).toBe(100);
  });

  it("accepts aliases product_name and unit_price", () => {
    const raw = { product_name: "Item", unit_price: "250.50" };
    const out = normalizeRow(raw);
    expect(out.name).toBe("Item");
    expect(out.price).toBe(250.5);
  });

  it("parses price with commas", () => {
    const raw = { name: "X", sku: "S1", price: "1,234.56" };
    const out = normalizeRow(raw);
    expect(out.price).toBe(1234.56);
  });

  it("normalizes unit gm to g", () => {
    const raw = { name: "X", sku: "S1", unit: "gm" };
    const out = normalizeRow(raw);
    expect(out.unit).toBe("g");
  });

  it("returns empty object for empty row", () => {
    const out = normalizeRow({});
    expect(out.name).toBeUndefined();
    expect(out.sku).toBeUndefined();
    expect(out.price).toBeUndefined();
  });
});
