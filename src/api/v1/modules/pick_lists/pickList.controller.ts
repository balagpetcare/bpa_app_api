import * as service from "./pickList.service";
import { getOrgIdsForUser } from "../grn/grn.service";

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function resolveOrg(req: any, body?: any): Promise<{ userId: number; orgId: number } | null> {
  const userId = getUserId(req);
  if (!userId) return null;
  const orgIds = await getOrgIdsForUser(userId);
  if (!orgIds.length) return null;
  const raw = body?.orgId ?? req.query.orgId;
  const orgId = raw != null ? Number(raw) : orgIds[0];
  if (!orgIds.includes(orgId)) return null;
  return { userId, orgId };
}

export async function createFromPlan(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const planId = Number(req.params.planId);
    const pl = await service.createPickListFromPlan(planId, ctx.orgId);
    return res.status(201).json({ success: true, data: pl });
  } catch (e: any) {
    console.error("pickList.createFromPlan", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function assignPicker(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const { pickerUserId } = req.body || {};
    if (!pickerUserId) return res.status(400).json({ success: false, message: "pickerUserId required" });
    const pl = await service.assignPicker(id, ctx.orgId, Number(pickerUserId));
    return res.status(200).json({ success: true, data: pl });
  } catch (e: any) {
    console.error("pickList.assignPicker", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function start(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const pl = await service.startPicking(id, ctx.orgId, ctx.userId);
    return res.status(200).json({ success: true, data: pl });
  } catch (e: any) {
    console.error("pickList.start", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function updateLine(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const pickListId = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    const { quantityPicked } = req.body || {};
    if (quantityPicked == null) return res.status(400).json({ success: false, message: "quantityPicked required" });
    const line = await service.updatePickLine(pickListId, lineId, ctx.orgId, Number(quantityPicked));
    return res.status(200).json({ success: true, data: line });
  } catch (e: any) {
    console.error("pickList.updateLine", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function complete(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const pl = await service.completePicking(id, ctx.orgId, ctx.userId);
    return res.status(200).json({ success: true, data: pl });
  } catch (e: any) {
    console.error("pickList.complete", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function handoff(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req, req.body);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const { toLocationId, transport } = req.body || {};
    if (!toLocationId) return res.status(400).json({ success: false, message: "toLocationId required" });
    const pl = await service.handoffToDispatch(id, ctx.orgId, {
      toLocationId: Number(toLocationId),
      transport,
      createdByUserId: ctx.userId,
    });
    return res.status(200).json({ success: true, data: pl });
  } catch (e: any) {
    console.error("pickList.handoff", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function getById(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const pl = await service.getPickListById(id, ctx.orgId);
    if (!pl) return res.status(404).json({ success: false, message: "Not found" });
    return res.status(200).json({ success: true, data: pl });
  } catch (e: any) {
    console.error("pickList.getById", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function printHtml(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const { renderPickListPrintHtml } = await import("../inventory/printDocuments.service");
    const html = await renderPickListPrintHtml(id, ctx.orgId);
    return res.type("html").send(html);
  } catch (e: any) {
    console.error("pickList.printHtml", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function list(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const result = await service.listPickLists(ctx.orgId, {
      status: req.query.status as string | undefined,
      assignedPickerUserId: req.query.mine ? ctx.userId : req.query.pickerUserId ? Number(req.query.pickerUserId) : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e: any) {
    console.error("pickList.list", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}
