import * as service from "./pickList.service";
import { parsePickListLineUpdatesFromBody } from "./pickListLinePayload";
import { getOrgIdsForUser } from "../grn/grn.service";
import { notifyWarehouseStaffPickListCreated } from "../../services/warehouseOpsNotifications.service";

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
    try {
      if (pl?.id) {
        await notifyWarehouseStaffPickListCreated({
          orgId: ctx.orgId,
          pickListId: pl.id,
          allocationPlanId: planId,
        });
      }
    } catch (notifErr: any) {
      console.warn("pickList.createFromPlan notification", notifErr?.message);
    }
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
    const lineUpdates = parsePickListLineUpdatesFromBody(req.body);
    const pl = await service.completePicking(id, ctx.orgId, ctx.userId, { lineUpdates });
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
    if (toLocationId === undefined || toLocationId === null || toLocationId === "") {
      return res.status(400).json({
        success: false,
        message:
          "toLocationId is required — select the destination branch receive location (active inventory location on the requester branch).",
      });
    }
    const n = Number(toLocationId);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ success: false, message: "Invalid toLocationId" });
    }
    const parsedTo = Math.floor(n);
    const pl = await service.handoffToDispatch(id, ctx.orgId, {
      toLocationId: parsedTo,
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
    const workQueue =
      String(req.query.workQueue || "").toLowerCase() === "1" || req.query.workQueue === "true";
    const mineStrict =
      String(req.query.mine || "").toLowerCase() === "1" || req.query.mine === "true";
    const branchIdRaw = req.query.branchId != null ? Number(req.query.branchId) : NaN;
    const fromLocationBranchId = Number.isFinite(branchIdRaw) && branchIdRaw > 0 ? branchIdRaw : undefined;

    const pickerParam = req.query.pickerUserId != null ? Number(req.query.pickerUserId) : NaN;
    const pickerUserIdFilter = Number.isFinite(pickerParam) && pickerParam > 0 ? pickerParam : undefined;

    const result = await service.listPickLists(ctx.orgId, {
      status: req.query.status as string | undefined,
      workQueueForUserId: workQueue ? ctx.userId : undefined,
      assignedPickerUserId:
        !workQueue && mineStrict ? ctx.userId : !workQueue && pickerUserIdFilter ? pickerUserIdFilter : undefined,
      fromLocationBranchId,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e: any) {
    console.error("pickList.list", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}
