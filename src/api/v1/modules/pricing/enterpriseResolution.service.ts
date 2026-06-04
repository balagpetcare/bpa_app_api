/**
 * Enterprise list-price layers: discount rules, campaigns, optional membership tier %.
 * Used by pricing engine and POS snapshot trace.
 */
import type { OrgPricingPolicy, Prisma } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
import { batchPricingRuleAppliesToBranch } from "./batchPricingBranchScope.util";

export type ResolutionTraceStep = {
  kind: "CORE" | "ENTERPRISE_RULE" | "CAMPAIGN" | "MEMBERSHIP_TIER" | "BATCH_PROMO";
  label: string;
  priceBefore: number;
  priceAfter: number;
  meta?: Record<string, unknown>;
};

export type EnterpriseLayerDiagnostics = {
  enterpriseRulesLoaded: number;
  enterpriseRulesConsidered: number;
  enterpriseRulesApplied: number;
  campaignsLoaded: number;
  campaignsConsidered: number;
  campaignsApplied: number;
  membershipApplied: boolean;
};

export type EnterpriseResolutionResult = {
  listPrice: number;
  trace: ResolutionTraceStep[];
  diagnostics: EnterpriseLayerDiagnostics;
};

function clamp(n: number, min?: number | null, max?: number | null): number {
  let x = n;
  if (min != null && !Number.isNaN(min)) x = Math.max(x, min);
  if (max != null && !Number.isNaN(max)) x = Math.min(x, max);
  return x;
}

function ruleMatchesTarget(
  targetKind: string,
  targetId: number | null,
  ctx: { variantId: number; brandId: number | null; categoryId: number | null }
): boolean {
  if (targetKind === "ALL_PRODUCTS") return true;
  if (targetKind === "VARIANT") return targetId === ctx.variantId;
  if (targetKind === "BRAND") return ctx.brandId != null && targetId === ctx.brandId;
  if (targetKind === "CATEGORY") return ctx.categoryId != null && targetId === ctx.categoryId;
  return false;
}

function applyDiscountMethod(
  method: string,
  value: number,
  current: number,
  maxCap: number | null
): number {
  let next = current;
  if (method === "PERCENT") {
    next = current * (1 - value / 100);
  } else if (method === "FIXED_AMOUNT") {
    next = current - value;
  } else if (method === "FIXED_PRICE") {
    next = value;
  }
  if (maxCap != null && current - next > maxCap + 1e-6) {
    next = current - maxCap;
  }
  return Math.max(0, next);
}

/**
 * After core catalog list price is known, apply enterprise rules, campaigns, membership.
 */
