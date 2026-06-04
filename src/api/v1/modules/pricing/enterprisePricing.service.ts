/**
 * Enterprise pricing: discount rules, membership, campaigns, branch workflow, schedules, batch, analytics.
 */
import type {
  BatchPricingRuleStatus,
  BranchOverrideRequestStatus,
  EnterpriseDiscountMethod,
  EnterpriseDiscountRuleKind,
  EnterpriseDiscountScopeKind,
  EnterpriseDiscountTargetKind,
  PriceApprovalTriggerKind,
  PriceScheduleStatus,
  PricingCampaignStatus,
  PricingCampaignType,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
import { parse } from "csv-parse/sync";
import { logPricingAudit, getOrCreateOrgPolicy } from "./pricingGovernance.service";
import { resolveSellingPrice, resolveSellingPriceWithEnterprise } from "./pricingEngine.service";
import { validateRetailDiscountLine } from "./retailDiscount.service";
import {
  buildRichResolutionTimeline,
  buildUnifiedResolutionEnvelope,
  type GovernanceLinePreview,
} from "./unifiedPriceResolution.service";

export async function assertOrgAccess(userId: number, orgId: number): Promise<boolean> {
  const m = await prisma.orgMember.findFirst({
    where: { userId, orgId, status: "ACTIVE" },
    select: { id: true },
  });
  return !!m;
}

/** --- Enterprise discount rules --- */
export type ListEnterpriseDiscountRulesFilters = {
  /** When set, list is restricted to this rule id (for owner edit-page deep links). */
  ruleId?: number;
  q?: string;
  /** Comma-separated statuses; omit or empty = all */
  status?: string;
  targetKind?: EnterpriseDiscountTargetKind | string;
  scopeKind?: EnterpriseDiscountScopeKind | string;
  stackable?: boolean;
  /** priority_asc | priority_desc | updated_desc | updated_asc | name_asc */
  sort?: string;
  /** current = ACTIVE and within validFrom/validTo window at `at`; expired = validTo before `at`; scheduled = validFrom after `at` */
  effective?: "current" | "expired" | "scheduled";
  /** Reference time for effective filter (ISO string) */
  at?: Date;
};

export async function listEnterpriseDiscountRules(
  orgId: number,
  page = 1,
  limit = 50,
  filters: ListEnterpriseDiscountRulesFilters = {}
) {
  const take = Math.min(Math.max(limit, 1), 200);
  const skip = (Math.max(page, 1) - 1) * take;

  const where: Prisma.EnterpriseDiscountRuleWhereInput = { orgId };
  if (filters.ruleId != null && Number.isFinite(filters.ruleId)) {
    where.id = filters.ruleId;
  }
  const q = filters.q?.trim();
  if (q) {
    where.name = { contains: q, mode: "insensitive" };
  }
  const statusRaw = filters.status?.trim();
  const effEarly = filters.effective?.toLowerCase();
  if (statusRaw && effEarly !== "current") {
    const parts = statusRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 1) {
      where.status = parts[0];
    } else if (parts.length > 1) {
      where.status = { in: parts };
    }
  }
  if (filters.targetKind) {
    where.targetKind = filters.targetKind as EnterpriseDiscountTargetKind;
  }
  if (filters.scopeKind) {
    where.scopeKind = filters.scopeKind as EnterpriseDiscountScopeKind;
  }
  if (filters.stackable === true || filters.stackable === false) {
    where.stackable = filters.stackable;
  }

  const at = filters.at ?? new Date();
  const eff = effEarly;
  const andExtra: Prisma.EnterpriseDiscountRuleWhereInput[] = [];
  if (eff === "current") {
    where.status = "ACTIVE";
    andExtra.push({ validFrom: { lte: at } }, { OR: [{ validTo: null }, { validTo: { gte: at } }] });
  } else if (eff === "expired") {
    andExtra.push({ validTo: { lt: at } });
  } else if (eff === "scheduled") {
    andExtra.push({ validFrom: { gt: at } });
  }
  if (andExtra.length) {
    where.AND = andExtra;
  }

  const sortKey = (filters.sort || "priority_asc").toLowerCase();
  let orderBy: Prisma.EnterpriseDiscountRuleOrderByWithRelationInput[] = [{ priority: "asc" }, { id: "desc" }];
  if (sortKey === "priority_desc") orderBy = [{ priority: "desc" }, { id: "desc" }];
  else if (sortKey === "updated_desc") orderBy = [{ updatedAt: "desc" }, { id: "desc" }];
  else if (sortKey === "updated_asc") orderBy = [{ updatedAt: "asc" }, { id: "asc" }];
  else if (sortKey === "name_asc") orderBy = [{ name: "asc" }, { id: "asc" }];

  const [items, total] = await Promise.all([
    prisma.enterpriseDiscountRule.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        scopeBranch: { select: { id: true, name: true } },
        createdBy: { select: { id: true, profile: { select: { displayName: true } } } },
      },
    }),
    prisma.enterpriseDiscountRule.count({ where }),
  ]);
  return { items, total, page: Math.max(page, 1), limit: take };
}

