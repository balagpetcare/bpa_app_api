/**
 * Retail (inventory) discount rules, validation, and approval workflow.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import { getOrCreateOrgPolicy, logPricingAudit } from "./pricingGovernance.service";

function isRuleEffective(validFrom: Date | null, validTo: Date | null, at: Date): boolean {
  if (validFrom && validFrom.getTime() > at.getTime()) return false;
  if (validTo && validTo.getTime() < at.getTime()) return false;
  return true;
}

export async function findApplicableRetailRule(orgId: number, branchId: number, variantId: number, at = new Date()) {
  const rules = await prisma.retailDiscountRule.findMany({
    where: {
      orgId,
      variantId,
      status: "ACTIVE",
      OR: [{ branchId: null }, { branchId }],
    },
  });
  const active = rules.filter((r) => isRuleEffective(r.validFrom, r.validTo, at));
  const specific = active.find((r) => r.branchId === branchId);
  if (specific) return specific;
  return active.find((r) => r.branchId == null) ?? null;
}

export type ValidateRetailDiscountResult =
  | { ok: true; discountPercent: number }
  | { ok: false; code: string; message: string; needsApproval?: boolean; floor?: number; maxDiscountPercent?: number };

/**
 * Enforces floor (minPrice), rule caps, and approval requirement for over-limit discounts.
 */
export async function validateRetailDiscountLine(params: {
  orgId: number;
  branchId: number;
  variantId: number;
  listUnitPrice: number;
  discountedUnitPrice: number;
  lineQty?: number;
  at?: Date;
  /** When discount exceeds approval threshold, pass an approved request id to complete the sale. */
  approvalRequestId?: number | null;
}): Promise<ValidateRetailDiscountResult> {
  const at = params.at ?? new Date();
  const list = Number(params.listUnitPrice);
  const unit = Number(params.discountedUnitPrice);
  if (!(list > 0)) {
    return { ok: false, code: "INVALID_LIST", message: "List unit price must be positive" };
  }
  if (unit < 0 || unit > list + 1e-6) {
    return { ok: false, code: "INVALID_DISCOUNTED", message: "Discounted unit must be between 0 and list price" };
  }

  const pp = await prisma.productPricing.findUnique({
    where: { orgId_variantId: { orgId: params.orgId, variantId: params.variantId } },
  });
  const floor = pp?.minPrice != null ? Number(pp.minPrice) : null;
  if (floor != null && unit < floor - 1e-6) {
    return {
      ok: false,
      code: "BELOW_MIN_SALE_PRICE",
      message: `Sale unit ${unit} is below minimum sale price (floor) ${floor}`,
      floor,
    };
  }

  const discountPercent = ((list - unit) / list) * 100;
  if (discountPercent <= 1e-6) {
    return { ok: true, discountPercent: 0 };
  }

  const rule = await findApplicableRetailRule(params.orgId, params.branchId, params.variantId, at);
  if (!rule) {
    return {
      ok: false,
      code: "NO_RETAIL_RULE",
      message: "No active retail discount rule for this variant (discounts are blocked)",
    };
  }

  const maxP = rule.maxDiscountPercent != null ? Number(rule.maxDiscountPercent) : null;
  if (maxP != null && discountPercent > maxP + 1e-6) {
    return {
      ok: false,
      code: "EXCEEDS_MAX_DISCOUNT_PERCENT",
      message: `Discount ${discountPercent.toFixed(2)}% exceeds maximum ${maxP}%`,
      maxDiscountPercent: maxP,
    };
  }

  const maxAmt = rule.maxDiscountAmount != null ? Number(rule.maxDiscountAmount) : null;
  const qty = params.lineQty ?? 1;
  if (maxAmt != null) {
    const discAmt = (list - unit) * qty;
    if (discAmt > maxAmt + 1e-6) {
      return { ok: false, code: "EXCEEDS_MAX_DISCOUNT_AMOUNT", message: `Discount amount exceeds cap ${maxAmt}` };
    }
  }

  const policy = await getOrCreateOrgPolicy(params.orgId);
  const reqAbove = rule.requiresApprovalAbovePercent != null ? Number(rule.requiresApprovalAbovePercent) : null;
  if (policy.retailDiscountApprovalEnabled && reqAbove != null && discountPercent > reqAbove + 1e-6) {
    const aid = params.approvalRequestId;
    if (aid != null && aid > 0) {
      const ar = await prisma.retailDiscountApprovalRequest.findFirst({
        where: {
          id: aid,
          orgId: params.orgId,
          branchId: params.branchId,
          variantId: params.variantId,
        },
      });
      if (!ar) {
        return { ok: false, code: "APPROVAL_NOT_FOUND", message: "Discount approval request not found for this line" };
      }
      if (ar.status !== "APPROVED") {
        return {
          ok: false,
          code: "APPROVAL_NOT_APPROVED",
          message: `Discount approval is ${ar.status}; manager approval is required before completing the sale`,
        };
      }
      /** Approvals expire after 7 days from manager review (configurable later via org policy). */
      if (ar.reviewedAt) {
        const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
        if (Date.now() - new Date(ar.reviewedAt).getTime() > maxAgeMs) {
          return {
            ok: false,
            code: "APPROVAL_EXPIRED",
            message: "Discount approval has expired; request a new approval",
          };
        }
      }
      if (ar.consumedOrderId != null) {
        return {
          ok: false,
          code: "APPROVAL_ALREADY_USED",
          message: "This discount approval was already used on another sale",
        };
      }
      const reqUnit = Number(ar.requestedUnitPrice);
      const snapList = Number(ar.listPriceSnapshot);
      if (Math.abs(reqUnit - unit) > 0.02) {
        return {
          ok: false,
          code: "APPROVAL_PRICE_MISMATCH",
          message: "Sale price does not match the approved discount request; adjust price or obtain a new approval",
        };
      }
      const listTol = Math.max(0.02, list * 0.02);
      if (Math.abs(snapList - list) > listTol) {
        return {
          ok: false,
          code: "LIST_PRICE_CHANGED",
          message: "List price changed since approval; request a new discount approval",
        };
      }
      return { ok: true, discountPercent };
    }
    return {
      ok: false,
      code: "APPROVAL_REQUIRED",
      message: `Discount ${discountPercent.toFixed(2)}% requires manager approval (threshold ${reqAbove}%)`,
      needsApproval: true,
    };
  }

  return { ok: true, discountPercent };
}