export async function applyEnterpriseListPriceLayers(params: {
  orgId: number;
  branchId: number | null;
  variantId: number;
  productId: number;
  brandId: number | null;
  categoryId: number | null;
  coreListPrice: number;
  policy: OrgPricingPolicy;
  /** When set, loads tier discount, exclusions, and optional branch scopes (org must match). */
  membershipTierId?: number | null;
  /** Optional tier discount % when no tier id (e.g. manual simulate). Ignored when membershipTierId resolves. */
  membershipTierDiscountPercent?: number | null;
  at?: Date;
}): Promise<EnterpriseResolutionResult> {
  const at = params.at ?? new Date();
  const trace: ResolutionTraceStep[] = [
    {
      kind: "CORE",
      label: "Catalog list (branch override / org pricing / location)",
      priceBefore: params.coreListPrice,
      priceAfter: params.coreListPrice,
    },
  ];
  let current = params.coreListPrice;
  if (!(current > 0)) {
    return {
      listPrice: current,
      trace,
      diagnostics: {
        enterpriseRulesLoaded: 0,
        enterpriseRulesConsidered: 0,
        enterpriseRulesApplied: 0,
        campaignsLoaded: 0,
        campaignsConsidered: 0,
        campaignsApplied: 0,
        membershipApplied: false,
      },
    };
  }

  const rules = await prisma.enterpriseDiscountRule.findMany({
    where: {
      orgId: params.orgId,
      status: "ACTIVE",
      OR: [{ validTo: null }, { validTo: { gte: at } }],
      validFrom: { lte: at },
    },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
  });

  const ctx = {
    variantId: params.variantId,
    brandId: params.brandId,
    categoryId: params.categoryId,
  };

  let enterpriseRulesConsidered = 0;
  for (const r of rules) {
    if (r.scopeKind === "BRANCH_SPECIFIC") {
      if (r.scopeBranchId == null || r.scopeBranchId !== params.branchId) continue;
    }
    if (!ruleMatchesTarget(r.targetKind, r.targetId, ctx)) continue;
    enterpriseRulesConsidered += 1;

    const before = current;
    const cap = r.maxCapAmount != null ? Number(r.maxCapAmount) : null;
    current = applyDiscountMethod(r.discountMethod, Number(r.discountValue), before, cap);
    current = clamp(current, 0, before);
    trace.push({
      kind: "ENTERPRISE_RULE",
      label: r.name,
      priceBefore: before,
      priceAfter: current,
      meta: { ruleId: r.id, method: r.discountMethod },
    });
    if (!r.stackable) break;
  }

  const campaigns = await prisma.pricingCampaign.findMany({
    where: {
      orgId: params.orgId,
      status: "ACTIVE",
      startDate: { lte: at },
      endDate: { gte: at },
    },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
    include: { scopes: true },
  });

  let campaignsConsidered = 0;
  for (const c of campaigns) {
    if (c.scopes.length > 0) {
      const ok = c.scopes.some((s) => {
        if (!s.included) return false;
        if (s.scopeKind === "VARIANT") return s.scopeId === params.variantId;
        if (s.scopeKind === "BRAND") return params.brandId === s.scopeId;
        if (s.scopeKind === "CATEGORY") return params.categoryId === s.scopeId;
        if (s.scopeKind === "BRANCH") return params.branchId === s.scopeId;
        return false;
      });
      if (!ok) continue;
    }
    campaignsConsidered += 1;
    const before = current;
    const cap = c.maxCapAmount != null ? Number(c.maxCapAmount) : null;
    current = applyDiscountMethod(c.discountMethod, Number(c.discountValue), before, cap);
    current = clamp(current, 0, before);
    trace.push({
      kind: "CAMPAIGN",
      label: c.name,
      priceBefore: before,
      priceAfter: current,
      meta: { campaignId: c.id },
    });
    // Stacking: policy off → single campaign only. Policy on → multiple stackable campaigns may apply; non-stackable campaign ends the chain.
    if (!params.policy.allowCampaignStacking) break;
    if (!c.stackable) break;
  }

  let tierPct: number | null = null;
  let tierLabel = "Membership tier";
  let tierMaxDiscountPerItem: number | null = null;

  if (params.membershipTierId != null) {
    const tier = await prisma.membershipTier.findFirst({
      where: { id: params.membershipTierId, orgId: params.orgId, status: "ACTIVE" },
      include: { exclusions: true, branchScopes: true },
    });
    if (tier) {
      let branchOk = true;
      if (tier.branchScopes.length > 0) {
        if (params.branchId == null) branchOk = false;
        else if (!tier.branchScopes.some((s) => s.branchId === params.branchId)) branchOk = false;
      }
      if (branchOk) {
        const excluded = tier.exclusions.some((ex) => {
          if (ex.excludeKind === "VARIANT") return ex.excludeId === params.variantId;
          if (ex.excludeKind === "BRAND") return params.brandId != null && ex.excludeId === params.brandId;
          if (ex.excludeKind === "CATEGORY") return params.categoryId != null && ex.excludeId === params.categoryId;
          return false;
        });
        if (!excluded) {
          tierPct = Number(tier.discountPercent);
          tierLabel = `Membership tier "${tier.name}"`;
          tierMaxDiscountPerItem = tier.maxDiscountPerItem != null ? Number(tier.maxDiscountPerItem) : null;
        }
      }
    }
  } else if (params.membershipTierDiscountPercent != null) {
    tierPct = params.membershipTierDiscountPercent;
    tierLabel = `Membership ${tierPct}%`;
  }

  if (tierPct != null && tierPct > 0 && tierPct <= 100) {
    const before = current;
    let next = before * (1 - tierPct / 100);
    let meta: Record<string, unknown> | undefined =
      params.membershipTierId != null ? { membershipTierId: params.membershipTierId } : undefined;
    if (tierMaxDiscountPerItem != null && tierMaxDiscountPerItem >= 0) {
      const discountAmt = before - next;
      if (discountAmt > tierMaxDiscountPerItem + 1e-6) {
        next = before - tierMaxDiscountPerItem;
        meta = { ...(meta ?? {}), perItemDiscountCap: tierMaxDiscountPerItem, capApplied: true };
      }
    }
    current = next;
    trace.push({
      kind: "MEMBERSHIP_TIER",
      label: tierLabel,
      priceBefore: before,
      priceAfter: current,
      meta,
    });
  }

  const listPrice = Math.round(current * 100) / 100;
  const enterpriseRulesApplied = trace.filter((t) => t.kind === "ENTERPRISE_RULE").length;
  const campaignsApplied = trace.filter((t) => t.kind === "CAMPAIGN").length;
  const membershipApplied = trace.some((t) => t.kind === "MEMBERSHIP_TIER");
  return {
    listPrice,
    trace,
    diagnostics: {
      enterpriseRulesLoaded: rules.length,
      enterpriseRulesConsidered,
      enterpriseRulesApplied,
      campaignsLoaded: campaigns.length,
      campaignsConsidered,
      campaignsApplied,
      membershipApplied,
    },
  };
}

