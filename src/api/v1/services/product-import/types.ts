/**
 * Universal Product Import – shared types and provider adapter interface.
 */
import type { ProductImportSourceType, ProductImportRowStatus, IntegrationMappingType } from "@prisma/client";
import type { ValidationIssue } from "../../constants/productImportIssueCodes";

/** Normalized row shape after Normalizer (canonical keys). */
export interface NormalizedProductRow {
  name?: string;
  sku?: string;
  barcode?: string;
  price?: number;
  category?: string;
  subcategory?: string;
  brand?: string;
  unit?: string;
  description?: string;
  variantTitle?: string;
  [key: string]: unknown;
}

/** Single issue with code + optional message/meta. */
export type IssueItem = ValidationIssue;

/** Input for UpsertEngine (normalized + resolved taxonomy IDs). */
export interface ResolvedProductRow extends NormalizedProductRow {
  categoryId?: number | null;
  subcategoryId?: number | null; // Category.id of child
  brandId?: number | null;
  unitId?: number | null;
}

/** Provider adapter for future API sources (cursor pagination, same pipeline). */
export interface ProviderAdapter {
  readonly provider: string;
  fetchProducts(options: { cursor?: string; limit?: number }): Promise<{
    items: NormalizedProductRow[];
    nextCursor?: string | null;
  }>;
}

/** Batch totals for ProductImportBatch.totals. */
export interface BatchTotals {
  total: number;
  ready: number;
  needsFix: number;
  error: number;
}

export type SourceType = ProductImportSourceType;
export type RowStatus = ProductImportRowStatus;
export type MappingType = IntegrationMappingType;
