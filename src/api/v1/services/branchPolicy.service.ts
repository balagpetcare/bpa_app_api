/**
 * Branch Policy Service
 * Owner-defined limits per branch; threshold checks and manager approval escalation.
 */

const prisma = require("../../../infrastructure/db/prismaClient").default;

export const ESCALATION_TYPES = [
  "DISCOUNT",
  "REFUND",
  "PURCHASE",
  "STAFF_HIRE",
  "PRICE_CHANGE",
  "SERVICE_TOGGLE",
] as const;

export type EscalationType = (typeof ESCALATION_TYPES)[number];

export type BranchPolicyPayload = {
  maxDiscountPercent?: number;
  maxRefundAmount?: number;
  maxPurchaseAmount?: number;
  requireOwnerApproval?: string[];
  autoApproveStockBelow?: number;
  allowManagerPricing?: boolean;
  allowManagerRefund?: boolean;
  shiftManagement?: boolean;
  leaveApproval?: boolean;
  customPoliciesJson?: Record<string, unknown>;
};

const DEFAULT_POLICY = {
  maxDiscountPercent: 30,
  maxRefundAmount: 5000,
  maxPurchaseAmount: 50000,
  requireOwnerApproval: [] as string[],
  autoApproveStockBelow: 10000,
  allowManagerPricing: false,
  allowManagerRefund: true,
  shiftManagement: true,
  leaveApproval: true,
  customPoliciesJson: {},
};

/**
 * Get branch policy (create with defaults if not exists, for read-only use).
 */
export async function getBranchPolicy(branchId: number): Promise<{
  id: number;
  orgId: number;
  branchId: number;
  maxDiscountPercent: number;
  maxRefundAmount: number;
  maxPurchaseAmount: number;
  requireOwnerApproval: string[];
  autoApproveStockBelow: number;
  allowManagerPricing: boolean;
  allowManagerRefund: boolean;
  shiftManagement: boolean;
  leaveApproval: boolean;
  customPoliciesJson: Record<string, unknown>;
}> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true },
  });
  if (!branch) throw new Error("Branch not found");

  const row = await prisma.branchPolicy.findUnique({
    where: { branchId },
  });

  if (row) {
    return {
      id: row.id,
      orgId: row.orgId,
      branchId: row.branchId,
      maxDiscountPercent: row.maxDiscountPercent,
      maxRefundAmount: row.maxRefundAmount,
      maxPurchaseAmount: row.maxPurchaseAmount,
      requireOwnerApproval: (row.requireOwnerApproval as string[]) ?? [],
      autoApproveStockBelow: row.autoApproveStockBelow,
      allowManagerPricing: row.allowManagerPricing,
      allowManagerRefund: row.allowManagerRefund,
      shiftManagement: row.shiftManagement,
      leaveApproval: row.leaveApproval,
      customPoliciesJson: (row.customPoliciesJson as Record<string, unknown>) ?? {},
    };
  }

  return {
    id: 0,
    orgId: branch.orgId,
    branchId,
    ...DEFAULT_POLICY,
  };
}

/**
 * Update or create branch policy (owner only; caller must enforce ownership).
 */
