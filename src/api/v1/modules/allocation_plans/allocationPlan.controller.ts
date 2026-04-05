import * as service from "./allocationPlan.service";
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

export async function createFromStockRequest(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const { stockRequestId, fromLocationId, warehouseId, skipAutoAllocation } = req.body || {};
    if (!stockRequestId || !fromLocationId) {
      return res.status(400).json({ success: false, message: "stockRequestId and fromLocationId required" });
    }
    const plan = await service.createFromStockRequest({
      orgId: ctx.orgId,
      stockRequestId: Number(stockRequestId),
      fromLocationId: Number(fromLocationId),
      warehouseId: warehouseId != null ? Number(warehouseId) : undefined,
      createdByUserId: ctx.userId,
      skipAutoAllocation: Boolean(skipAutoAllocation),
    });
    return res.status(201).json({ success: true, data: plan });
  } catch (e: any) {
    console.error("allocationPlan.createFromStockRequest", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function createFromMedicineRequisition(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req, req.body);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const { medicineRequisitionId, fromLocationId, warehouseId, skipAutoAllocation } = req.body || {};
    if (!medicineRequisitionId || !fromLocationId) {
      return res.status(400).json({ success: false, message: "medicineRequisitionId and fromLocationId required" });
    }
    const plan = await service.createFromMedicineRequisition({
      orgId: ctx.orgId,
      medicineRequisitionId: Number(medicineRequisitionId),
      fromLocationId: Number(fromLocationId),
      warehouseId: warehouseId != null ? Number(warehouseId) : undefined,
      createdByUserId: ctx.userId,
      skipAutoAllocation: Boolean(skipAutoAllocation),
    });
    return res.status(201).json({ success: true, data: plan });
  } catch (e: any) {
    console.error("allocationPlan.createFromMedicineRequisition", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function runFefo(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const plan = await service.runFefoForPlan(id, ctx.orgId, { actorUserId: ctx.userId });
    return res.status(200).json({ success: true, data: plan });
  } catch (e: any) {
    console.error("allocationPlan.runFefo", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function confirm(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req, req.body);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const expectedVersion = req.body?.expectedVersion != null ? Number(req.body.expectedVersion) : undefined;
    const plan = await service.confirmPlan(id, ctx.orgId, ctx.userId, {
      expectedVersion: Number.isFinite(expectedVersion as number) ? expectedVersion : undefined,
    });
    return res.status(200).json({ success: true, data: plan });
  } catch (e: any) {
    console.error("allocationPlan.confirm", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function cancel(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const { reason } = req.body || {};
    const plan = await service.cancelPlan(id, ctx.orgId, reason, ctx.userId);
    return res.status(200).json({ success: true, data: plan });
  } catch (e: any) {
    console.error("allocationPlan.cancel", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function addManualLine(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req, req.body);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const { variantId, lotId, locationId, quantity } = req.body || {};
    if (!variantId || !lotId || !locationId || quantity == null) {
      return res.status(400).json({ success: false, message: "variantId, lotId, locationId, quantity required" });
    }
    const plan = await service.addManualAllocationLine(
      id,
      ctx.orgId,
      {
        variantId: Number(variantId),
        lotId: Number(lotId),
        locationId: Number(locationId),
        quantity: Number(quantity),
      },
      ctx.userId
    );
    return res.status(200).json({ success: true, data: plan });
  } catch (e: any) {
    console.error("allocationPlan.addManualLine", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function reallocate(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const plan = await service.reallocatePlan(id, ctx.orgId, ctx.userId);
    return res.status(200).json({ success: true, data: plan });
  } catch (e: any) {
    console.error("allocationPlan.reallocate", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function getById(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    const plan = await service.getPlanById(id, ctx.orgId);
    if (!plan) return res.status(404).json({ success: false, message: "Not found" });
    return res.status(200).json({ success: true, data: plan });
  } catch (e: any) {
    console.error("allocationPlan.getById", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function list(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const result = await service.listPlans(ctx.orgId, {
      status: req.query.status as string | undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e: any) {
    console.error("allocationPlan.list", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}
