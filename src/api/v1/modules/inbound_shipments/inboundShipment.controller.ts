import * as service from "./inboundShipment.service";
import { getOrgIdsForUser } from "../grn/grn.service";

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function resolveOrgId(req: any, body?: any): Promise<{ orgId: number } | null> {
  const userId = getUserId(req);
  if (!userId) return null;
  const orgIds = await getOrgIdsForUser(userId);
  if (!orgIds.length) return null;
  const raw = body?.orgId ?? req.query.orgId;
  const q = raw != null ? Number(raw) : orgIds[0];
  if (!orgIds.includes(q)) return null;
  return { orgId: q };
}

export async function create(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req, req.body);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const { vendorId, purchaseOrderId, reference, expectedArrivalAt, shipToWarehouseId, shipFromJson, metaJson, lines } =
      req.body || {};
    if (!vendorId || !reference || !lines?.length) {
      return res.status(400).json({ success: false, message: "vendorId, reference, lines[] required" });
    }
    const row = await service.createInboundShipment({
      orgId: ctx.orgId,
      vendorId: Number(vendorId),
      purchaseOrderId: purchaseOrderId != null ? Number(purchaseOrderId) : undefined,
      reference: String(reference),
      expectedArrivalAt: expectedArrivalAt ? new Date(expectedArrivalAt) : undefined,
      shipToWarehouseId: shipToWarehouseId != null ? Number(shipToWarehouseId) : undefined,
      shipFromJson,
      metaJson,
      lines: lines.map((l: any) => ({
        variantId: Number(l.variantId),
        expectedQty: Number(l.expectedQty),
        purchaseOrderLineId: l.purchaseOrderLineId != null ? Number(l.purchaseOrderLineId) : undefined,
        batchHint: l.batchHint,
      })),
    });
    return res.status(201).json({ success: true, data: row });
  } catch (e: any) {
    console.error("inboundShipment.create", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function list(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(200).json({ success: true, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    const result = await service.listInboundShipments(ctx.orgId, {
      status: req.query.status as string | undefined,
      vendorId: req.query.vendorId ? Number(req.query.vendorId) : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e: any) {
    console.error("inboundShipment.list", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function getById(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const row = await service.getInboundShipmentById(Number(req.params.id), ctx.orgId);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("inboundShipment.getById", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}

export async function patch(req: any, res: any) {
  try {
    const ctx = await resolveOrgId(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });
    const { status, expectedArrivalAt, metaJson } = req.body || {};
    const row = await service.patchInboundShipment(Number(req.params.id), ctx.orgId, {
      status,
      expectedArrivalAt: expectedArrivalAt !== undefined ? (expectedArrivalAt ? new Date(expectedArrivalAt) : null) : undefined,
      metaJson,
    });
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("inboundShipment.patch", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}
