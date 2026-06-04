/**
 * Central pricing governance: band validation, branch override bounds, audit logging.
 */
import type { PricingAuditEntityType, Prisma } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";

export async function getOrCreateOrgPolicy(orgId: number) {
  let row = await prisma.orgPricingPolicy.findUnique({ where: { orgId } });
  if (!row) {
    row = await prisma.orgPricingPolicy.create({
      data: {
        orgId,
      },
    });
  }
  return row;
}

export async function updateOrgPolicy(
  orgId: number,
  data: {
    enforceBranchOverrideWithinCentralBand?: boolean;
    retailDiscountApprovalEnabled?: boolean;
    posPricingGovernanceEnabled?: boolean;
    posUseEnterpriseListResolution?: boolean;
    blockSaleBelowCost?: boolean;
    blockSaleBelowFloor?: boolean;
    allowCampaignStacking?: boolean;
    allowMembershipStacking?: boolean;
    scheduledPricingEnabled?: boolean;
    batchPricingEnabled?: boolean;
    defaultMaxDiscountPercent?: number | null;
  },
  actorUserId: number | null
) {
  await getOrCreateOrgPolicy(orgId);
  const before = await prisma.orgPricingPolicy.findUnique({ where: { orgId } });
  const after = await prisma.orgPricingPolicy.update({
    where: { orgId },
    data: {
      ...(data.enforceBranchOverrideWithinCentralBand !== undefined && {
        enforceBranchOverrideWithinCentralBand: data.enforceBranchOverrideWithinCentralBand,
      }),
      ...(data.retailDiscountApprovalEnabled !== undefined && {
        retailDiscountApprovalEnabled: data.retailDiscountApprovalEnabled,
      }),
      ...(data.posPricingGovernanceEnabled !== undefined && {
        posPricingGovernanceEnabled: data.posPricingGovernanceEnabled,
      }),
      ...(data.posUseEnterpriseListResolution !== undefined && {
        posUseEnterpriseListResolution: data.posUseEnterpriseListResolution,
      }),
      ...(data.blockSaleBelowCost !== undefined && { blockSaleBelowCost: data.blockSaleBelowCost }),
      ...(data.blockSaleBelowFloor !== undefined && { blockSaleBelowFloor: data.blockSaleBelowFloor }),
      ...(data.allowCampaignStacking !== undefined && { allowCampaignStacking: data.allowCampaignStacking }),
      ...(data.allowMembershipStacking !== undefined && { allowMembershipStacking: data.allowMembershipStacking }),
      ...(data.scheduledPricingEnabled !== undefined && { scheduledPricingEnabled: data.scheduledPricingEnabled }),
      ...(data.batchPricingEnabled !== undefined && { batchPricingEnabled: data.batchPricingEnabled }),
      ...(data.defaultMaxDiscountPercent !== undefined && {
        defaultMaxDiscountPercent: data.defaultMaxDiscountPercent,
      }),
    },
  });
  await logPricingAudit({
    orgId,
    entityType: "ORG_PRICING_POLICY",
    entityKey: `org:${orgId}`,
    action: "UPDATE",
    actorUserId,
    payloadBefore: before,
    payloadAfter: after,
  });
  return after;
}

export async function logPricingAudit(params: {
  orgId: number;
  entityType: PricingAuditEntityType;
  entityKey: string;
  action: string;
  actorUserId: number | null;
  payloadBefore?: unknown;
  payloadAfter?: unknown;
}) {
  const safe = (x: unknown): Prisma.InputJsonValue | undefined =>
    x === undefined ? undefined : (JSON.parse(JSON.stringify(x)) as Prisma.InputJsonValue);
  return prisma.pricingAuditLog.create({
    data: {
      orgId: params.orgId,
      entityType: params.entityType,
      entityKey: params.entityKey.slice(0, 128),
      action: params.action.slice(0, 64),
      actorUserId: params.actorUserId ?? undefined,
      payloadBefore: safe(params.payloadBefore),
      payloadAfter: safe(params.payloadAfter),
    },
  });
}

/** Validates floor ≤ base ≤ min(maxPrice, mrp) and markup result within band. */
export function validateCentralPricingBand(data: {
  basePrice?: number | null;
  markupPercent?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  mrp?: number | null;
}) {
  const min = data.minPrice != null ? Number(data.minPrice) : null;
  const max = data.maxPrice != null ? Number(data.maxPrice) : null;
  const mrp = data.mrp != null ? Number(data.mrp) : null;
  const upper = mrp != null && max != null ? Math.min(mrp, max) : mrp ?? max;
  const base = data.basePrice != null ? Number(data.basePrice) : null;
  if (min != null && upper != null && min > upper + 1e-6) {
    throw new Error("minPrice (floor) cannot exceed MRP upper cap (min of maxPrice and regulatory MRP)");
  }
  if (base != null && min != null && base < min - 1e-6) {
    throw new Error("basePrice cannot be below minPrice (floor)");
  }
  if (base != null && upper != null && base > upper + 1e-6) {
    throw new Error("basePrice cannot exceed MRP upper cap");
  }
  if (base != null && data.markupPercent != null) {
    const after = base * (1 + Number(data.markupPercent) / 100);
    if (min != null && after < min - 1e-6) {
      throw new Error("List price after markup would be below floor (minPrice)");
    }
    if (upper != null && after > upper + 1e-6) {
      throw new Error("List price after markup would exceed MRP upper cap");
    }
  }
}

export async function assertBranchOverrideWithinPolicy(orgId: number, variantId: number, overridePrice: number, at = new Date()) {
  const policy = await getOrCreateOrgPolicy(orgId);
  if (!policy.enforceBranchOverrideWithinCentralBand) return;
  const pp = await prisma.productPricing.findUnique({
    where: { orgId_variantId: { orgId, variantId } },
  });
  if (!pp) return;
  const min = pp.minPrice != null ? Number(pp.minPrice) : null;
  const max = pp.maxPrice != null ? Number(pp.maxPrice) : null;
  const mrp = pp.mrp != null ? Number(pp.mrp) : null;
  const upper = mrp != null && max != null ? Math.min(mrp, max) : mrp ?? max;
  const p = Number(overridePrice);
  if (min != null && p < min - 1e-6) {
    throw new Error(`Branch override ${p} is below central floor (minPrice) ${min}`);
  }
  if (upper != null && p > upper + 1e-6) {
    throw new Error(`Branch override ${p} exceeds central MRP cap ${upper}`);
  }
}

export async function listPricingAudit(
  orgId: number,
  opts?: { page?: number; limit?: number; entityType?: string; entityKeyContains?: string }
) {
  const page = opts?.page ?? 1;
  const limit = Math.min(opts?.limit ?? 50, 200);
  const skip = (page - 1) * limit;
  const where: Prisma.PricingAuditLogWhereInput = { orgId };
  if (opts?.entityType && String(opts.entityType).trim()) {
    where.entityType = String(opts.entityType).trim() as PricingAuditEntityType;
  }
  if (opts?.entityKeyContains && String(opts.entityKeyContains).trim()) {
    where.entityKey = { contains: String(opts.entityKeyContains).trim(), mode: "insensitive" };
  }
  const [items, total] = await Promise.all([
    prisma.pricingAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        actor: { select: { id: true, profile: { select: { displayName: true } } } },
      },
    }),
    prisma.pricingAuditLog.count({ where }),
  ]);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
}
