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

/** Validates floor ≤ base ≤ MRP (maxPrice) and markup result within band. */
export function validateCentralPricingBand(data: {
  basePrice?: number | null;
  markupPercent?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
}) {
  const min = data.minPrice != null ? Number(data.minPrice) : null;
  const max = data.maxPrice != null ? Number(data.maxPrice) : null;
  const base = data.basePrice != null ? Number(data.basePrice) : null;
  if (min != null && max != null && min > max + 1e-6) {
    throw new Error("minPrice (floor) cannot exceed maxPrice (MRP cap)");
  }
  if (base != null && min != null && base < min - 1e-6) {
    throw new Error("basePrice cannot be below minPrice (floor)");
  }
  if (base != null && max != null && base > max + 1e-6) {
    throw new Error("basePrice cannot exceed maxPrice (MRP)");
  }
  if (base != null && data.markupPercent != null) {
    const after = base * (1 + Number(data.markupPercent) / 100);
    if (min != null && after < min - 1e-6) {
      throw new Error("List price after markup would be below floor (minPrice)");
    }
    if (max != null && after > max + 1e-6) {
      throw new Error("List price after markup would exceed MRP (maxPrice)");
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
  const p = Number(overridePrice);
  if (min != null && p < min - 1e-6) {
    throw new Error(`Branch override ${p} is below central floor (minPrice) ${min}`);
  }
  if (max != null && p > max + 1e-6) {
    throw new Error(`Branch override ${p} exceeds central MRP cap (maxPrice) ${max}`);
  }
}

export async function listPricingAudit(orgId: number, opts?: { page?: number; limit?: number }) {
  const page = opts?.page ?? 1;
  const limit = Math.min(opts?.limit ?? 50, 200);
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    prisma.pricingAuditLog.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        actor: { select: { id: true, profile: { select: { displayName: true } } } },
      },
    }),
    prisma.pricingAuditLog.count({ where: { orgId } }),
  ]);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
}
