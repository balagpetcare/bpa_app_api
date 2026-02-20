/**
 * Stock Count (cycle count) controller.
 * POST /inventory/stock-counts, POST /:id/freeze, PATCH /:id/lines, POST /:id/post
 */
const prisma = require("../../../../infrastructure/db/prismaClient");
const stockCountService = require("./stockCount.service");

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function getOrgIds(req: any): Promise<number[]> {
  const userId = getUserId(req);
  if (!userId) return [];
  const ownerOrgs = await prisma.organization.findMany({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  if (ownerOrgs.length) return ownerOrgs.map((o: any) => o.id);
  const member = await prisma.orgMember.findFirst({
    where: { userId, status: "ACTIVE" },
    select: { orgId: true },
  });
  return member ? [member.orgId] : [];
}

async function ensureOrgAccess(orgId: number, req: any): Promise<boolean> {
  const orgIds = await getOrgIds(req);
  return orgIds.includes(orgId);
}

exports.createStockCount = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });
    const { locationId, note } = req.body || {};
    const locId = locationId != null ? parseInt(locationId, 10) : NaN;
    if (!Number.isInteger(locId)) return res.status(400).json({ success: false, message: "locationId required" });
    const location = await prisma.inventoryLocation.findUnique({
      where: { id: locId },
      include: { branch: true },
    });
    if (!location || !orgIds.includes(location.branch.orgId)) {
      return res.status(400).json({ success: false, message: "Location not found or not in your organization" });
    }
    const session = await stockCountService.createStockCount({
      orgId: location.branch.orgId,
      locationId: locId,
      note: note || undefined,
      createdByUserId: userId,
    });
    return res.status(201).json({ success: true, data: session, message: "Stock count session created" });
  } catch (e: any) {
    console.error("createStockCount error:", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to create session" });
  }
};

exports.freezeStockCount = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });
    const sessionId = parseInt(req.params.id, 10);
    if (!Number.isInteger(sessionId)) return res.status(400).json({ success: false, message: "Invalid session id" });
    const session = await prisma.stockCountSession.findFirst({
      where: { id: sessionId },
      select: { orgId: true },
    });
    if (!session || !orgIds.includes(session.orgId)) return res.status(404).json({ success: false, message: "Session not found" });
    const updated = await stockCountService.freezeStockCount(sessionId, session.orgId);
    return res.status(200).json({ success: true, data: updated, message: "Session frozen; system quantities snapshotted" });
  } catch (e: any) {
    console.error("freezeStockCount error:", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to freeze" });
  }
};

exports.upsertCountLines = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });
    const sessionId = parseInt(req.params.id, 10);
    if (!Number.isInteger(sessionId)) return res.status(400).json({ success: false, message: "Invalid session id" });
    const session = await prisma.stockCountSession.findFirst({
      where: { id: sessionId },
      select: { orgId: true, locationId: true },
    });
    if (!session || !orgIds.includes(session.orgId)) return res.status(404).json({ success: false, message: "Session not found" });
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    const payload = lines.map((l: any) => ({
      variantId: parseInt(l.variantId, 10),
      lotId: l.lotId != null ? parseInt(l.lotId, 10) : undefined,
      countedQty: parseInt(l.countedQty, 10) || 0,
    }));
    const updated = await stockCountService.upsertCountLines(sessionId, session.orgId, payload);
    return res.status(200).json({ success: true, data: updated, message: "Counts updated" });
  } catch (e: any) {
    console.error("upsertCountLines error:", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to update lines" });
  }
};

exports.postStockCount = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });
    const sessionId = parseInt(req.params.id, 10);
    if (!Number.isInteger(sessionId)) return res.status(400).json({ success: false, message: "Invalid session id" });
    const session = await prisma.stockCountSession.findFirst({
      where: { id: sessionId },
      select: { orgId: true },
    });
    if (!session || !orgIds.includes(session.orgId)) return res.status(404).json({ success: false, message: "Session not found" });
    const updated = await stockCountService.postStockCount(sessionId, session.orgId, userId);
    return res.status(200).json({ success: true, data: updated, message: "Stock count posted; adjustments applied" });
  } catch (e: any) {
    console.error("postStockCount error:", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to post" });
  }
};

exports.listStockCounts = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(200).json({ success: true, data: [] });
    const orgId = req.query.orgId ? parseInt(req.query.orgId, 10) : orgIds[0];
    if (!orgIds.includes(orgId)) return res.status(403).json({ success: false, message: "Organization not accessible" });
    const locationId = req.query.locationId ? parseInt(req.query.locationId, 10) : undefined;
    const status = req.query.status as string | undefined;
    const items = await stockCountService.listStockCounts(orgId, locationId, status);
    return res.status(200).json({ success: true, data: items });
  } catch (e: any) {
    console.error("listStockCounts error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list" });
  }
};

exports.getStockCountById = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });
    const sessionId = parseInt(req.params.id, 10);
    if (!Number.isInteger(sessionId)) return res.status(400).json({ success: false, message: "Invalid session id" });
    const orgId = req.query.orgId ? parseInt(req.query.orgId, 10) : orgIds[0];
    if (!orgIds.includes(orgId)) return res.status(403).json({ success: false, message: "Organization not accessible" });
    const session = await stockCountService.getStockCountById(sessionId, orgId);
    if (!session) return res.status(404).json({ success: false, message: "Session not found" });
    return res.status(200).json({ success: true, data: session });
  } catch (e: any) {
    console.error("getStockCountById error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};
