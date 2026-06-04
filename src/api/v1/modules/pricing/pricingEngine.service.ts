/**
 * Resolves selling price: BranchPricing override → ProductPricing (base + markup + min/max/MRP) → LocationPrice.
 * Optional: enterprise rules, campaigns, membership tier %, batch promo (see resolveSellingPriceWithEnterprise).
 *
 * @see docs/pricing/BPA_ENTERPRISE_PRICING_ARCHITECTURE_PLAN.md — canonical layer order and single-resolver boundaries.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import { applyEnterpriseListPriceLayers, findBestBatchPromoPrice } from "./enterpriseResolution.service";
import { getOrCreateOrgPolicy } from "./pricingGovernance.service";

export type ResolvedPrice = {
  price: number | null;
  source: "BRANCH_OVERRIDE" | "PRODUCT_PRICING" | "LOCATION_PRICE" | "NONE";
  breakdown: {
    branchOverride?: number;
    basePrice?: number;
    markupPercent?: number;
    afterMarkup?: number;
    minPrice?: number;
    maxPrice?: number;
    mrp?: number;
    locationPrice?: number;
    /** After enterprise rules / campaigns / membership (before batch promo floor). */
    enterpriseList?: number;
    batchPromo?: number;
  };
  enterpriseTrace?: import("./enterpriseResolution.service").ResolutionTraceStep[];
  enterpriseDiagnostics?: import("./enterpriseResolution.service").EnterpriseLayerDiagnostics;
};

function isEffective(effectiveFrom: Date, effectiveTo: Date | null, at: Date): boolean {
  if (effectiveFrom.getTime() > at.getTime()) return false;
  if (effectiveTo && effectiveTo.getTime() < at.getTime()) return false;
  return true;
}

function clamp(n: number, min?: number | null, max?: number | null): number {
  let x = n;
  if (min != null && !Number.isNaN(min)) x = Math.max(x, min);
  if (max != null && !Number.isNaN(max)) x = Math.min(x, max);
  return x;
}

/** Min / max / MRP from product catalog (for staff batch sell price clamping). */
async function getCatalogPriceBoundsForVariant(params: { orgId: number; variantId: number; at: Date }): Promise<{
  min: number | null;
  max: number | null;
  mrp: number | null;
}> {
  const pp = await prisma.productPricing.findUnique({
    where: { orgId_variantId: { orgId: params.orgId, variantId: params.variantId } },
  });
  if (!pp || !isEffective(pp.effectiveFrom, pp.effectiveTo, params.at)) {
    return { min: null, max: null, mrp: null };
  }
  return {
    min: pp.minPrice != null ? Number(pp.minPrice) : null,
    max: pp.maxPrice != null ? Number(pp.maxPrice) : null,
    mrp: pp.mrp != null ? Number(pp.mrp) : null,
  };
}

function clampPriceToProductBounds(
  n: number,
  bounds: { min: number | null; max: number | null; mrp: number | null }
): number {
  const upper = bounds.mrp != null && bounds.max != null ? Math.min(bounds.mrp, bounds.max) : bounds.mrp ?? bounds.max;
  return clamp(n, bounds.min, upper);
}

/**
 * Catalog resolution only (backward compatible).
 */
export async function resolveSellingPrice(params: {
  orgId: number;
  variantId: number;
  branchId?: number | null;
  locationId?: number | null;
  at?: Date;
}): Promise<ResolvedPrice> {
  const at = params.at ?? new Date();
  const breakdown: ResolvedPrice["breakdown"] = {};

  if (params.branchId != null) {
    const bp = await prisma.branchPricing.findUnique({
      where: {
        branchId_variantId: { branchId: params.branchId, variantId: params.variantId },
      },
    });
    if (bp && isEffective(bp.effectiveFrom, bp.effectiveTo, at)) {
      const p = Number(bp.overridePrice);
      breakdown.branchOverride = p;
      return { price: p, source: "BRANCH_OVERRIDE", breakdown };
    }
  }

  const pp = await prisma.productPricing.findUnique({
    where: {
      orgId_variantId: { orgId: params.orgId, variantId: params.variantId },
    },
  });
  if (pp && isEffective(pp.effectiveFrom, pp.effectiveTo, at)) {
    const base = pp.basePrice != null ? Number(pp.basePrice) : null;
    breakdown.basePrice = base ?? undefined;
    breakdown.markupPercent = pp.markupPercent != null ? Number(pp.markupPercent) : undefined;
    if (base != null) {
      const markup = pp.markupPercent != null ? Number(pp.markupPercent) : 0;
      let after = base * (1 + markup / 100);
      breakdown.afterMarkup = after;
      const minP = pp.minPrice != null ? Number(pp.minPrice) : null;
      const maxP = pp.maxPrice != null ? Number(pp.maxPrice) : null;
      const mrp = pp.mrp != null ? Number(pp.mrp) : null;
      if (mrp != null) breakdown.mrp = mrp;
      const upperCap = mrp != null && maxP != null ? Math.min(mrp, maxP) : mrp ?? maxP;
      after = clamp(after, minP, upperCap);
      breakdown.minPrice = minP ?? undefined;
      breakdown.maxPrice = maxP ?? undefined;
      return { price: after, source: "PRODUCT_PRICING", breakdown };
    }
  }

  if (params.locationId != null) {
    const lp = await prisma.locationPrice.findUnique({
      where: {
        locationId_variantId: { locationId: params.locationId, variantId: params.variantId },
      },
    });
    if (lp && isEffective(lp.effectiveFrom, lp.effectiveTo, at)) {
      const p = Number(lp.price);
      breakdown.locationPrice = p;
      return { price: p, source: "LOCATION_PRICE", breakdown };
    }
  }

  return { price: null, source: "NONE", breakdown };
}

