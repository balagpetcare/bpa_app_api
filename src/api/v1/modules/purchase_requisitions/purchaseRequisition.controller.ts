import * as service from "./purchaseRequisition.service";
import { getOrgIdsForUser } from "../grn/grn.service";

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function resolveOrgId(req: any, body?: any): Promise<{ userId: number; orgId: number } | null> {
  const userId = getUserId(req);
  if (!userId) return null;
  const orgIds = await getOrgIdsForUser(userId);
  if (!orgIds.length) return null;
  const raw = body?.orgId ?? req.query.orgId;
  const q = raw != null ? Number(raw) : orgIds[0];
  if (!orgIds.includes(q)) return null;
  return { userId, orgId: q };
}

export async function create(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req, req.body);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const { warehouseId, vendorId, notes, lines } = req.body || {};
    if (!lines?.length) return res.status(400).json({ success: false, message: "lines[] required" });
    const pr = await service.createPurchaseRequisition({
      orgId: ctx.orgId,
      warehouseId: warehouseId != null ? Number(warehouseId) : undefined,
      vendorId: vendorId != null ? Number(vendorId) : undefined,
      notes,
      requestedByUserId: ctx.userId,
      lines: lines.map((l: any) => ({
        variantId: Number(l.variantId),
        requestedQty: Number(l.requestedQty),
        unitCost: l.unitCost != null ? Number(l.unitCost) : undefined,
        note: l.note,
      })),
    });
    return res.status(201).json({ success: true, data: pr });
  } catch (e: any) {
    console.error("purchaseRequisition.create", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function list(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(200).json({ success: true, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    const result = await service.listPurchaseRequisitions(ctx.orgId, {
      status: req.query.status as string | undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e: any) {
    console.error("purchaseRequisition.list", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function getById(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const pr = await service.getPurchaseRequisitionById(id, ctx.orgId);
    if (!pr) return res.status(404).json({ success: false, message: "Not found" });
    return res.status(200).json({ success: true, data: pr });
  } catch (e: any) {
    console.error("purchaseRequisition.getById", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function submit(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const pr = await service.submitPurchaseRequisition(id, ctx.orgId, ctx.userId);
    return res.status(200).json({ success: true, data: pr });
  } catch (e: any) {
    console.error("purchaseRequisition.submit", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function approve(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const pr = await service.approvePurchaseRequisition(id, ctx.orgId, ctx.userId);
    return res.status(200).json({ success: true, data: pr });
  } catch (e: any) {
    console.error("purchaseRequisition.approve", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function reject(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const { reason } = req.body || {};
    const pr = await service.rejectPurchaseRequisition(id, ctx.orgId, ctx.userId, reason || "Rejected");
    return res.status(200).json({ success: true, data: pr });
  } catch (e: any) {
    console.error("purchaseRequisition.reject", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function convertToPo(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const { lineSelections } = req.body || {};
    const po = await service.convertPurchaseRequisitionToPo(id, ctx.orgId, ctx.userId, {
      lineSelections: Array.isArray(lineSelections)
        ? lineSelections.map((x: any) => ({ lineId: Number(x.lineId), qty: Number(x.qty) }))
        : undefined,
    });
    return res.status(201).json({ success: true, data: po });
  } catch (e: any) {
    console.error("purchaseRequisition.convertToPo", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}