export async function upsertEnterpriseDiscountRule(
  orgId: number,
  body: {
    id?: number;
    name: string;
    ruleKind: EnterpriseDiscountRuleKind;
    scopeKind?: EnterpriseDiscountScopeKind;
    scopeBranchId?: number | null;
    targetKind: EnterpriseDiscountTargetKind;
    targetId?: number | null;
    discountMethod: EnterpriseDiscountMethod;
    discountValue: number;
    maxCapAmount?: number | null;
    minQtyForSlab?: number | null;
    stackable?: boolean;
    priority?: number;
    requiresApproval?: boolean;
    validFrom?: Date | null;
    validTo?: Date | null;
    status?: string;
  },
  actorUserId: number | null
) {
  const data: Prisma.EnterpriseDiscountRuleUncheckedCreateInput = {
    orgId,
    name: body.name,
    ruleKind: body.ruleKind,
    scopeKind: body.scopeKind ?? "ORG_WIDE",
    scopeBranchId: body.scopeBranchId ?? null,
    targetKind: body.targetKind,
    targetId: body.targetId ?? null,
    discountMethod: body.discountMethod,
    discountValue: body.discountValue,
    maxCapAmount: body.maxCapAmount ?? null,
    minQtyForSlab: body.minQtyForSlab ?? null,
    stackable: body.stackable ?? false,
    priority: body.priority ?? 100,
    requiresApproval: body.requiresApproval ?? false,
    validFrom: body.validFrom ?? new Date(),
    validTo: body.validTo ?? null,
    status: body.status ?? "ACTIVE",
    createdByUserId: actorUserId ?? undefined,
  };

  let row;
  if (body.id) {
    const ex = await prisma.enterpriseDiscountRule.findFirst({ where: { id: body.id, orgId } });
    if (!ex) throw new Error("Rule not found");
    row = await prisma.enterpriseDiscountRule.update({
      where: { id: body.id },
      data: {
        name: data.name,
        ruleKind: data.ruleKind,
        scopeKind: data.scopeKind,
        scopeBranchId: data.scopeBranchId,
        targetKind: data.targetKind,
        targetId: data.targetId,
        discountMethod: data.discountMethod,
        discountValue: data.discountValue,
        maxCapAmount: data.maxCapAmount,
        minQtyForSlab: data.minQtyForSlab,
        stackable: data.stackable,
        priority: data.priority,
        requiresApproval: data.requiresApproval,
        validFrom: data.validFrom,
        validTo: data.validTo,
        status: data.status,
      },
    });
  } else {
    row = await prisma.enterpriseDiscountRule.create({ data });
  }
  await logPricingAudit({
    orgId,
    entityType: "ORG_PRICING_POLICY",
    entityKey: `enterprise_rule:${row.id}`,
    action: body.id ? "ENTERPRISE_RULE_UPDATE" : "ENTERPRISE_RULE_CREATE",
    actorUserId,
    payloadAfter: row,
  });
  return row;
}

export async function patchEnterpriseDiscountRuleStatus(orgId: number, id: number, status: string, actorUserId: number | null) {
  const ex = await prisma.enterpriseDiscountRule.findFirst({ where: { id, orgId } });
  if (!ex) throw new Error("Rule not found");
  const row = await prisma.enterpriseDiscountRule.update({
    where: { id },
    data: { status },
  });
  await logPricingAudit({
    orgId,
    entityType: "ORG_PRICING_POLICY",
    entityKey: `enterprise_rule:${id}`,
    action: "ENTERPRISE_RULE_STATUS",
    actorUserId,
    payloadBefore: ex,
    payloadAfter: row,
  });
  return row;
}

/** --- Membership tiers --- */
export async function listMembershipTiers(orgId: number) {
  return prisma.membershipTier.findMany({
    where: { orgId },
    orderBy: { name: "asc" },
    include: {
      exclusions: true,
      branchScopes: { include: { branch: { select: { id: true, name: true } } } },
      ownerDiscountCards: { select: { id: true, cardNumber: true, status: true } },
    },
  });
}

/** Owner discount cards for linking to membership tiers (org-scoped). */
export async function listOwnerDiscountCardsForMembership(orgId: number, take = 300) {
  return prisma.ownerDiscountCard.findMany({
    where: { orgId },
    orderBy: { id: "desc" },
    take: Math.min(Math.max(take, 1), 500),
    select: {
      id: true,
      cardNumber: true,
      status: true,
      membershipTierId: true,
      branchId: true,
      discountPercent: true,
      expiresAt: true,
    },
  });
}

