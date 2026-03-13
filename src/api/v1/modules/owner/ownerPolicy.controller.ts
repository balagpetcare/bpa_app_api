/**
 * Owner branch policy and escalation endpoints (Branch Manager Control).
 * Also: Clinic Approval Workflow (approval-requests list/decide).
 */

import type { Request, Response } from "express";
const {
  getBranchPolicy,
  updateBranchPolicy,
  listEscalationsByOrg,
  resolveEscalation,
} = require("../../services/branchPolicy.service");
const {
  listByOrg,
  decide,
  getById,
} = require("../../services/clinicApprovalRequest.service");
const prisma = require("../../../../infrastructure/db/prismaClient").default;

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.userId ?? req?.auth?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * GET /owner/branch-policy/:branchId
 * Returns branch policy (owner must own the branch's org).
 */
export async function getBranchPolicyHandler(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!branchId || !Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branch id" });

    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, orgId: true, org: { select: { ownerUserId: true } } },
    });
    if (!branch) return res.status(404).json({ success: false, message: "Branch not found" });
    if (branch.org?.ownerUserId !== userId) return res.status(403).json({ success: false, message: "Not owner of this branch" });

    const policy = await getBranchPolicy(branchId);
    return res.status(200).json({ success: true, data: policy });
  } catch (e: any) {
    console.error("[ownerPolicy.getBranchPolicy]", e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

/**
 * PUT /owner/branch-policy/:branchId
 * Update branch policy (owner only).
 */
export async function updateBranchPolicyHandler(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!branchId || !Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branch id" });

    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, org: { select: { ownerUserId: true } } },
    });
    if (!branch) return res.status(404).json({ success: false, message: "Branch not found" });
    if (branch.org?.ownerUserId !== userId) return res.status(403).json({ success: false, message: "Not owner of this branch" });

    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const data: {
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
    } = {
      maxDiscountPercent: body.maxDiscountPercent,
      maxRefundAmount: body.maxRefundAmount,
      maxPurchaseAmount: body.maxPurchaseAmount,
      requireOwnerApproval: Array.isArray(body.requireOwnerApproval) ? body.requireOwnerApproval : undefined,
      autoApproveStockBelow: body.autoApproveStockBelow,
      allowManagerPricing: body.allowManagerPricing,
      allowManagerRefund: body.allowManagerRefund,
      shiftManagement: body.shiftManagement,
      leaveApproval: body.leaveApproval,
      customPoliciesJson: typeof body.customPoliciesJson === "object" ? body.customPoliciesJson : undefined,
    };
    const result = await updateBranchPolicy(branchId, data, userId);
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    console.error("[ownerPolicy.updateBranchPolicy]", e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

/**
 * GET /owner/escalations
 * List pending (or all) escalations for owner's orgs. Query: ?status=PENDING|APPROVED|REJECTED
 */
export async function listEscalationsHandler(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const orgs = await prisma.organization.findMany({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    const orgIds = orgs.map((o) => o.id);
    if (orgIds.length === 0) return res.status(200).json({ success: true, data: [] });

    const status = typeof req.query.status === "string" && ["PENDING", "APPROVED", "REJECTED"].includes(req.query.status)
      ? (req.query.status as "PENDING" | "APPROVED" | "REJECTED")
      : "PENDING";
    const lists = await Promise.all(orgIds.map((orgId) => listEscalationsByOrg(orgId, status)));
    const data = lists.flat();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("[ownerPolicy.listEscalations]", e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

/**
 * PUT /owner/escalations/:id/decide
 * Body: { decision: "APPROVED"|"REJECTED", rejectReason?: string }
 */
export async function decideEscalationHandler(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id || !Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid escalation id" });

    const escalation = await prisma.managerApprovalEscalation.findUnique({
      where: { id },
      select: { id: true, orgId: true, status: true, org: { select: { ownerUserId: true } } },
    });
    if (!escalation) return res.status(404).json({ success: false, message: "Escalation not found" });
    if (escalation.org?.ownerUserId !== userId) return res.status(403).json({ success: false, message: "Not owner of this org" });
    if (escalation.status !== "PENDING") return res.status(400).json({ success: false, message: "Escalation already resolved" });

    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const decision = body.decision === "APPROVED" || body.decision === "REJECTED" ? body.decision : null;
    if (!decision) return res.status(400).json({ success: false, message: "decision required: APPROVED or REJECTED" });

    const result = await resolveEscalation(id, decision, userId, body.rejectReason);
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    console.error("[ownerPolicy.decideEscalation]", e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

/**
 * GET /owner/manager-activity/:branchId
 * Manager activity log for a branch (AuditLog filtered by branch + STAFF/manager actions).
 */
export async function getManagerActivityHandler(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!branchId || !Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branch id" });

    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, org: { select: { ownerUserId: true } } },
    });
    if (!branch) return res.status(404).json({ success: false, message: "Branch not found" });
    if (branch.org?.ownerUserId !== userId) return res.status(403).json({ success: false, message: "Not owner of this branch" });

    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const logs = await prisma.auditLog.findMany({
      where: {
        entityType: { in: ["POS_SALE", "POS_REFUND", "POS_INVOICE", "APPOINTMENT", "QUEUE_TICKET", "STOCK_REQUEST", "WORKSPACE_APPROVAL"] },
        entityId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const branchRelated = logs.filter((l) => {
      const after = l.after as Record<string, unknown> | null;
      const before = l.before as Record<string, unknown> | null;
      const bid = after?.branchId ?? before?.branchId;
      return bid === branchId;
    });

    return res.status(200).json({
      success: true,
      data: branchRelated.map((l) => ({
        id: l.id,
        action: l.action,
        entityType: l.entityType,
        entityId: l.entityId,
        actorId: l.actorId,
        actorRole: l.actorRole,
        createdAt: l.createdAt,
      })),
    });
  } catch (e: any) {
    console.error("[ownerPolicy.getManagerActivity]", e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

/**
 * GET /owner/approval-requests
 * List clinic approval requests for owner's orgs. Query: ?status=PENDING|APPROVED|REJECTED&branchId=&requestType=
 */
export async function listClinicApprovalRequestsHandler(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const orgs = await prisma.organization.findMany({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    const orgIds = orgs.map((o) => o.id);
    if (orgIds.length === 0) return res.status(200).json({ success: true, data: [] });

    const status =
      typeof req.query.status === "string" && ["PENDING", "APPROVED", "REJECTED"].includes(req.query.status)
        ? (req.query.status as "PENDING" | "APPROVED" | "REJECTED")
        : undefined;
    const branchId = typeof req.query.branchId === "string" && req.query.branchId ? Number(req.query.branchId) : undefined;
    const requestType = typeof req.query.requestType === "string" && req.query.requestType ? req.query.requestType : undefined;

    const data = await listByOrg(orgIds, {
      status,
      branchId: Number.isFinite(branchId) ? branchId : undefined,
      requestType: requestType as any,
    });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("[ownerPolicy.listClinicApprovalRequests]", e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

/**
 * GET /owner/approval-requests/:id
 */
export async function getClinicApprovalRequestByIdHandler(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id || !Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await getById(id);
    const org = await prisma.organization.findUnique({
      where: { id: row.orgId },
      select: { ownerUserId: true },
    });
    if (!org || org.ownerUserId !== userId) return res.status(403).json({ success: false, message: "Not owner of this org" });

    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("[ownerPolicy.getClinicApprovalRequestById]", e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

/**
 * PUT /owner/approval-requests/:id/decide
 * Body: { decision: "APPROVED"|"REJECTED", rejectReason?: string }
 */
export async function decideClinicApprovalRequestHandler(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id || !Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const requestRow = await prisma.clinicApprovalRequest.findUnique({
      where: { id },
      select: { id: true, orgId: true, status: true, org: { select: { ownerUserId: true } } },
    });
    if (!requestRow) return res.status(404).json({ success: false, message: "Approval request not found" });
    if (requestRow.org?.ownerUserId !== userId) return res.status(403).json({ success: false, message: "Not owner of this org" });
    if (requestRow.status !== "PENDING") return res.status(400).json({ success: false, message: "Request already resolved" });

    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const decision = body.decision === "APPROVED" || body.decision === "REJECTED" ? body.decision : null;
    if (!decision) return res.status(400).json({ success: false, message: "decision required: APPROVED or REJECTED" });

    const result = await decide(id, decision, userId, body.rejectReason);
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    console.error("[ownerPolicy.decideClinicApprovalRequest]", e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}
