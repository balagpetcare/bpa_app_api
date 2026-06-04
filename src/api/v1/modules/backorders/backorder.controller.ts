import * as service from "./backorder.service";
import { getOrgIdsForUser } from "../grn/grn.service";

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
  const raw = req.body?.orgId ?? req.query?.orgId;
  const orgId = raw != null ? Number(raw) : orgIds[0];
  if (!orgIds.includes(orgId)) return null;
  return { userId, orgId };
}

export async function list(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });

    const result = await service.listBackorders({
      orgId: ctx.orgId,
      status: req.query.status as string | undefined,
      stockRequestId: req.query.stockRequestId ? Number(req.query.stockRequestId) : undefined,
      variantId: req.query.variantId ? Number(req.query.variantId) : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e: any) {
    console.error("backorder.list", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function getById(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });

    const bo = await service.getBackorderById(Number(req.params.id), ctx.orgId);
    if (!bo) return res.status(404).json({ success: false, message: "Backorder not found" });

    return res.status(200).json({ success: true, data: bo });
  } catch (e: any) {
    console.error("backorder.getById", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function update(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });

    const updated = await service.updateBackorder(Number(req.params.id), ctx.orgId, {
      notes: req.body?.notes,
      procurementDemandLineId: req.body?.procurementDemandLineId
        ? Number(req.body.procurementDemandLineId)
        : undefined,
      status: req.body?.status,
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (e: any) {
    console.error("backorder.update", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function cancel(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });

    const cancelled = await service.cancelBackorder(Number(req.params.id), ctx.orgId);
    return res.status(200).json({ success: true, data: cancelled });
  } catch (e: any) {
    console.error("backorder.cancel", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}