export async function upsertMembershipTier(
  orgId: number,
  body: {
    id?: number;
    name: string;
    discountPercent: number;
    maxDiscountPerItem?: number | null;
    maxDiscountPerInvoice?: number | null;
    stackWithPromo?: boolean;
    stackWithBrandDiscount?: boolean;
    status?: string;
  }
) {
  if (body.id) {
    const ex = await prisma.membershipTier.findFirst({ where: { id: body.id, orgId } });
    if (!ex) throw new Error("Tier not found");
    return prisma.membershipTier.update({
      where: { id: body.id },
      data: {
        name: body.name,
        discountPercent: body.discountPercent,
        maxDiscountPerItem: body.maxDiscountPerItem ?? null,
        maxDiscountPerInvoice: body.maxDiscountPerInvoice ?? null,
        stackWithPromo: body.stackWithPromo ?? false,
        stackWithBrandDiscount: body.stackWithBrandDiscount ?? false,
        status: body.status ?? "ACTIVE",
      },
    });
  }
  return prisma.membershipTier.create({
    data: {
      orgId,
      name: body.name,
      discountPercent: body.discountPercent,
      maxDiscountPerItem: body.maxDiscountPerItem ?? null,
      maxDiscountPerInvoice: body.maxDiscountPerInvoice ?? null,
      stackWithPromo: body.stackWithPromo ?? false,
      stackWithBrandDiscount: body.stackWithBrandDiscount ?? false,
      status: body.status ?? "ACTIVE",
    },
  });
}

export async function setMembershipTierExclusions(tierId: number, orgId: number, exclusions: Array<{ excludeKind: string; excludeId: number }>) {
  const tier = await prisma.membershipTier.findFirst({ where: { id: tierId, orgId } });
  if (!tier) throw new Error("Tier not found");
  await prisma.membershipTierExclusion.deleteMany({ where: { tierId } });
  if (exclusions.length === 0) return tier;
  await prisma.membershipTierExclusion.createMany({
    data: exclusions.map((e) => ({ tierId, excludeKind: e.excludeKind, excludeId: e.excludeId })),
  });
  return prisma.membershipTier.findUnique({ where: { id: tierId }, include: { exclusions: true } });
}

export async function setMembershipTierBranchScopes(tierId: number, orgId: number, branchIds: number[]) {
  const tier = await prisma.membershipTier.findFirst({ where: { id: tierId, orgId } });
  if (!tier) throw new Error("Tier not found");
  await prisma.membershipTierBranchScope.deleteMany({ where: { tierId } });
  if (branchIds.length === 0) return tier;
  await prisma.membershipTierBranchScope.createMany({
    data: branchIds.map((branchId) => ({ tierId, branchId })),
  });
  return prisma.membershipTier.findUnique({ where: { id: tierId }, include: { branchScopes: true } });
}

export async function linkOwnerDiscountCardToTier(orgId: number, cardId: number, membershipTierId: number | null) {
  const card = await prisma.ownerDiscountCard.findFirst({ where: { id: cardId, orgId } });
  if (!card) throw new Error("Card not found");
  if (membershipTierId != null) {
    const t = await prisma.membershipTier.findFirst({ where: { id: membershipTierId, orgId } });
    if (!t) throw new Error("Tier not found");
  }
  return prisma.ownerDiscountCard.update({
    where: { id: cardId },
    data: { membershipTierId },
  });
}

/** --- Campaigns --- */
export async function listPricingCampaigns(orgId: number) {
  return prisma.pricingCampaign.findMany({
    where: { orgId },
    orderBy: { updatedAt: "desc" },
    include: { scopes: true },
  });
}

export async function upsertPricingCampaign(
  orgId: number,
  body: {
    id?: number;
    name: string;
    code?: string | null;
    campaignType?: PricingCampaignType;
    discountMethod: EnterpriseDiscountMethod;
    discountValue: number;
    maxCapAmount?: number | null;
    priority?: number;
    stackable?: boolean;
    startDate: Date;
    endDate: Date;
    status?: PricingCampaignStatus;
    budgetAmount?: number | null;
    scopes?: Array<{ scopeKind: string; scopeId: number; included?: boolean }>;
  },
  actorUserId: number | null
) {
  const base = {
    orgId,
    name: body.name,
    code: body.code ?? null,
    campaignType: body.campaignType ?? "OTHER",
    discountMethod: body.discountMethod,
    discountValue: body.discountValue,
    maxCapAmount: body.maxCapAmount ?? null,
    priority: body.priority ?? 50,
    stackable: body.stackable ?? false,
    startDate: body.startDate,
    endDate: body.endDate,
    status: body.status ?? "DRAFT",
    budgetAmount: body.budgetAmount ?? null,
    createdByUserId: actorUserId ?? undefined,
  };

  let camp;
  if (body.id) {
    const ex = await prisma.pricingCampaign.findFirst({ where: { id: body.id, orgId } });
    if (!ex) throw new Error("Campaign not found");
    camp = await prisma.pricingCampaign.update({
      where: { id: body.id },
      data: base,
    });
  } else {
    camp = await prisma.pricingCampaign.create({ data: base });
  }
  if (body.scopes) {
    await prisma.pricingCampaignScope.deleteMany({ where: { campaignId: camp.id } });
    if (body.scopes.length) {
      await prisma.pricingCampaignScope.createMany({
        data: body.scopes.map((s) => ({
          campaignId: camp.id,
          scopeKind: s.scopeKind,
          scopeId: s.scopeId,
          included: s.included !== false,
        })),
      });
    }
  }
  return prisma.pricingCampaign.findUnique({ where: { id: camp.id }, include: { scopes: true } });
}