export async function updateBranchPolicy(
  branchId: number,
  data: BranchPolicyPayload,
  _ownerUserId: number
): Promise<{ id: number; branchId: number }> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true },
  });
  if (!branch) throw new Error("Branch not found");

  const existing = await prisma.branchPolicy.findUnique({
    where: { branchId },
  });

  const updateData: Record<string, unknown> = {};
  if (data.maxDiscountPercent !== undefined) updateData.maxDiscountPercent = data.maxDiscountPercent;
  if (data.maxRefundAmount !== undefined) updateData.maxRefundAmount = data.maxRefundAmount;
  if (data.maxPurchaseAmount !== undefined) updateData.maxPurchaseAmount = data.maxPurchaseAmount;
  if (data.requireOwnerApproval !== undefined) updateData.requireOwnerApproval = data.requireOwnerApproval;
  if (data.autoApproveStockBelow !== undefined) updateData.autoApproveStockBelow = data.autoApproveStockBelow;
  if (data.allowManagerPricing !== undefined) updateData.allowManagerPricing = data.allowManagerPricing;
  if (data.allowManagerRefund !== undefined) updateData.allowManagerRefund = data.allowManagerRefund;
  if (data.shiftManagement !== undefined) updateData.shiftManagement = data.shiftManagement;
  if (data.leaveApproval !== undefined) updateData.leaveApproval = data.leaveApproval;
  if (data.customPoliciesJson !== undefined) updateData.customPoliciesJson = data.customPoliciesJson;

  if (existing) {
    await prisma.branchPolicy.update({
      where: { branchId },
      data: updateData,
    });
    return { id: existing.id, branchId };
  }

  const created = await prisma.branchPolicy.create({
    data: {
      orgId: branch.orgId,
      branchId,
      maxDiscountPercent: data.maxDiscountPercent ?? DEFAULT_POLICY.maxDiscountPercent,
      maxRefundAmount: data.maxRefundAmount ?? DEFAULT_POLICY.maxRefundAmount,
      maxPurchaseAmount: data.maxPurchaseAmount ?? DEFAULT_POLICY.maxPurchaseAmount,
      requireOwnerApproval: data.requireOwnerApproval ?? DEFAULT_POLICY.requireOwnerApproval,
      autoApproveStockBelow: data.autoApproveStockBelow ?? DEFAULT_POLICY.autoApproveStockBelow,
      allowManagerPricing: data.allowManagerPricing ?? DEFAULT_POLICY.allowManagerPricing,
      allowManagerRefund: data.allowManagerRefund ?? DEFAULT_POLICY.allowManagerRefund,
      shiftManagement: data.shiftManagement ?? DEFAULT_POLICY.shiftManagement,
      leaveApproval: data.leaveApproval ?? DEFAULT_POLICY.leaveApproval,
      customPoliciesJson: data.customPoliciesJson ?? DEFAULT_POLICY.customPoliciesJson,
    },
  });
  return { id: created.id, branchId };
}

export type CheckEscalationPayload =
  | { type: "DISCOUNT"; discountPercent: number; amount?: number }
  | { type: "REFUND"; amount: number }
  | { type: "PURCHASE"; amount: number }
  | { type: "STAFF_HIRE" }
  | { type: "PRICE_CHANGE"; serviceId?: number; newPrice?: number }
  | { type: "SERVICE_TOGGLE" };

/**
 * Check if an action requires owner approval (escalation).
 */
export async function checkEscalationRequired(
  branchId: number,
  actionType: EscalationType,
  payload: CheckEscalationPayload
): Promise<{ required: boolean; reason?: string }> {
  const policy = await getBranchPolicy(branchId);
  const requireList = policy.requireOwnerApproval || [];

  if (requireList.includes("STAFF_HIRE") && actionType === "STAFF_HIRE")
    return { required: true, reason: "Staff hire requires owner approval" };
  if (requireList.includes("PRICE_CHANGE") && actionType === "PRICE_CHANGE")
    return { required: true, reason: "Price change requires owner approval" };
  if (requireList.includes("SERVICE_TOGGLE") && actionType === "SERVICE_TOGGLE")
    return { required: true, reason: "Service toggle requires owner approval" };

  if (actionType === "DISCOUNT" && "discountPercent" in payload) {
    if (payload.discountPercent > policy.maxDiscountPercent)
      return { required: true, reason: `Discount exceeds max ${policy.maxDiscountPercent}%` };
    if (requireList.includes("HIGH_DISCOUNT") && payload.discountPercent > policy.maxDiscountPercent * 0.5)
      return { required: true, reason: "High discount requires owner approval" };
  }

  if (actionType === "REFUND" && "amount" in payload) {
    if (payload.amount > policy.maxRefundAmount)
      return { required: true, reason: `Refund exceeds max ${policy.maxRefundAmount}` };
  }

  if (actionType === "PURCHASE" && "amount" in payload) {
    if (payload.amount > policy.maxPurchaseAmount)
      return { required: true, reason: `Purchase exceeds max ${policy.maxPurchaseAmount}` };
    if (payload.amount > policy.autoApproveStockBelow && requireList.includes("LARGE_PURCHASE"))
      return { required: true, reason: "Large purchase requires owner approval" };
  }

  return { required: false };
}

/**
 * Create a pending escalation (manager requested owner approval).
 */