/**
 * Server-side POS path: when org policy enables POS governance, enforce list resolution, floor, rules, and approvals.
 */
export async function assertPosSalePricingGovernance(params: {
  orgId: number;
  branchId: number;
  shopLocationId: number | null;
  items: Array<{
    productId: number;
    variantId?: number;
    quantity: number;
    price: number;
    retailDiscountApprovalId?: number;
  }>;
}): Promise<void> {
  const policy = await getOrCreateOrgPolicy(params.orgId);
  if (!policy.posPricingGovernanceEnabled) return;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { resolveSellingPrice } = require("./pricingEngine.service") as {
    resolveSellingPrice: (p: {
      orgId: number;
      variantId: number;
      branchId?: number | null;
      locationId?: number | null;
    }) => Promise<{ price: number | null }>;
  };

  for (const item of params.items) {
    if (!item.variantId) continue;
    const resolved = await resolveSellingPrice({
      orgId: params.orgId,
      variantId: item.variantId,
      branchId: params.branchId,
      locationId: params.shopLocationId,
    });
    const list = resolved.price;
    if (list == null || !(list > 0)) {
      const err = new Error(
        `POS pricing governance: no resolved list price for variant ${item.variantId}. Configure catalog or location pricing before selling.`
      ) as Error & { code?: string };
      err.code = "NO_LIST_PRICE";
      throw err;
    }
    const v = await validateRetailDiscountLine({
      orgId: params.orgId,
      branchId: params.branchId,
      variantId: item.variantId,
      listUnitPrice: list,
      discountedUnitPrice: item.price,
      lineQty: item.quantity,
      approvalRequestId: item.retailDiscountApprovalId,
    });
    if (v.ok === false) {
      const err = new Error(v.message) as Error & { code?: string; needsApproval?: boolean };
      err.code = v.code;
      if (v.needsApproval) err.needsApproval = true;
      throw err;
    }
  }
}

/** After payment succeeds, mark approvals consumed so they cannot be reused. */
export async function consumeRetailDiscountApprovalsForPaidOrder(params: {
  orgId: number;
  orderId: number;
  items: Array<{ retailDiscountApprovalId?: number }>;
  /** When set, run inside the same DB transaction as order + ledger (POS atomicity). */
  tx?: any;
}): Promise<void> {
  const db = params.tx || prisma;
  for (const item of params.items) {
    const aid = item.retailDiscountApprovalId;
    if (aid == null) continue;
    const r = await db.retailDiscountApprovalRequest.updateMany({
      where: {
        id: aid,
        orgId: params.orgId,
        status: "APPROVED",
        consumedOrderId: null,
      },
      data: { consumedOrderId: params.orderId, consumedAt: new Date() },
    });
    if (r.count !== 1) {
      throw new Error(
        "Retail discount approval could not be applied (invalid, already used, or not approved). Remove the approval id or obtain a new approval."
      );
    }
  }
}

