/**
 * Single POS entry point for branch shop list price (barcode + browse).
 * Delegates to the canonical engine only — no duplicate formulas.
 */
import type { OrgPricingPolicy } from "@prisma/client";
import { getAvailableLotsFEFO } from "../inventory/ledger.service";
import { resolveSellingPrice, resolveSellingPriceWithEnterprise, type ResolvedPrice } from "./pricingEngine.service";
import { getOrCreateOrgPolicy } from "./pricingGovernance.service";
import { shouldPosUseEnterpriseListPriceResolution } from "./posPricingPolicy.util";

export type PosListPriceMeta = {
  price: number | null;
  sellPrice: number | null;
  effectiveSellPrice: number | null;
  priceSource: string;
  priceMissing: boolean;
  priceMissingReason: string | null;
};

function getPriceSource(resolved?: ResolvedPrice | null): string {
  if (!resolved) return "NONE";
  if (resolved.breakdown?.batchPromo != null) return "BATCH_PROMO";
  if (resolved.breakdown?.enterpriseList != null) return "ENTERPRISE_LIST";
  return resolved.source ?? "NONE";
}

function toPositivePrice(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function toPosListPriceMeta(
  resolved?: ResolvedPrice | null,
  fallbackReason = "NO_POS_PRICE_CONFIGURED"
): PosListPriceMeta {
  const price = toPositivePrice(resolved?.price);
  if (price != null) {
    return {
      price,
      sellPrice: price,
      effectiveSellPrice: price,
      priceSource: getPriceSource(resolved),
      priceMissing: false,
      priceMissingReason: null,
    };
  }
  return {
    price: null,
    sellPrice: null,
    effectiveSellPrice: null,
    priceSource: getPriceSource(resolved),
    priceMissing: true,
    priceMissingReason: fallbackReason,
  };
}

export async function resolvePosBranchVariantListPrice(params: {
  orgId: number;
  branchId: number;
  shopLocationId?: number | null;
  variantId: number;
  /** When provided (e.g. POS browse batch), avoids repeated policy reads. */
  policy?: OrgPricingPolicy | null;
}): Promise<ResolvedPrice> {
  const policy = params.policy ?? (await getOrCreateOrgPolicy(params.orgId));
  const shopLocationId = params.shopLocationId ?? null;
  if (shouldPosUseEnterpriseListPriceResolution(policy)) {
    let lotId: number | null = null;
    if (shopLocationId) {
      try {
        const lots = await getAvailableLotsFEFO(shopLocationId, params.variantId);
        lotId = lots[0]?.lotId ?? null;
      } catch {
        lotId = null;
      }
    }
    return resolveSellingPriceWithEnterprise({
      orgId: params.orgId,
      variantId: params.variantId,
      branchId: params.branchId,
      locationId: shopLocationId,
      shopLocationId,
      lotId,
    });
  }
  const resolved = await resolveSellingPrice({
    orgId: params.orgId,
    variantId: params.variantId,
    branchId: params.branchId,
    locationId: shopLocationId,
  });
  if ((resolved.price == null || !(resolved.price > 0)) && shopLocationId) {
    const batchFallback = await resolveSellingPriceWithEnterprise({
      orgId: params.orgId,
      variantId: params.variantId,
      branchId: params.branchId,
      locationId: shopLocationId,
      shopLocationId,
    });
    if (
      batchFallback.price != null &&
      batchFallback.price > 0 &&
      batchFallback.breakdown?.batchPromo != null
    ) {
      return batchFallback;
    }
  }
  return resolved;
}

export async function resolvePosBranchVariantListPriceMeta(params: {
  orgId: number;
  branchId: number;
  shopLocationId?: number | null;
  variantId: number;
  /** When provided (e.g. POS browse batch), avoids repeated policy reads. */
  policy?: OrgPricingPolicy | null;
}): Promise<PosListPriceMeta> {
  const resolved = await resolvePosBranchVariantListPrice(params);
  return toPosListPriceMeta(resolved);
}

/** Resolve POS list price metadata for many variants, keeping unpriced variants in the result map. */
export async function resolvePosBranchVariantListPricesMetaBulk(params: {
  orgId: number;
  branchId: number;
  shopLocationId?: number | null;
  variantIds: number[];
  policy?: OrgPricingPolicy | null;
}): Promise<Map<number, PosListPriceMeta>> {
  const out = new Map<number, PosListPriceMeta>();
  const CHUNK = 8;
  const ids = [...new Set(params.variantIds)].filter((id) => Number.isFinite(id));
  const policy = params.policy ?? (await getOrCreateOrgPolicy(params.orgId));
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (variantId) => {
        try {
          const meta = await resolvePosBranchVariantListPriceMeta({
            orgId: params.orgId,
            branchId: params.branchId,
            shopLocationId: params.shopLocationId ?? null,
            variantId,
            policy,
          });
          out.set(variantId, meta);
        } catch (err) {
          console.warn("POS bulk list price metadata resolution failed; variant marked unpriced", {
            orgId: params.orgId,
            variantId,
            err,
          });
          out.set(variantId, {
            price: null,
            sellPrice: null,
            effectiveSellPrice: null,
            priceSource: "NONE",
            priceMissing: true,
            priceMissingReason: "PRICE_RESOLUTION_FAILED",
          });
        }
      })
    );
  }
  return out;
}

/** Resolve list prices for many variants when enterprise list mode is on (chunked). */
export async function resolvePosBranchVariantListPricesBulk(params: {
  orgId: number;
  branchId: number;
  shopLocationId?: number | null;
  variantIds: number[];
  policy: OrgPricingPolicy;
}): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const metaMap = await resolvePosBranchVariantListPricesMetaBulk(params);
  for (const [variantId, meta] of metaMap.entries()) {
    if (meta.price != null && meta.price > 0) out.set(variantId, meta.price);
  }
  return out;
}
