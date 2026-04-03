import * as taskService from "./putawayTask.service";
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

export async function listTasks(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(200).json({ success: true, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    const result = await taskService.listPutawayTasks(ctx.orgId, {
      status: req.query.status as string | undefined,
      warehouseId: req.query.warehouseId ? Number(req.query.warehouseId) : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e: any) {
    console.error("putaway.listTasks", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function recommendations(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const grnLineId = req.query.grnLineId != null ? Number(req.query.grnLineId) : NaN;
    if (!Number.isFinite(grnLineId)) {
      return res.status(400).json({ success: false, message: "grnLineId query required" });
    }
    const data = await taskService.getPutawayRecommendationsPreview({ orgId: ctx.orgId, grnLineId });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("putaway.recommendations", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function confirm(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const { toLocationId } = req.body || {};
    if (!toLocationId) return res.status(400).json({ success: false, message: "toLocationId required" });
    const result = await taskService.confirmPutawayTask(Number(req.params.id), ctx.orgId, ctx.userId, Number(toLocationId));
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    console.error("putaway.confirm", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}