export async function patchCampaignStatus(orgId: number, id: number, status: PricingCampaignStatus) {
  const ex = await prisma.pricingCampaign.findFirst({ where: { id, orgId } });
  if (!ex) throw new Error("Campaign not found");
  return prisma.pricingCampaign.update({ where: { id }, data: { status } });
}

/** --- Approval matrix --- */
export async function listApprovalMatrix(orgId: number) {
  return prisma.priceApprovalMatrixRow.findMany({ where: { orgId }, orderBy: { triggerKind: "asc" } });
}

export async function upsertApprovalMatrixRow(
  orgId: number,
  body: { triggerKind: PriceApprovalTriggerKind; roleKey: string; maxApprovalPercent?: number | null; maxApprovalAmount?: number | null }
) {
  return prisma.priceApprovalMatrixRow.upsert({
    where: {
      orgId_triggerKind_roleKey: { orgId, triggerKind: body.triggerKind, roleKey: body.roleKey },
    },
    create: {
      orgId,
      triggerKind: body.triggerKind,
      roleKey: body.roleKey,
      maxApprovalPercent: body.maxApprovalPercent ?? null,
      maxApprovalAmount: body.maxApprovalAmount ?? null,
    },
    update: {
      maxApprovalPercent: body.maxApprovalPercent ?? null,
      maxApprovalAmount: body.maxApprovalAmount ?? null,
    },
  });
}

export async function deleteApprovalMatrixRow(orgId: number, id: number) {
  const row = await prisma.priceApprovalMatrixRow.findFirst({ where: { id, orgId } });
  if (!row) throw new Error("Row not found");
  await prisma.priceApprovalMatrixRow.delete({ where: { id } });
}

/** --- Branch override requests --- */
export async function createBranchOverrideRequest(
  orgId: number,
  data: { branchId: number; variantId: number; requestedPrice: number; reason?: string | null },
  requestedByUserId: number
) {
  const branch = await prisma.branch.findFirst({ where: { id: data.branchId, orgId } });
  if (!branch) throw new Error("Branch not in org");
  const resolved = await resolveSellingPrice({ orgId, variantId: data.variantId, branchId: data.branchId, locationId: null });
  const currentPrice = resolved.price ?? 0;
  return prisma.branchOverrideRequest.create({
    data: {
      orgId,
      branchId: data.branchId,
      variantId: data.variantId,
      currentPrice,
      requestedPrice: data.requestedPrice,
      reason: data.reason ?? null,
      requestedByUserId,
    },
    include: { variant: { select: { sku: true, title: true } }, branch: { select: { name: true } } },
  });
}

export async function listBranchOverrideRequests(orgId: number, opts?: { status?: string; branchId?: number }) {
  const where: Prisma.BranchOverrideRequestWhereInput = { orgId };
  if (opts?.status) where.status = opts.status as BranchOverrideRequestStatus;
  if (opts?.branchId != null) where.branchId = opts.branchId;
  return prisma.branchOverrideRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      variant: { select: { id: true, sku: true, title: true } },
      branch: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
}

export async function reviewBranchOverrideRequest(
  orgId: number,
  id: number,
  approve: boolean,
  reviewNote: string | null,
  reviewerUserId: number
) {
  const req = await prisma.branchOverrideRequest.findFirst({ where: { id, orgId, status: "PENDING" } });
  if (!req) throw new Error("Request not found or not pending");
  const status = approve ? "APPROVED" : "REJECTED";
  const updated = await prisma.branchOverrideRequest.update({
    where: { id },
    data: {
      status,
      reviewedByUserId: reviewerUserId,
      reviewedAt: new Date(),
      reviewNote: reviewNote ?? null,
    },
  });
  if (approve) {
    await prisma.branchPricing.upsert({
      where: { branchId_variantId: { branchId: req.branchId, variantId: req.variantId } },
      create: {
        branchId: req.branchId,
        variantId: req.variantId,
        overridePrice: Number(req.requestedPrice),
        effectiveFrom: new Date(),
        effectiveTo: null,
      },
      update: { overridePrice: Number(req.requestedPrice), effectiveFrom: new Date(), effectiveTo: null },
    });
  }
  return updated;
}

/** --- Emergency overrides --- */
export async function createPricingEmergencyOverride(
  orgId: number,
  data: { branchId: number; variantId: number; grantedUnitPrice: number; reason?: string | null; expiresAt: Date },
  createdByUserId: number
) {
  return prisma.pricingEmergencyOverride.create({
    data: {
      orgId,
      branchId: data.branchId,
      variantId: data.variantId,
      grantedUnitPrice: data.grantedUnitPrice,
      reason: data.reason ?? null,
      expiresAt: data.expiresAt,
      createdByUserId,
    },
  });
}

