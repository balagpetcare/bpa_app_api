import * as service from "./fulfillment.service";
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

export async function startFromStockRequest(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const stockRequestId = Number(req.params.id);
    const { fromLocationId, warehouseId, skipAutoAllocation } = req.body || {};
    if (!fromLocationId) {
      return res.status(400).json({ success: false, message: "fromLocationId required" });
    }
    const { plan, isExisting } = await service.startStockRequestFulfillment({
      orgId: ctx.orgId,
      stockRequestId,
      fromLocationId: Number(fromLocationId),
      warehouseId: warehouseId != null ? Number(warehouseId) : undefined,
      createdByUserId: ctx.userId,
      skipAutoAllocation: Boolean(skipAutoAllocation),
    });
    return res.status(isExisting ? 200 : 201).json({
      success: true,
      data: plan,
      meta: { existingPlan: isExisting },
    });
  } catch (e: any) {
    console.error("fulfillment.startFromStockRequest", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function getStockRequestStatus(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const stockRequestId = Number(req.params.id);
    const data = await service.getStockRequestFulfillmentStatus(stockRequestId, ctx.orgId);
    if (!data) return res.status(404).json({ success: false, message: "Not found" });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("fulfillment.getStockRequestStatus", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}
