/**
 * Plugin interface for API-based product import (e.g. future POS connectors).
 * Implement fetchProducts (cursor pagination) and normalize (provider-specific → NormalizedProductRow).
 */
import type { NormalizedProductRow } from "../types";

export interface ProviderAdapter {
  readonly providerName: string;

  /**
   * Fetch a page of products from the external system.
   * @param cursor - Optional pagination cursor from previous call.
   * @param limit - Max items to return (e.g. 500).
   */
  fetchProducts(options: { cursor?: string | null; limit?: number }): Promise<{
    items: unknown[];
    nextCursor?: string | null;
  }>;

  /**
   * Convert one provider item to NormalizedProductRow (canonical keys).
   */
  normalize(item: unknown): NormalizedProductRow;
}