/**
 * POS / checkout: catalog list + enterprise layers + optional batch clearance price (min).
 */
export async function resolveSellingPriceWithEnterprise(params: {
  orgId: number;
  variantId: number;
  branchId: number | null;
  locationId?: number | null;
  shopLocationId?: number | null;
  at?: Date;
  membershipTierId?: number | null;
  membershipTierDiscountPercent?: number | null;
  /** Narrow batch promo evaluation to a single on-hand lot (simulation / support). */
  lotId?: number | null;
}): Promise<ResolvedPrice> {
  const core = await resolveSellingPrice({
    orgId: params.orgId,
    variantId: params.variantId,
    branchId: params.branchId ?? undefined,
    locationId: params.locationId ?? undefined,
    at: params.at,
  });
  if (core.price == null || !(core.price > 0)) {
    if (params.branchId != null) {
      const batch = await findBestBatchPromoPrice({
        orgId: params.orgId,
        branchId: params.branchId,
        variantId: params.variantId,
        shopLocationId: params.shopLocationId ?? params.locationId ?? null,
        at: params.at,
        lotId: params.lotId ?? null,
      });
      if (batch?.sellsAtRulePrice && batch.promoPrice > 0) {
        const bounds = await getCatalogPriceBoundsForVariant({
          orgId: params.orgId,
          variantId: params.variantId,
          at: params.at ?? new Date(),
        });
        const afterClamp = clampPriceToProductBounds(batch.promoPrice, bounds);
        if (afterClamp > 0) {
          return {
            price: Math.round(afterClamp * 100) / 100,
            source: core.source,
            breakdown: { ...core.breakdown, batchPromo: afterClamp },
          };
        }
      }
    }
    return core;
  }

  const variant = await prisma.productVariant.findUnique({
    where: { id: params.variantId },
    select: {
      id: true,
      productId: true,
      product: { select: { id: true, brandId: true, categoryId: true } },
    },
  });
  if (!variant?.product) {
    return core;
  }

  const policy = await getOrCreateOrgPolicy(params.orgId);
  const layers = await applyEnterpriseListPriceLayers({
    orgId: params.orgId,
    branchId: params.branchId,
    variantId: params.variantId,
    productId: variant.productId,
    brandId: variant.product.brandId,
    categoryId: variant.product.categoryId,
    coreListPrice: core.price,
    policy,
    membershipTierId: params.membershipTierId ?? null,
    membershipTierDiscountPercent: params.membershipTierDiscountPercent ?? null,
    at: params.at,
  });

  let list = layers.listPrice;
  const breakdown = { ...core.breakdown, enterpriseList: list };
  const enterpriseTrace = layers.trace;
  const enterpriseDiagnostics = layers.diagnostics;

  if (params.branchId != null) {
    const batch = await findBestBatchPromoPrice({
      orgId: params.orgId,
      branchId: params.branchId,
      variantId: params.variantId,
      shopLocationId: params.shopLocationId ?? params.locationId ?? null,
      at: params.at,
      lotId: params.lotId ?? null,
    });
    if (batch && batch.promoPrice > 0) {
      if (batch.sellsAtRulePrice) {
        const bounds = await getCatalogPriceBoundsForVariant({
          orgId: params.orgId,
          variantId: params.variantId,
          at: params.at ?? new Date(),
        });
        const afterClamp = clampPriceToProductBounds(batch.promoPrice, bounds);
        breakdown.batchPromo = afterClamp;
        const before = list;
        list = afterClamp;
        enterpriseTrace.push({
          kind: "BATCH_PROMO",
          label: `Batch list price (rule ${batch.ruleId}, sellsAtRulePrice)`,
          priceBefore: before,
          priceAfter: list,
          meta: { lotId: batch.lotId, ruleId: batch.ruleId, sellsAtRulePrice: true },
        });
      } else if (batch.promoPrice < list - 1e-6) {
        breakdown.batchPromo = batch.promoPrice;
        list = batch.promoPrice;
        enterpriseTrace.push({
          kind: "BATCH_PROMO",
          label: `Batch promo (rule ${batch.ruleId})`,
          priceBefore: layers.listPrice,
          priceAfter: list,
          meta: { lotId: batch.lotId, ruleId: batch.ruleId },
        });
      }
    }
  }

  return {
    price: Math.round(list * 100) / 100,
    source: core.source,
    breakdown,
    enterpriseTrace,
    enterpriseDiagnostics,
  };
}

module.exports = {
  resolveSellingPrice,
  resolveSellingPriceWithEnterprise,
};