export async function listRetailRules(orgId: number, opts?: { branchId?: number; page?: number; limit?: number }) {
  const page = opts?.page ?? 1;
  const limit = Math.min(opts?.limit ?? 50, 200);
  const skip = (page - 1) * limit;
  const where: any = { orgId };
  if (opts?.branchId != null) where.branchId = opts.branchId;
  const [items, total] = await Promise.all([
    prisma.retailDiscountRule.findMany({
      where,
      skip,
      take: limit,
      orderBy: { updatedAt: "desc" },
      include: {
        variant: { select: { id: true, sku: true, title: true } },
        branch: { select: { id: true, name: true } },
      },
    }),
    prisma.retailDiscountRule.count({ where }),
  ]);
  return { items, total, page, limit };
}

export async function upsertRetailRule(
  orgId: number,
  data: {
    id?: number;
    branchId?: number | null;
    variantId: number;
    maxDiscountPercent?: number | null;
    maxDiscountAmount?: number | null;
    requiresApprovalAbovePercent?: number | null;
    status?: string;
    validFrom?: Date | null;
    validTo?: Date | null;
  },
  actorUserId: number | null
) {
  const payload = {
    orgId,
    branchId: data.branchId ?? null,
    variantId: data.variantId,
    maxDiscountPercent: data.maxDiscountPercent ?? null,
    maxDiscountAmount: data.maxDiscountAmount ?? null,
    requiresApprovalAbovePercent: data.requiresApprovalAbovePercent ?? null,
    status: data.status ?? "ACTIVE",
    validFrom: data.validFrom ?? null,
    validTo: data.validTo ?? null,
  };

  let before: unknown = null;
  let row;
  if (data.id) {
    const existing = await prisma.retailDiscountRule.findFirst({
      where: { id: data.id, orgId },
    });
    if (!existing) throw new Error("Rule not found");
    before = existing;
    row = await prisma.retailDiscountRule.update({
      where: { id: data.id },
      data: payload,
      include: { variant: { select: { sku: true, title: true } } },
    });
  } else {
    row = await prisma.retailDiscountRule.create({
      data: payload,
      include: { variant: { select: { sku: true, title: true } } },
    });
  }

  await logPricingAudit({
    orgId,
    entityType: "RETAIL_DISCOUNT_RULE",
    entityKey: `rule:${row.id}`,
    action: data.id ? "UPDATE" : "CREATE",
    actorUserId,
    payloadBefore: before,
    payloadAfter: row,
  });
  return row;
}

export async function listPendingApprovals(orgId: number, branchId?: number) {
  const where: any = { orgId, status: "PENDING" };
  if (branchId != null) where.branchId = branchId;
  return prisma.retailDiscountApprovalRequest.findMany({
    where,
    orderBy: { createdAt: "asc" },
    include: {
      variant: { select: { id: true, sku: true, title: true } },
      branch: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
}

export async function submitDiscountApprovalRequest(
  orgId: number,
  data: {
    branchId: number;
    variantId: number;
    listUnitPrice: number;
    requestedUnitPrice: number;
    reason?: string | null;
  },
  requestedByUserId: number
) {
  const list = Number(data.listUnitPrice);
  const unit = Number(data.requestedUnitPrice);
  const pct = list > 0 ? ((list - unit) / list) * 100 : 0;
  return prisma.retailDiscountApprovalRequest.create({
    data: {
      orgId,
      branchId: data.branchId,
      variantId: data.variantId,
      listPriceSnapshot: list,
      requestedUnitPrice: unit,
      requestedDiscountPercent: pct,
      reason: data.reason?.trim() || null,
      requestedByUserId,
      status: "PENDING",
    },
    include: {
      variant: { select: { sku: true, title: true } },
      branch: { select: { name: true } },
    },
  });
}

export async function reviewDiscountApprovalRequest(
  id: number,
  orgId: number,
  data: { approve: boolean; reviewNote?: string | null },
  reviewerUserId: number
) {
  const req = await prisma.retailDiscountApprovalRequest.findFirst({
    where: { id, orgId },
  });
  if (!req) throw new Error("Request not found");
  if (req.status !== "PENDING") throw new Error("Request is not pending");

  const status = data.approve ? "APPROVED" : "REJECTED";
  const updated = await prisma.retailDiscountApprovalRequest.update({
    where: { id },
    data: {
      status,
      reviewedByUserId: reviewerUserId,
      reviewedAt: new Date(),
      reviewNote: data.reviewNote?.trim() || null,
    },
  });

  await logPricingAudit({
    orgId,
    entityType: "RETAIL_DISCOUNT_RULE",
    entityKey: `approval:${id}`,
    action: status,
    actorUserId: reviewerUserId,
    payloadBefore: req,
    payloadAfter: updated,
  });
  return updated;
}