/** --- Price schedules --- */
export async function listPriceSchedules(orgId: number, opts?: { status?: string }) {
  const where: Prisma.PriceScheduleWhereInput = { orgId };
  if (opts?.status) where.status = opts.status as PriceScheduleStatus;
  return prisma.priceSchedule.findMany({
    where,
    orderBy: { effectiveAt: "asc" },
    take: 200,
    include: { variant: { select: { sku: true, title: true } } },
  });
}

export async function createPriceSchedule(
  orgId: number,
  data: {
    variantId: number;
    branchId?: number | null;
    newBasePrice?: number | null;
    newMinPrice?: number | null;
    newMaxPrice?: number | null;
    newMrp?: number | null;
    effectiveAt: Date;
  },
  createdByUserId: number | null
) {
  return prisma.priceSchedule.create({
    data: {
      orgId,
      variantId: data.variantId,
      branchId: data.branchId ?? null,
      newBasePrice: data.newBasePrice ?? null,
      newMinPrice: data.newMinPrice ?? null,
      newMaxPrice: data.newMaxPrice ?? null,
      newMrp: data.newMrp ?? null,
      effectiveAt: data.effectiveAt,
      createdByUserId: createdByUserId ?? undefined,
    },
  });
}

/** --- Batch rules --- */
export async function listBatchPricingRules(orgId: number, variantId?: number) {
  return prisma.batchPricingRule.findMany({
    where: { orgId, ...(variantId ? { variantId } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: {
      lot: { select: { id: true, lotCode: true, expDate: true } },
      variant: { select: { sku: true, title: true } },
      branch: { select: { id: true, name: true } },
    },
  });
}

export async function listStockLotsForVariant(orgId: number, variantId: number) {
  return prisma.stockLot.findMany({
    where: { orgId, variantId },
    orderBy: [{ expDate: "asc" }, { id: "asc" }],
    take: 150,
    select: { id: true, lotCode: true, expDate: true, mfgDate: true },
  });
}

/** Prisma throws this when the generated client predates `sellsAtRulePrice` but the DB column exists (or vice versa). */
function isStalePrismaClientUnknownSellsAtRulePrice(err: unknown): boolean {
  const m = String((err as { message?: string })?.message ?? "");
  return m.includes("sellsAtRulePrice") && (m.includes("Unknown argument") || m.includes("Unknown arg"));
}

async function syncSellsAtRulePriceColumn(ruleId: number, sellsAtRulePrice: boolean): Promise<void> {
  try {
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "batch_pricing_rules" SET "sellsAtRulePrice" = ${sellsAtRulePrice} WHERE "id" = ${ruleId}`
    );
  } catch {
    // Unmigrated DB (no column) — ignore.
  }
}

async function persistBatchPricingRuleCreate(data: Prisma.BatchPricingRuleUncheckedCreateInput) {
  try {
    return await prisma.batchPricingRule.create({ data });
  } catch (e) {
    if (!isStalePrismaClientUnknownSellsAtRulePrice(e)) throw e;
    const desired = data.sellsAtRulePrice === true;
    const { sellsAtRulePrice: _drop, ...rest } = data;
    void _drop;
    const row = await prisma.batchPricingRule.create({
      data: rest as Prisma.BatchPricingRuleUncheckedCreateInput,
    });
    await syncSellsAtRulePriceColumn(row.id, desired);
    return prisma.batchPricingRule.findUniqueOrThrow({ where: { id: row.id } });
  }
}

async function persistBatchPricingRuleUpdate(id: number, data: Prisma.BatchPricingRuleUncheckedUpdateInput) {
  try {
    return await prisma.batchPricingRule.update({ where: { id }, data });
  } catch (e) {
    if (!isStalePrismaClientUnknownSellsAtRulePrice(e)) throw e;
    const desired = data.sellsAtRulePrice === true;
    const { sellsAtRulePrice: _drop, ...rest } = data as Prisma.BatchPricingRuleUncheckedUpdateInput & {
      sellsAtRulePrice?: boolean;
    };
    void _drop;
    await prisma.batchPricingRule.update({
      where: { id },
      data: rest as Prisma.BatchPricingRuleUncheckedUpdateInput,
    });
    await syncSellsAtRulePriceColumn(id, desired);
    return prisma.batchPricingRule.findUniqueOrThrow({ where: { id } });
  }
}

export async function upsertBatchPricingRule(
  orgId: number,
  body: {
    id?: number;
    lotId: number;
    variantId: number;
    branchId?: number | null;
    recommendedSellPrice?: number | null;
    promoPrice?: number | null;
    liquidationReason?: string | null;
    isExpiryDriven?: boolean;
    /** When true, this rule's price is the sell price (min/max clamped) at POS for the lot, not only clearance below list. */
    sellsAtRulePrice?: boolean;
    validFrom?: Date;
    validTo?: Date | null;
    status?: BatchPricingRuleStatus;
  },
  actorUserId: number | null
) {
  const lot = await prisma.stockLot.findFirst({ where: { id: body.lotId, orgId } });
  if (!lot) throw new Error("Lot not found");
  if (body.branchId != null) {
    const br = await prisma.branch.findFirst({ where: { id: body.branchId, orgId } });
    if (!br) throw new Error("Branch not found for this organization");
  }
  const data = {
    orgId,
    lotId: body.lotId,
    variantId: body.variantId,
    branchId: body.branchId ?? null,
    recommendedSellPrice: body.recommendedSellPrice ?? null,
    promoPrice: body.promoPrice ?? null,
    liquidationReason: body.liquidationReason ?? null,
    isExpiryDriven: body.isExpiryDriven ?? false,
    sellsAtRulePrice: body.sellsAtRulePrice === true,
    validFrom: body.validFrom ?? new Date(),
    validTo: body.validTo ?? null,
    status: body.status ?? "ACTIVE",
  };
  if (body.id) {
    const ex = await prisma.batchPricingRule.findFirst({ where: { id: body.id, orgId } });
    if (!ex) throw new Error("Rule not found");
    const row = await persistBatchPricingRuleUpdate(body.id, data);
    await logPricingAudit({
      orgId,
      entityType: "BATCH_PRICING_RULE",
      entityKey: `batch_rule:${row.id}`,
      action: "UPDATE",
      actorUserId,
      payloadBefore: ex,
      payloadAfter: row,
    });
    return row;
  }
  const row = await persistBatchPricingRuleCreate(data);
  await logPricingAudit({
    orgId,
    entityType: "BATCH_PRICING_RULE",
    entityKey: `batch_rule:${row.id}`,
    action: "CREATE",
    actorUserId,
    payloadAfter: row,
  });
  return row;
}

/** Latest average unit cost from stock ledger IN for variant (org-wide signal). */
export async function getVariantCostSignal(orgId: number, variantId: number): Promise<{ latestUnitCost: number | null; sampleCount: number }> {
  const rows = await prisma.stockLedger.findMany({
    where: {
      variantId,
      orgId,
      type: { in: ["GRN_IN", "PURCHASE_IN"] },
      unitCost: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { unitCost: true },
  });
  if (!rows.length) return { latestUnitCost: null, sampleCount: 0 };
  const nums = rows.map((r) => Number(r.unitCost)).filter((n) => !Number.isNaN(n));
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return { latestUnitCost: Math.round(avg * 10000) / 10000, sampleCount: rows.length };
}

/** --- Analytics --- */
export async function getPricingAnalyticsSummary(orgId: number) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [snapshotsLast30Days, campaignCount, ruleCount, tierCount] = await Promise.all([
    prisma.priceResolutionSnapshot.count({
      where: {
        createdAt: { gte: since },
        order: { branch: { orgId } },
      },
    }),
    prisma.pricingCampaign.count({ where: { orgId } }),
    prisma.enterpriseDiscountRule.count({ where: { orgId, status: "ACTIVE" } }),
    prisma.membershipTier.count({ where: { orgId, status: "ACTIVE" } }),
  ]);
  return {
    snapshotsLast30Days,
    activeCampaigns: campaignCount,
    activeEnterpriseRules: ruleCount,
    activeMembershipTiers: tierCount,
  };
}

export async function simulatePriceForVariant(params: {
  orgId: number;
  branchId: number;
  locationId?: number | null;
  variantId: number;
  membershipTierId?: number | null;
  membershipTierDiscountPercent?: number | null;
  lotId?: number | null;
  /** When set, runs retail discount governance preview vs resolved enterprise list (simulator only). */
  discountedUnitPrice?: number | null;
}) {
  const branchOk = await prisma.branch.findFirst({
    where: { id: params.branchId, orgId: params.orgId },
    select: { id: true },
  });
  if (!branchOk) {
    throw new Error("Branch not found for this organization.");
  }
  const variantOk = await prisma.productVariant.findFirst({
    where: { id: params.variantId, product: { orgId: params.orgId } },
    select: { id: true },
  });
  if (!variantOk) {
    throw new Error("Variant not found for this organization.");
  }
  if (params.membershipTierId != null) {
    const tier = await prisma.membershipTier.findFirst({
      where: { id: params.membershipTierId, orgId: params.orgId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!tier) {
      throw new Error("Membership tier not found or inactive for this organization.");
    }
  }
  if (params.lotId != null) {
    const lot = await prisma.stockLot.findFirst({
      where: { id: params.lotId, orgId: params.orgId, variantId: params.variantId },
      select: { id: true },
    });
    if (!lot) {
      throw new Error("Stock lot not found for this variant and organization.");
    }
  }

  const shop = await prisma.inventoryLocation.findFirst({
    where: { branchId: params.branchId, type: "SHOP", isActive: true },
    select: { id: true },
  });
  const shopLocationId = shop?.id ?? null;
  const core = await resolveSellingPrice({
    orgId: params.orgId,
    variantId: params.variantId,
    branchId: params.branchId,
    locationId: params.locationId ?? shopLocationId ?? undefined,
  });
  const full = await resolveSellingPriceWithEnterprise({
    orgId: params.orgId,
    variantId: params.variantId,
    branchId: params.branchId,
    locationId: params.locationId ?? shopLocationId ?? undefined,
    shopLocationId,
    membershipTierId: params.membershipTierId ?? null,
    membershipTierDiscountPercent: params.membershipTierDiscountPercent ?? null,
    lotId: params.lotId ?? null,
  });
  const policy = await getOrCreateOrgPolicy(params.orgId);
  let governanceLine: GovernanceLinePreview | null = null;
  if (
    params.discountedUnitPrice != null &&
    Number.isFinite(Number(params.discountedUnitPrice)) &&
    full.price != null &&
    full.price > 0
  ) {
    const v = await validateRetailDiscountLine({
      orgId: params.orgId,
      branchId: params.branchId,
      variantId: params.variantId,
      listUnitPrice: full.price,
      discountedUnitPrice: Number(params.discountedUnitPrice),
      lineQty: 1,
    });
    if (v.ok) {
      governanceLine = { ok: true, message: "Line passes floor / retail caps for this resolved list price." };
    } else {
      const fail = v as Extract<typeof v, { ok: false }>;
      governanceLine = {
        ok: false,
        code: fail.code,
        message: fail.message,
        needsApproval: fail.needsApproval,
      };
    }
  }
  const resolutionTimeline = buildRichResolutionTimeline({
    core,
    full,
    batchPricingEnabled: Boolean(policy.batchPricingEnabled),
    shopLocationId,
    governanceLine,
  });
  return {
    core,
    withEnterprise: full,
    shopLocationId,
    resolutionMeta: buildUnifiedResolutionEnvelope(core, full),
    resolutionTimeline,
  };
}

const BATCH_RULE_CSV_HEADER =
  "variantId,sku,lotId,lotCode,branchId,promoPrice,recommendedSellPrice,validFrom,validTo,status,liquidationReason,id";

function csvEscapeCell(v: unknown): string {
  if (v == null || v === "") return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** CSV export of batch pricing rules (UTF-8, header row). */
export async function exportBatchPricingRulesCsv(orgId: number, variantId?: number): Promise<string> {
  if (variantId != null) {
    const v = await prisma.productVariant.findFirst({
      where: { id: variantId, product: { orgId } },
      select: { id: true },
    });
    if (!v) {
      throw new Error("variantId not found for this organization.");
    }
  }
  const rows = await listBatchPricingRules(orgId, variantId);
  const lines = [BATCH_RULE_CSV_HEADER];
  for (const r of rows) {
    lines.push(
      [
        csvEscapeCell(r.variantId),
        csvEscapeCell(r.variant?.sku),
        csvEscapeCell(r.lotId),
        csvEscapeCell(r.lot?.lotCode),
        csvEscapeCell(r.branchId),
        csvEscapeCell(r.promoPrice != null ? Number(r.promoPrice) : ""),
        csvEscapeCell(r.recommendedSellPrice != null ? Number(r.recommendedSellPrice) : ""),
        csvEscapeCell(r.validFrom ? new Date(r.validFrom).toISOString() : ""),
        csvEscapeCell(r.validTo ? new Date(r.validTo).toISOString() : ""),
        csvEscapeCell(r.status),
        csvEscapeCell(r.liquidationReason),
        csvEscapeCell(r.id),
      ].join(",")
    );
  }
  return lines.join("\n");
}

export type BatchCsvImportRowResult = { rowIndex: number; ok: boolean; message?: string; ruleId?: number };

/** Import batch rules from CSV; partial success with per-row errors. */
export async function importBatchPricingRulesFromCsv(
  orgId: number,
  csvText: string,
  actorUserId: number | null
): Promise<{ created: number; updated: number; failed: number; results: BatchCsvImportRowResult[] }> {
  const trimmed = String(csvText ?? "").trim();
  const MAX_CSV_CHARS = 1_500_000;
  if (trimmed.length > MAX_CSV_CHARS) {
    return {
      created: 0,
      updated: 0,
      failed: 1,
      results: [
        {
          rowIndex: 0,
          ok: false,
          message: `CSV exceeds maximum size (${MAX_CSV_CHARS} characters). Split into smaller files.`,
        },
      ],
    };
  }
  if (!trimmed) {
    return { created: 0, updated: 0, failed: 0, results: [{ rowIndex: 0, ok: false, message: "Empty CSV" }] };
  }
  let records: Record<string, string>[];
  try {
    records = parse(trimmed, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Record<string, string>[];
  } catch (e: unknown) {
    return {
      created: 0,
      updated: 0,
      failed: 0,
      results: [{ rowIndex: 0, ok: false, message: e instanceof Error ? e.message : "CSV parse error" }],
    };
  }
  const normKey = (k: string) => k.replace(/\s+/g, "").toLowerCase();
  const lowerRow = (row: Record<string, string>) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      out[normKey(k)] = v;
    }
    return out;
  };

  if (!records.length) {
    return {
      created: 0,
      updated: 0,
      failed: 0,
      results: [{ rowIndex: 0, ok: false, message: "No data rows after header" }],
    };
  }

  let created = 0;
  let updated = 0;
  let failed = 0;
  const results: BatchCsvImportRowResult[] = [];

  for (let i = 0; i < records.length; i++) {
    const rowIndex = i + 2;
    const row = lowerRow(records[i]);
    try {
      const idRaw = row["id"]?.trim();
      const variantId = parseInt(row["variantid"] || row["variant_id"] || "", 10);
      let lotId = parseInt(row["lotid"] || row["lot_id"] || "", 10);
      const lotCode = row["lotcode"]?.trim() || row["lot_code"]?.trim();
      const sku = row["sku"]?.trim();
      let resolvedVariantId = Number.isFinite(variantId) ? variantId : NaN;
      if (!Number.isFinite(resolvedVariantId) && sku) {
        const v = await prisma.productVariant.findFirst({
          where: { sku, product: { orgId } },
          select: { id: true },
        });
        if (v) resolvedVariantId = v.id;
      }
      if (!Number.isFinite(resolvedVariantId)) {
        throw new Error("variantId or resolvable sku required");
      }
      if (!Number.isFinite(lotId) && lotCode) {
        const lot = await prisma.stockLot.findFirst({
          where: { orgId, variantId: resolvedVariantId, lotCode },
          select: { id: true },
        });
        if (!lot) throw new Error(`lotCode not found for variant: ${lotCode}`);
        lotId = lot.id;
      }
      if (!Number.isFinite(lotId)) throw new Error("lotId or resolvable lotCode required");

      const lotRow = await prisma.stockLot.findFirst({
        where: { id: lotId, orgId },
        select: { id: true, variantId: true },
      });
      if (!lotRow) {
        throw new Error(`Stock lot ${lotId} not found for this organization`);
      }
      if (lotRow.variantId !== resolvedVariantId) {
        throw new Error(`Stock lot ${lotId} belongs to variant ${lotRow.variantId}, not ${resolvedVariantId}`);
      }

      const branchRaw = row["branchid"]?.trim() || row["branch_id"]?.trim();
      let branchId: number | null = branchRaw === "" || branchRaw == null ? null : parseInt(branchRaw, 10);
      if (branchRaw && !Number.isFinite(branchId)) throw new Error("Invalid branchId");
      if (branchId != null) {
        const br = await prisma.branch.findFirst({
          where: { id: branchId, orgId },
          select: { id: true },
        });
        if (!br) {
          throw new Error(`Branch ${branchId} not found for this organization`);
        }
      }

      const promoPrice = row["promoprice"]?.trim() ? Number(row["promoprice"]) : null;
      const recommendedSellPrice = row["recommendedsellprice"]?.trim() ? Number(row["recommendedsellprice"]) : null;
      const validFrom = row["validfrom"]?.trim() ? new Date(row["validfrom"]) : undefined;
      const validTo = row["validto"]?.trim() ? new Date(row["validto"]) : null;
      const stRaw = (row["status"]?.trim() || "ACTIVE").toUpperCase();
      if (stRaw !== "ACTIVE" && stRaw !== "INACTIVE") {
        throw new Error('status must be "ACTIVE" or "INACTIVE"');
      }
      const status = stRaw as BatchPricingRuleStatus;
      const liquidationReason = row["liquidationreason"]?.trim() || null;

      if (promoPrice != null && Number.isNaN(promoPrice)) throw new Error("Invalid promoPrice");
      if (recommendedSellPrice != null && Number.isNaN(recommendedSellPrice)) throw new Error("Invalid recommendedSellPrice");
      if (validFrom && Number.isNaN(validFrom.getTime())) throw new Error("Invalid validFrom");
      if (validTo && Number.isNaN(validTo.getTime())) throw new Error("Invalid validTo");

      const body: Parameters<typeof upsertBatchPricingRule>[1] = {
        lotId,
        variantId: resolvedVariantId,
        branchId: branchId ?? null,
        promoPrice: promoPrice ?? null,
        recommendedSellPrice: recommendedSellPrice ?? null,
        liquidationReason,
        validFrom,
        validTo,
        status,
      };
      if (idRaw && Number.isFinite(parseInt(idRaw, 10))) {
        body.id = parseInt(idRaw, 10);
      }

      const saved = await upsertBatchPricingRule(orgId, body, actorUserId);
      if (body.id) updated += 1;
      else created += 1;
      results.push({ rowIndex, ok: true, ruleId: saved.id });
    } catch (e: unknown) {
      failed += 1;
      results.push({
        rowIndex,
        ok: false,
        message: e instanceof Error ? e.message : "Row error",
      });
    }
  }
  return { created, updated, failed, results };
}
