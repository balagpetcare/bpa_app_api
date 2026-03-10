/**
 * Discount & Approval Engine: DiscountPolicy CRUD, apply discount with approval workflow,
 * validation against policy rules, absorption calculation.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");

export type DiscountType =
  | "CAMPAIGN"
  | "MANAGER"
  | "DOCTOR_DISCRETION"
  | "OWNER"
  | "PACKAGE"
  | "LOYALTY"
  | "WELFARE_RESCUE"
  | "PROMOTIONAL"
  | "BRANCH_EVENT";
export type DiscountScope =
  | "WHOLE_INVOICE"
  | "SERVICE_LEVEL"
  | "PACKAGE_LEVEL"
  | "DOCTOR_FEE_EXCLUDED"
  | "CLINIC_FEE_ONLY"
  | "ADDON_ONLY"
  | "POST_OP_MEDS_ONLY";
export type DiscountCalcType =
  | "PERCENTAGE"
  | "FLAT_AMOUNT"
  | "CAPPED_AMOUNT"
  | "CONDITIONAL"
  | "BUNDLE";
export type DiscountAbsorptionMode =
  | "CLINIC_ABSORBS"
  | "PROPORTIONAL"
  | "DOCTOR_PROTECTED"
  | "APPROVAL_BASED_SPLIT";

/** List discount policies for a branch */
export async function listDiscountPolicies(options: {
  branchId: number;
  orgId?: number;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const page = options.page ?? 1;
  const limit = Math.min(options.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { branchId: options.branchId };
  if (options.orgId != null) where.orgId = options.orgId;
  if (options.status != null) where.status = options.status;

  const [items, total] = await Promise.all([
    prisma.discountPolicy.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: "asc" },
    }),
    prisma.discountPolicy.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/** Get one discount policy by id */
export async function getDiscountPolicyById(policyId: number, branchId: number) {
  const policy = await prisma.discountPolicy.findFirst({
    where: { id: policyId, branchId },
  });
  if (!policy) throw new Error("Discount policy not found");
  return policy;
}

/** Create discount policy */
export async function createDiscountPolicy(data: {
  orgId: number;
  branchId: number;
  name: string;
  discountType: DiscountType;
  scope: DiscountScope;
  calcType: DiscountCalcType;
  maxPercent?: number | null;
  maxAmount?: number | null;
  absorptionMode: DiscountAbsorptionMode;
  requiresApproval?: boolean;
  serviceIds?: number[] | null;
  packageIds?: number[] | null;
  validFrom?: Date | null;
  validTo?: Date | null;
}) {
  const policy = await prisma.discountPolicy.create({
    data: {
      orgId: data.orgId,
      branchId: data.branchId,
      name: data.name.trim(),
      discountType: data.discountType,
      scope: data.scope,
      calcType: data.calcType,
      maxPercent: data.maxPercent ?? undefined,
      maxAmount: data.maxAmount ?? undefined,
      absorptionMode: data.absorptionMode,
      requiresApproval: data.requiresApproval ?? true,
      serviceIds: data.serviceIds ?? undefined,
      packageIds: data.packageIds ?? undefined,
      validFrom: data.validFrom ?? undefined,
      validTo: data.validTo ?? undefined,
    },
  });
  return policy;
}

/** Update discount policy */
export async function updateDiscountPolicy(
  policyId: number,
  branchId: number,
  data: {
    name?: string;
    maxPercent?: number | null;
    maxAmount?: number | null;
    requiresApproval?: boolean;
    serviceIds?: number[] | null;
    packageIds?: number[] | null;
    validFrom?: Date | null;
    validTo?: Date | null;
    status?: string;
  }
) {
  const existing = await prisma.discountPolicy.findFirst({
    where: { id: policyId, branchId },
  });
  if (!existing) throw new Error("Discount policy not found");

  const policy = await prisma.discountPolicy.update({
    where: { id: policyId },
    data: {
      ...(data.name != null && { name: data.name.trim() }),
      ...(data.maxPercent !== undefined && { maxPercent: data.maxPercent }),
      ...(data.maxAmount !== undefined && { maxAmount: data.maxAmount }),
      ...(data.requiresApproval != null && { requiresApproval: data.requiresApproval }),
      ...(data.serviceIds !== undefined && { serviceIds: data.serviceIds }),
      ...(data.packageIds !== undefined && { packageIds: data.packageIds }),
      ...(data.validFrom !== undefined && { validFrom: data.validFrom }),
      ...(data.validTo !== undefined && { validTo: data.validTo }),
      ...(data.status != null && { status: data.status }),
    },
  });
  return policy;
}

/** Get approval rules for a branch (role-based max percent/amount) */
export async function getDiscountApprovalRules(branchId: number) {
  return prisma.discountApprovalRule.findMany({
    where: { branchId },
    orderBy: { roleKey: "asc" },
  });
}

/** Set or create discount approval rule */
export async function upsertDiscountApprovalRule(
  branchId: number,
  orgId: number,
  data: {
    roleKey: string;
    maxPercent: number;
    maxAmount?: number | null;
    appliesToScope?: string | null;
  }
) {
  const scope = data.appliesToScope ?? null;
  const existing = await prisma.discountApprovalRule.findFirst({
    where: { branchId, roleKey: data.roleKey, appliesToScope: scope },
  });
  if (existing) {
    return prisma.discountApprovalRule.update({
      where: { id: existing.id },
      data: { maxPercent: data.maxPercent, maxAmount: data.maxAmount ?? undefined },
    });
  }
  return prisma.discountApprovalRule.create({
    data: {
      orgId,
      branchId,
      roleKey: data.roleKey,
      maxPercent: data.maxPercent,
      maxAmount: data.maxAmount ?? undefined,
      appliesToScope: data.appliesToScope ?? undefined,
    },
  });
}

/** Validate discount amount against policy and approver's limit */
export async function validateDiscount(options: {
  branchId: number;
  policyId: number;
  orderId?: number;
  clinicalCaseId?: number;
  subtotal: number;
  discountPercent?: number;
  discountAmount?: number;
  approverRoleKey: string;
}): Promise<{
  allowed: boolean;
  effectiveAmount: number;
  effectivePercent: number;
  reason?: string;
}> {
  const policy = await prisma.discountPolicy.findFirst({
    where: { id: options.policyId, branchId: options.branchId },
  });
  if (!policy) {
    return {
      allowed: false,
      effectiveAmount: 0,
      effectivePercent: 0,
      reason: "Discount policy not found",
    };
  }

  const now = new Date();
  if (policy.validFrom && now < policy.validFrom) {
    return {
      allowed: false,
      effectiveAmount: 0,
      effectivePercent: 0,
      reason: "Policy not yet valid",
    };
  }
  if (policy.validTo && now > policy.validTo) {
    return {
      allowed: false,
      effectiveAmount: 0,
      effectivePercent: 0,
      reason: "Policy expired",
    };
  }
  if (policy.status !== "ACTIVE") {
    return {
      allowed: false,
      effectiveAmount: 0,
      effectivePercent: 0,
      reason: "Policy inactive",
    };
  }

  let effectiveAmount = 0;
  let effectivePercent = 0;

  if (policy.calcType === "PERCENTAGE" && options.discountPercent != null) {
    effectivePercent = Math.min(
      Number(options.discountPercent),
      policy.maxPercent != null ? Number(policy.maxPercent) : 100
    );
    effectiveAmount = Math.round((options.subtotal * effectivePercent) / 100 * 100) / 100;
  } else if (policy.calcType === "FLAT_AMOUNT" && options.discountAmount != null) {
    effectiveAmount = Math.min(
      Number(options.discountAmount),
      options.subtotal,
      policy.maxAmount != null ? Number(policy.maxAmount) : options.subtotal
    );
    effectivePercent = options.subtotal > 0 ? (effectiveAmount / options.subtotal) * 100 : 0;
  } else if (options.discountAmount != null) {
    effectiveAmount = Math.min(Number(options.discountAmount), options.subtotal);
    effectivePercent = options.subtotal > 0 ? (effectiveAmount / options.subtotal) * 100 : 0;
  } else if (options.discountPercent != null) {
    effectivePercent = Number(options.discountPercent);
    effectiveAmount = Math.round((options.subtotal * effectivePercent) / 100 * 100) / 100;
  }

  if (policy.maxPercent != null && effectivePercent > Number(policy.maxPercent)) {
    effectivePercent = Number(policy.maxPercent);
    effectiveAmount = Math.round((options.subtotal * effectivePercent) / 100 * 100) / 100;
  }
  if (policy.maxAmount != null && effectiveAmount > Number(policy.maxAmount)) {
    effectiveAmount = Number(policy.maxAmount);
    effectivePercent = options.subtotal > 0 ? (effectiveAmount / options.subtotal) * 100 : 0;
  }

  const approvalRule = await prisma.discountApprovalRule.findFirst({
    where: {
      branchId: options.branchId,
      roleKey: options.approverRoleKey,
    },
  });

  if (approvalRule) {
    const maxPct = Number(approvalRule.maxPercent);
    const maxAmt = approvalRule.maxAmount != null ? Number(approvalRule.maxAmount) : null;
    if (effectivePercent > maxPct) {
      return {
        allowed: false,
        effectiveAmount,
        effectivePercent,
        reason: `Approver role limited to ${maxPct}%`,
      };
    }
    if (maxAmt != null && effectiveAmount > maxAmt) {
      return {
        allowed: false,
        effectiveAmount,
        effectivePercent,
        reason: `Approver role limited to amount ${maxAmt}`,
      };
    }
  }

  return { allowed: true, effectiveAmount, effectivePercent };
}

/** Compute absorption breakdown (doctor vs clinic vs support) */
export function computeAbsorption(options: {
  absorptionMode: DiscountAbsorptionMode;
  discountAmount: number;
  doctorShareBeforeDiscount: number;
  clinicShareBeforeDiscount: number;
  supportShareBeforeDiscount: number;
}): { doctorAbsorb: number; clinicAbsorb: number; supportAbsorb: number } {
  const total = options.doctorShareBeforeDiscount + options.clinicShareBeforeDiscount + options.supportShareBeforeDiscount;
  if (total <= 0) {
    return { doctorAbsorb: 0, clinicAbsorb: options.discountAmount, supportAbsorb: 0 };
  }

  switch (options.absorptionMode) {
    case "CLINIC_ABSORBS":
      return {
        doctorAbsorb: 0,
        clinicAbsorb: options.discountAmount,
        supportAbsorb: 0,
      };
    case "DOCTOR_PROTECTED":
      return {
        doctorAbsorb: 0,
        clinicAbsorb: options.discountAmount,
        supportAbsorb: 0,
      };
    case "PROPORTIONAL": {
      const d = options.doctorShareBeforeDiscount / total;
      const c = options.clinicShareBeforeDiscount / total;
      const s = options.supportShareBeforeDiscount / total;
      return {
        doctorAbsorb: Math.round(options.discountAmount * d * 100) / 100,
        clinicAbsorb: Math.round(options.discountAmount * c * 100) / 100,
        supportAbsorb: Math.round(options.discountAmount * s * 100) / 100,
      };
    }
    case "APPROVAL_BASED_SPLIT":
    default:
      return {
        doctorAbsorb: 0,
        clinicAbsorb: options.discountAmount,
        supportAbsorb: 0,
      };
  }
}

/** Apply discount to order or case (creates AppliedDiscount + optional audit) */
export async function applyDiscount(data: {
  branchId: number;
  orderId?: number;
  clinicalCaseId?: number;
  discountPolicyId: number;
  discountType: DiscountType;
  calcType: DiscountCalcType;
  amount: number;
  percentApplied?: number | null;
  absorptionBreakdown?: { doctorShare?: number; clinicShare?: number; supportShare?: number } | null;
  approvedByUserId?: number | null;
  reason?: string | null;
}): Promise<{ id: number }> {
  if (data.orderId == null && data.clinicalCaseId == null) {
    throw new Error("Either orderId or clinicalCaseId required");
  }

  const applied = await prisma.appliedDiscount.create({
    data: {
      orderId: data.orderId ?? undefined,
      clinicalCaseId: data.clinicalCaseId ?? undefined,
      discountPolicyId: data.discountPolicyId,
      discountType: data.discountType,
      calcType: data.calcType,
      amount: data.amount,
      percentApplied: data.percentApplied ?? undefined,
      absorptionBreakdown: data.absorptionBreakdown ?? undefined,
      approvedByUserId: data.approvedByUserId ?? undefined,
      approvedAt: data.approvedByUserId ? new Date() : undefined,
      reason: data.reason ?? undefined,
    },
  });

  await prisma.discountAuditLog.create({
    data: {
      branchId: data.branchId,
      action: "APPLIED",
      discountPolicyId: data.discountPolicyId,
      orderId: data.orderId ?? undefined,
      caseId: data.clinicalCaseId ?? undefined,
      amount: data.amount,
      byUserId: data.approvedByUserId ?? undefined,
      reason: data.reason ?? undefined,
    },
  });

  const { emit, DOMAIN_EVENTS } = require("../../services/domainEvents.service");
  emit(DOMAIN_EVENTS.DISCOUNT_APPROVED, {
    appliedDiscountId: applied.id,
    branchId: data.branchId,
    orderId: data.orderId ?? null,
    clinicalCaseId: data.clinicalCaseId ?? null,
    discountPolicyId: data.discountPolicyId,
    amount: data.amount,
    approvedByUserId: data.approvedByUserId ?? null,
  });

  return { id: applied.id };
}

/** Get discount audit log for a branch */
export async function getDiscountAuditLog(options: {
  branchId: number;
  from?: Date;
  to?: Date;
  policyId?: number;
  orderId?: number;
  caseId?: number;
  page?: number;
  limit?: number;
}) {
  const page = options.page ?? 1;
  const limit = Math.min(options.limit ?? 50, 100);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { branchId: options.branchId };
  if (options.from != null || options.to != null) {
    where.createdAt = {};
    if (options.from != null) (where.createdAt as Record<string, Date>).gte = options.from;
    if (options.to != null) (where.createdAt as Record<string, Date>).lte = options.to;
  }
  if (options.policyId != null) where.discountPolicyId = options.policyId;
  if (options.orderId != null) where.orderId = options.orderId;
  if (options.caseId != null) where.caseId = options.caseId;

  const [items, total] = await Promise.all([
    prisma.discountAuditLog.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.discountAuditLog.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
