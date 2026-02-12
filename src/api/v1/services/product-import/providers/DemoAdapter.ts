/**
 * Stub adapter with hardcoded sample items – for testing and as a template for real connectors.
 */
import type { ProviderAdapter } from "./ProviderAdapter";
import type { NormalizedProductRow } from "../types";

const SAMPLE_ITEMS: unknown[] = [
  { name: "Demo Product A", sku: "DEMO-A", barcode: "1111111111111", price: 100, category: "Food", brand: "Demo Brand" },
  { name: "Demo Product B", sku: "DEMO-B", barcode: "2222222222222", price: 200, category: "Food", brand: "Demo Brand" },
];

export const DemoAdapter: ProviderAdapter = {
  providerName: "demo",

  async fetchProducts(options: { cursor?: string | null; limit?: number }) {
    const limit = options.limit ?? 100;
    const cursor = options.cursor ? parseInt(options.cursor, 10) : 0;
    const slice = SAMPLE_ITEMS.slice(cursor, cursor + limit);
    const nextCursor = cursor + slice.length < SAMPLE_ITEMS.length ? String(cursor + slice.length) : null;
    return { items: slice, nextCursor };
  },

  normalize(item: unknown): NormalizedProductRow {
    const r = item as Record<string, unknown>;
    return {
      name: r.name != null ? String(r.name).trim() : undefined,
      sku: r.sku != null ? String(r.sku).trim() : undefined,
      barcode: r.barcode != null ? String(r.barcode).trim() : undefined,
      price: r.price != null ? Number(r.price) : undefined,
      category: r.category != null ? String(r.category).trim() : undefined,
      subcategory: r.subcategory != null ? String(r.subcategory).trim() : undefined,
      brand: r.brand != null ? String(r.brand).trim() : undefined,
      unit: r.unit != null ? String(r.unit).trim() : undefined,
      description: r.description != null ? String(r.description).trim() : undefined,
      variantTitle: r.variantTitle != null ? String(r.variantTitle).trim() : undefined,
    };
  },
};
