import { getOrgIdsForUser } from "../grn/grn.service";
import * as service from "./qcInspection.service";

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function resolveOrg(req: any): Promise<{ userId: number; orgId: number } | null> {
  const userId = getUserId(req);
  if (!userId) return null;
  const orgIds = await getOrgIdsForUser(userId);
  if (!orgIds.length) return null;
  const raw = req.body?.orgId ?? req.query.orgId;
  const orgId = raw != null ? Number(raw) : orgIds[0];
  if (!orgIds.includes(orgId)) return null;
  return { userId, orgId };
}

export async function listQueue(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const warehouseId = req.query.warehouseId != null ? Number(req.query.warehouseId) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const page = req.query.page ? Number(req.query.page) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const data = await service.listInspectionQueue({
      orgId: ctx.orgId,
      warehouseId,
      status,
      page,
      limit,
    });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("qc.listQueue", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function listQuarantine(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const warehouseId = req.query.warehouseId != null ? Number(req.query.warehouseId) : undefined;
    const page = req.query.page ? Number(req.query.page) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const data = await service.listQuarantineHold({ orgId: ctx.orgId, warehouseId, page, limit });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("qc.listQuarantine", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function listEscalations(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const warehouseId = req.query.warehouseId != null ? Number(req.query.warehouseId) : undefined;
    const data = await service.listEscalations(ctx.orgId, warehouseId);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("qc.listEscalations", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function getById(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const row = await service.getInspectionById(id, ctx.orgId);
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    if (e?.message === "QC inspection not found") return res.status(404).json({ success: false, message: e.message });
    console.error("qc.getById", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function submit(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const body = req.body || {};
    const data = await service.submitInspection(id, ctx.orgId, ctx.userId, {
      inspectedQty: Number(body.inspectedQty),
      passedQty: Number(body.passedQty),
      failedQty: Number(body.failedQty),
      disposition: body.disposition,
      quarantineLocationId: body.quarantineLocationId,
      failureReason: body.failureReason,
      note: body.note,
      evidenceFileKey1: body.evidenceFileKey1,
      evidenceFileKey2: body.evidenceFileKey2,
    });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("qc.submit", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function release(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const { quantity, targetLocationId } = req.body || {};
    const data = await service.releaseFromQuarantine(id, ctx.orgId, ctx.userId, {
      quantity: Number(quantity),
      targetLocationId: Number(targetLocationId),
    });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("qc.release", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function dispose(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const { quantity, note } = req.body || {};
    const data = await service.disposeQuarantine(id, ctx.orgId, ctx.userId, {
      quantity: Number(quantity),
      note,
    });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("qc.dispose", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

module.exports = {
  listQueue,
  listQuarantine,
  listEscalations,
  getById,
  submit,
  release,
  dispose,
};