export async function createEscalation(
  branchId: number,
  type: EscalationType,
  payload: Record<string, unknown>,
  requestedByUserId: number
): Promise<{ id: number; status: string }> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true, name: true, org: { select: { ownerUserId: true } } },
  });
  if (!branch) throw new Error("Branch not found");

  const triggerCondition = { type, payload };

  const row = await prisma.managerApprovalEscalation.create({
    data: {
      orgId: branch.orgId,
      branchId,
      type,
      triggerCondition: triggerCondition as unknown as object,
      status: "PENDING",
      requestedByUserId,
      payload: payload as unknown as object,
    },
  });

  try {
    const { emitManagerEscalationCreated } = require("../../../realtime/socketio.gateway");
    const ownerUserId = branch.org?.ownerUserId;
    if (ownerUserId) {
      emitManagerEscalationCreated(ownerUserId, {
        escalationId: row.id,
        branchId,
        type,
        branchName: branch.name,
      });
    }
  } catch (_) {
    // Socket may not be attached
  }

  try {
    const { createNotification } = require("./notification.service");
    const ownerUserId = branch.org?.ownerUserId;
    if (ownerUserId) {
      await createNotification({
        userId: ownerUserId,
        type: "SYSTEM",
        title: "Escalation pending",
        message: `Branch manager requested approval for ${type} at ${branch.name}.`,
        actionUrl: "/owner/escalations",
        orgId: branch.orgId,
        branchId,
        severity: "warn",
        source: "manager_escalation",
        meta: { escalationId: row.id, type },
      }).catch(() => {});
    }
  } catch (_) {}

  return { id: row.id, status: row.status };
}

/**
 * Resolve an escalation (owner approve/reject).
 */
export async function resolveEscalation(
  id: number,
  decision: "APPROVED" | "REJECTED",
  decidedByUserId: number,
  rejectReason?: string
): Promise<{ id: number; status: string }> {
  const row = await prisma.managerApprovalEscalation.findUnique({
    where: { id },
  });
  if (!row) throw new Error("Escalation not found");
  if (row.status !== "PENDING") throw new Error("Escalation already resolved");

  const updated = await prisma.managerApprovalEscalation.update({
    where: { id },
    data: {
      status: decision,
      decidedByUserId,
      decidedAt: new Date(),
      rejectReason: decision === "REJECTED" ? rejectReason ?? null : null,
    },
  });

  try {
    const { emitManagerEscalationResolved } = require("../../../realtime/socketio.gateway");
    emitManagerEscalationResolved(updated.requestedByUserId, {
      escalationId: updated.id,
      status: updated.status,
      decidedBy: decidedByUserId,
      rejectReason: updated.rejectReason ?? undefined,
    });
  } catch (_) {
    // Socket may not be attached
  }

  try {
    const { createNotification } = require("./notification.service");
    await createNotification({
      userId: updated.requestedByUserId,
      type: "SYSTEM",
      title: updated.status === "APPROVED" ? "Escalation approved" : "Escalation rejected",
      message:
        updated.status === "APPROVED"
          ? "Your request was approved by the owner."
          : (updated.rejectReason || "Your request was rejected by the owner."),
      actionUrl: "/staff/branch",
      severity: updated.status === "APPROVED" ? "success" : "error",
      source: "manager_escalation",
      meta: { escalationId: updated.id, status: updated.status },
    }).catch(() => {});
  } catch (_) {}

  return { id: updated.id, status: updated.status };
}

/**
 * List pending escalations for a branch (manager view).
 */
export async function listEscalationsByBranch(
  branchId: number,
  status?: "PENDING" | "APPROVED" | "REJECTED"
): Promise<
  Array<{
    id: number;
    type: string;
    status: string;
    payload: Record<string, unknown>;
    requestedByUserId: number;
    createdAt: Date;
    decidedAt: Date | null;
  }>
> {
  const rows = await prisma.managerApprovalEscalation.findMany({
    where: { branchId, ...(status && { status }) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      status: true,
      payload: true,
      requestedByUserId: true,
      createdAt: true,
      decidedAt: true,
    },
  });
  return rows.map((r: { payload: object }) => ({
    ...r,
    payload: (r.payload as Record<string, unknown>) ?? {},
  }));
}

/**
 * List all pending escalations for owner (across branches of org).
 */
export async function listEscalationsByOrg(
  orgId: number,
  status: "PENDING" | "APPROVED" | "REJECTED" = "PENDING"
): Promise<
  Array<{
    id: number;
    branchId: number;
    type: string;
    status: string;
    payload: Record<string, unknown>;
    requestedByUserId: number;
    createdAt: Date;
    branch?: { name: string };
  }>
> {
  const rows = await prisma.managerApprovalEscalation.findMany({
    where: { orgId, status },
    orderBy: { createdAt: "desc" },
    include: { branch: { select: { name: true } } },
  });
  return rows.map((r: { payload: object }) => ({
    ...r,
    payload: (r.payload as Record<string, unknown>) ?? {},
  }));
}
