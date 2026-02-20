/**
 * GRN (Goods Received Note) controller.
 * POST /api/v1/grn, GET /api/v1/grn, GET /api/v1/grn/:id, PATCH /api/v1/grn/:id, POST /api/v1/grn/:id/receive
 */
const service = require("./grn.service");
const prisma = require("../../../../infrastructure/db/prismaClient").default;

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function getOrgIds(req: any): Promise<number[]> {
  const userId = getUserId(req);
  if (!userId) return [];
  return service.getOrgIdsForUser(userId);
}

export async function create(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const { vendorId, locationId, notes, invoiceNo, invoiceDate, lines } = req.body;
    if (!vendorId || !locationId || !lines?.length) {
      return res.status(400).json({ success: false, message: "vendorId, locationId, and lines (array) are required" });
    }
    const location = await prisma.inventoryLocation.findUnique({
      where: { id: Number(locationId) },
      include: { branch: true },
    });
    if (!location || !orgIds.includes(location.branch.orgId)) {
      return res.status(400).json({ success: false, message: "Location not found or not in your organization" });
    }
    const orgId = location.branch.orgId;
    const grn = await service.createGrn({
      orgId,
      vendorId: Number(vendorId),
      locationId: Number(locationId),
      invoiceNo: invoiceNo ?? undefined,
      invoiceDate: invoiceDate ?? undefined,
      notes: notes || undefined,
      lines: lines.map((l: any) => ({
        variantId: Number(l.variantId),
        quantity: Number(l.quantity),
        unitCost: l.unitCost != null ? Number(l.unitCost) : undefined,
        lotCode: l.lotCode,
        mfgDate: l.mfgDate,
        expDate: l.expDate,
      })),
    });
    return res.status(201).json({ success: true, data: grn });
  } catch (e: any) {
    console.error("grn.create", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to create GRN" });
  }
}

export async function list(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(200).json({ success: true, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });

    const orgId = req.query.orgId ? Number(req.query.orgId) : orgIds[0];
    if (!orgIds.includes(orgId)) return res.status(403).json({ success: false, message: "Organization not accessible" });

    const result = await service.listGrns({
      orgId,
      locationId: req.query.locationId ? Number(req.query.locationId) : undefined,
      vendorId: req.query.vendorId ? Number(req.query.vendorId) : undefined,
      status: req.query.status as string | undefined,
      dateFrom: req.query.dateFrom as string | undefined,
      dateTo: req.query.dateTo as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    });
    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e: any) {
    console.error("grn.list", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list GRNs" });
  }
}

export async function getById(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const orgId = orgIds[0];
    const grn = await service.getGrnById(id, orgId);
    if (!grn) return res.status(404).json({ success: false, message: "GRN not found" });
    return res.status(200).json({ success: true, data: grn });
  } catch (e: any) {
    console.error("grn.getById", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get GRN" });
  }
}

export async function update(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const orgId = orgIds[0];
    const { notes, lines } = req.body || {};
    const grn = await service.updateGrn(id, orgId, {
      notes,
      lines: lines?.map((l: any) => ({
        variantId: Number(l.variantId),
        quantity: Number(l.quantity),
        lotCode: l.lotCode,
        mfgDate: l.mfgDate,
        expDate: l.expDate,
      })),
    });
    return res.status(200).json({ success: true, data: grn });
  } catch (e: any) {
    console.error("grn.update", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to update GRN" });
  }
}

export async function receive(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const orgId = orgIds[0];
    const grn = await service.receiveGrn(id, orgId, userId);
    return res.status(200).json({ success: true, data: grn, message: "GRN received" });
  } catch (e: any) {
    console.error("grn.receive", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to receive GRN" });
  }
}