/** Best active batch promo price for variant at branch shop lots (optional). */
export async function findBestBatchPromoPrice(params: {
  orgId: number;
  branchId: number;
  variantId: number;
  shopLocationId: number | null;
  at?: Date;
  /** When set, only this lot is considered (must be on-hand at shopLocationId). */
  lotId?: number | null;
}): Promise<{
  promoPrice: number;
  ruleId: number;
  lotId: number;
  /** When true, POS should use promoPrice (after catalog min/max clamp) as the sell price, not only as clearance below list. */
  sellsAtRulePrice: boolean;
} | null> {
  const at = params.at ?? new Date();
  if (!params.shopLocationId) return null;
  const policy = await prisma.orgPricingPolicy.findUnique({ where: { orgId: params.orgId } });
  if (!policy?.batchPricingEnabled) return null;

  const balances = await prisma.stockLotBalance.findMany({
    where: { locationId: params.shopLocationId, onHandQty: { gt: 0 } },
    select: { lotId: true },
  });
  let lotIds = balances.map((b) => b.lotId);
  if (lotIds.length === 0) return null;

  if (params.lotId != null) {
    if (!lotIds.includes(params.lotId)) return null;
    lotIds = [params.lotId];
  }

  const rules = await prisma.batchPricingRule.findMany({
    where: {
      orgId: params.orgId,
      variantId: params.variantId,
      status: "ACTIVE",
      lotId: { in: lotIds },
      validFrom: { lte: at },
      OR: [{ validTo: null }, { validTo: { gte: at } }],
    },
    include: { lot: { select: { id: true, expDate: true } } },
  });
  let best: { promoPrice: number; ruleId: number; lotId: number; sellsAtRulePrice: boolean } | null = null;
  for (const r of rules) {
    if (!batchPricingRuleAppliesToBranch(r.branchId, params.branchId)) continue;
    const p = r.promoPrice != null ? Number(r.promoPrice) : r.recommendedSellPrice != null ? Number(r.recommendedSellPrice) : null;
    if (p == null || !(p > 0)) continue;
    const sellsAt = (r as { sellsAtRulePrice?: boolean }).sellsAtRulePrice === true;
    if (!best || p < best.promoPrice) {
      best = { promoPrice: p, ruleId: r.id, lotId: r.lotId, sellsAtRulePrice: sellsAt };
    }
  }
  return best;
}

export function traceToJson(trace: ResolutionTraceStep[]): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(trace)) as Prisma.InputJsonValue;
}
