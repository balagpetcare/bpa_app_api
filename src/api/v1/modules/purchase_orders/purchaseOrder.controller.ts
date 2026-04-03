/**
 * Owner/org-scoped purchase orders.
 */
import * as service from "./purchaseOrder.service";
import { getOrgIdsForUser } from "../grn/grn.service";
import { tryRespondPrismaSchemaDrift } from "../../utils/prismaSchemaDriftResponse";

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

    const { vendorId, warehouseId, purchaseRequisitionId, lines, expectedDeliveryDate, notes, internalNote, currency } =
      req.body || {};
    if (!vendorId || !lines?.length) {
      return res.status(400).json({ success: false, message: "vendorId and lines[] are required" });
    }

    const po = await service.createPurchaseOrder({
      orgId: ctx.orgId,
      vendorId: Number(vendorId),
      warehouseId: warehouseId != null ? Number(warehouseId) : undefined,
      purchaseRequisitionId: purchaseRequisitionId != null ? Number(purchaseRequisitionId) : undefined,
      lines: lines.map((l: any) => ({
        variantId: Number(l.variantId),
        orderedQty: Number(l.orderedQty),
        unitCost: l.unitCost != null ? Number(l.unitCost) : undefined,
        note: l.note,
      })),
      expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : undefined,
      notes,
      internalNote,
      currency,
      createdByUserId: ctx.userId,
    });
    return res.status(201).json({ success: true, data: po });
  } catch (e: any) {
    console.error("purchaseOrder.create", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to create purchase order" });
  }
}

export async function list(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(200).json({ success: true, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });

    const result = await service.listPurchaseOrders(ctx.orgId, {
      status: req.query.status as string | undefined,
      vendorId: req.query.vendorId ? Number(req.query.vendorId) : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e: any) {
    console.error("purchaseOrder.list", e);
    if (tryRespondPrismaSchemaDrift(res, e)) return;
    return res.status(500).json({ success: false, message: e?.message || "Failed to list" });
  }
}

export async function getById(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const po = await service.getPurchaseOrderById(id, ctx.orgId);
    if (!po) return res.status(404).json({ success: false, message: "Not found" });
    return res.status(200).json({ success: true, data: po });
  } catch (e: any) {
    console.error("purchaseOrder.getById", e);
    if (tryRespondPrismaSchemaDrift(res, e)) return;
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function submit(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const po = await service.submitPurchaseOrder(id, ctx.orgId, ctx.userId);
    return res.status(200).json({ success: true, data: po });
  } catch (e: any) {
    console.error("purchaseOrder.submit", e);
    if (tryRespondPrismaSchemaDrift(res, e)) return;
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function approve(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const po = await service.approvePurchaseOrder(id, ctx.orgId, ctx.userId);
    return res.status(200).json({ success: true, data: po });
  } catch (e: any) {
    console.error("purchaseOrder.approve", e);
    if (tryRespondPrismaSchemaDrift(res, e)) return;
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function reject(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const { reason } = req.body || {};
    const po = await service.rejectPurchaseOrder(id, ctx.orgId, ctx.userId, reason || "Rejected");
    return res.status(200).json({ success: true, data: po });
  } catch (e: any) {
    console.error("purchaseOrder.reject", e);
    if (tryRespondPrismaSchemaDrift(res, e)) return;
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function cancel(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const { reason } = req.body || {};
    const po = await service.cancelPurchaseOrder(id, ctx.orgId, reason, ctx.userId);
    return res.status(200).json({ success: true, data: po });
  } catch (e: any) {
    console.error("purchaseOrder.cancel", e);
    if (tryRespondPrismaSchemaDrift(res, e)) return;
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}
