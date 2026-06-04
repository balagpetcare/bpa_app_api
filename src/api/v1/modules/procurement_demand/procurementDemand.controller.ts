import type { Request, Response } from "express";
import * as service from "./procurementDemand.service";
import { assertUserCanAccessOrg } from "../network_balance/networkBalance.service";

function parseOrgId(req: Request): number {
  const q = req.query as Record<string, string>;
  const b = (req.body || {}) as Record<string, unknown>;
  const raw = q.orgId ?? b.orgId ?? (req.headers["x-org-id"] as string | undefined);
  const n = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) throw new Error("orgId required");
  return n;
}

export async function list(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    await assertUserCanAccessOrg(userId, orgId);
    const status = req.query.status as string | undefined;
    const stockRequestId = req.query.stockRequestId ? Number(req.query.stockRequestId) : undefined;
    const page = req.query.page ? Number(req.query.page) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const data = await service.listProcurementDemands({
      orgId,
      status: status as any,
      stockRequestId: stockRequestId && Number.isFinite(stockRequestId) ? stockRequestId : undefined,
      page,
      limit,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    const code = e.message === "Forbidden: org access" ? 403 : 400;
    return res.status(code).json({ success: false, message: e?.message ?? "List failed" });
  }
}

export async function getById(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    await assertUserCanAccessOrg(userId, orgId);
    const id = Number(req.params.id);
    const row = await service.getProcurementDemandById(id, orgId);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: row });
  } catch (e: any) {
    const code = e.message === "Forbidden: org access" ? 403 : 400;
    return res.status(code).json({ success: false, message: e?.message ?? "Get failed" });
  }
}

export async function linkPoLine(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    await assertUserCanAccessOrg(userId, orgId);
    const demandId = Number(req.params.id);
    const purchaseOrderLineId = Number((req.body as any)?.purchaseOrderLineId);
    if (!Number.isFinite(purchaseOrderLineId)) {
      return res.status(400).json({ success: false, message: "purchaseOrderLineId required" });
    }
    const data = await service.linkDemandToPurchaseOrderLine({
      demandId,
      orgId,
      purchaseOrderLineId,
      actorUserId: userId,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    const code = e.message === "Forbidden: org access" ? 403 : 400;
    return res.status(code).json({ success: false, message: e?.message ?? "Link failed" });
  }
}

export async function cancel(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    await assertUserCanAccessOrg(userId, orgId);
    const demandId = Number(req.params.id);
    const reason = (req.body as any)?.reason as string | undefined;
    const data = await service.cancelProcurementDemand({
      demandId,
      orgId,
      reason,
      actorUserId: userId,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    const code = e.message === "Forbidden: org access" ? 403 : 400;
    return res.status(code).json({ success: false, message: e?.message ?? "Cancel failed" });
  }
}

export async function processGrn(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    await assertUserCanAccessOrg(userId, orgId);
    const grnId = Number(req.params.grnId);
    const { reprocessProcurementDemandAfterGrn } = require("./procurementDemand.service");
    const data = await reprocessProcurementDemandAfterGrn(grnId, orgId);
    return res.json({ success: true, message: "Processed", data });
  } catch (e: any) {
    if (e?.message === "GRN not found") {
      return res.status(404).json({ success: false, message: e.message });
    }
    const code = e.message === "Forbidden: org access" ? 403 : 400;
    return res.status(code).json({ success: false, message: e?.message ?? "Process failed" });
  }
}

module.exports = {
  list,
  getById,
  linkPoLine,
  cancel,
  processGrn,
};
