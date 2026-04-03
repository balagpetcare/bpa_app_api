import * as service from "./inboundDiscrepancy.service";
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
    const { grnId, grnLineId, purchaseOrderLineId, variantId, discrepancyType, quantity, reasonCode, notes } =
      req.body || {};
    if (!grnId || !variantId || !discrepancyType || quantity == null) {
      return res.status(400).json({ success: false, message: "grnId, variantId, discrepancyType, quantity required" });
    }
    const row = await service.createInboundDiscrepancy({
      orgId: ctx.orgId,
      grnId: Number(grnId),
      grnLineId: grnLineId != null ? Number(grnLineId) : undefined,
      purchaseOrderLineId: purchaseOrderLineId != null ? Number(purchaseOrderLineId) : undefined,
      variantId: Number(variantId),
      discrepancyType: String(discrepancyType),
      quantity: Number(quantity),
      reasonCode,
      notes,
      actorUserId: ctx.userId,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (e: any) {
    console.error("inboundDiscrepancy.create", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function list(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(200).json({ success: true, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    const result = await service.listInboundDiscrepancies(ctx.orgId, {
      status: req.query.status as string | undefined,
      grnId: req.query.grnId ? Number(req.query.grnId) : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e: any) {
    console.error("inboundDiscrepancy.list", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function resolve(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const { resolutionNote } = req.body || {};
    const row = await service.resolveInboundDiscrepancy(Number(req.params.id), ctx.orgId, ctx.userId, resolutionNote);
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("inboundDiscrepancy.resolve", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}
