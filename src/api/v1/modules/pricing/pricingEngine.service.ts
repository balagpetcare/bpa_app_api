/**
 * Resolves selling price: BranchPricing override → ProductPricing (base + markup + min/max) → LocationPrice.
 */
import prisma from "../../../../infrastructure/db/prismaClient";

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
    locationPrice?: number;
  };
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

/**
 * @param orgId - product org
 * @param variantId - SKU
 * @param branchId - optional branch for BranchPricing
 * @param locationId - optional shop location for LocationPrice fallback
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
      after = clamp(after, pp.minPrice != null ? Number(pp.minPrice) : null, pp.maxPrice != null ? Number(pp.maxPrice) : null);
      breakdown.minPrice = pp.minPrice != null ? Number(pp.minPrice) : undefined;
      breakdown.maxPrice = pp.maxPrice != null ? Number(pp.maxPrice) : undefined;
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

module.exports = {
  resolveSellingPrice,
};
