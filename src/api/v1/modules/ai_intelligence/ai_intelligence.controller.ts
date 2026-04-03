export {};
const db = require("../../../../infrastructure/db/prismaClient").default;
const { getManagedBranchesForUser } = require("../../services/branchManager.service");
const forecastService = require("./aiForecast.service");
const replenishmentService = require("./replenishment.service");
const procurementService = require("./procurement.service");
const controlTowerService = require("./controlTower.service");
const planningAlertsService = require("./planningAlerts.service");

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function canAccessBranch(userId: number, branchId: number): Promise<boolean> {
  const branch = await db.branch.findUnique({
    where: { id: branchId },
    select: { id: true, orgId: true },
  });
  if (!branch) return false;
  const managed = await getManagedBranchesForUser(userId);
  if (managed.some((b: any) => b.branchId === branch.id)) return true;
  const owned = await db.organization.findFirst({
    where: { id: branch.orgId, ownerUserId: userId },
    select: { id: true },
  });
  return !!owned;
}

async function getOrgIdFromBranch(branchId: number): Promise<number | null> {
  const b = await db.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
  return b?.orgId ?? null;
}

/** GET /forecast?branchId=&horizonDays=&variantId=&warehouseId=&productId=&categoryId=&planningScope= */
async function getForecast(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.query.branchId);
    const horizonDays = req.query.horizonDays ? Number(req.query.horizonDays) : undefined;
    const variantId = req.query.variantId ? Number(req.query.variantId) : undefined;
    const productId = req.query.productId ? Number(req.query.productId) : undefined;
    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : undefined;
    const planningScope = req.query.planningScope === "WAREHOUSE" ? "WAREHOUSE" : "BRANCH";
    if (!Number.isFinite(branchId)) {
      return res.status(400).json({ success: false, message: "branchId required" });
    }
    if (!(await canAccessBranch(userId, branchId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const b = await db.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
    if (!b) return res.status(404).json({ success: false, message: "Branch not found" });
    const data = await forecastService.listForecastSnapshots({
      orgId: b.orgId,
      branchId,
      horizonDays,
      variantId,
      productId,
      categoryId,
      warehouseId: Number.isFinite(warehouseId) && warehouseId! > 0 ? warehouseId : undefined,
      planningScope: warehouseId && warehouseId > 0 ? "WAREHOUSE" : planningScope,
      take: req.query.take ? Number(req.query.take) : 200,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("ai.getForecast", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** GET /replenishment/suggestions?branchId=&status= */
async function getReplenishmentSuggestions(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.query.branchId);
    if (!Number.isFinite(branchId)) {
      return res.status(400).json({ success: false, message: "branchId required" });
    }
    if (!(await canAccessBranch(userId, branchId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const b = await db.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
    if (!b) return res.status(404).json({ success: false, message: "Branch not found" });
    const raw = req.query.status as string | undefined;
    const status =
      raw === "ACCEPTED" || raw === "DISMISSED" || raw === "OPEN" || raw === "ALL" ? raw : "OPEN";
    const data = await replenishmentService.listSuggestions({
      orgId: b.orgId,
      branchId,
      status,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("ai.getReplenishmentSuggestions", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** POST /replenishment/suggestions/:id/accept */
async function postAcceptSuggestion(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    const row = await db.aiReplenishmentSuggestion.findFirst({
      where: { id },
      select: { orgId: true, branchId: true },
    });
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    if (!(await canAccessBranch(userId, row.branchId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const data = await replenishmentService.acceptSuggestion(id, row.orgId, userId);
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    console.error("ai.postAcceptSuggestion", e);
    return res.status(400).json({ success: false, message: e?.message || "Unable to accept suggestion" });
  }
}

/** POST /replenishment/suggestions/:id/dismiss */
async function postDismissSuggestion(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    const row = await db.aiReplenishmentSuggestion.findFirst({
      where: { id },
      select: { orgId: true, branchId: true },
    });
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    if (!(await canAccessBranch(userId, row.branchId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    await replenishmentService.dismissSuggestion(id, row.orgId, userId);
    return res.json({ success: true });
  } catch (e: any) {
    console.error("ai.postDismissSuggestion", e);
    return res.status(400).json({ success: false, message: e?.message || "Unable to dismiss" });
  }
}

/** POST /replenishment/suggestions/bulk-dismiss body: { ids: number[] } */
async function postBulkDismissSuggestions(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x: any) => Number(x)).filter(Number.isFinite) : [];
    if (!ids.length) return res.status(400).json({ success: false, message: "ids required" });
    const first = await db.aiReplenishmentSuggestion.findFirst({
      where: { id: ids[0] },
      select: { orgId: true, branchId: true },
    });
    if (!first) return res.status(404).json({ success: false, message: "Not found" });
    if (!(await canAccessBranch(userId, first.branchId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const data = await replenishmentService.bulkDismissSuggestions(ids, first.orgId, userId);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("ai.postBulkDismissSuggestions", e);
    return res.status(400).json({ success: false, message: e?.message || "Bulk dismiss failed" });
  }
}

/** POST /replenishment/suggestions/bulk-accept body: { ids: number[] } */
async function postBulkAcceptSuggestions(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x: any) => Number(x)).filter(Number.isFinite) : [];
    if (!ids.length) return res.status(400).json({ success: false, message: "ids required" });
    const first = await db.aiReplenishmentSuggestion.findFirst({
      where: { id: ids[0] },
      select: { orgId: true, branchId: true },
    });
    if (!first) return res.status(404).json({ success: false, message: "Not found" });
    if (!(await canAccessBranch(userId, first.branchId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const data = await replenishmentService.bulkAcceptSuggestions(ids, first.orgId, userId);
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    console.error("ai.postBulkAcceptSuggestions", e);
    return res.status(400).json({ success: false, message: e?.message || "Bulk accept failed" });
  }
}

/** GET /procurement/recommendations?branchId= */
async function getProcurementRecommendations(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.query.branchId);
    if (!Number.isFinite(branchId)) {
      return res.status(400).json({ success: false, message: "branchId required" });
    }
    if (!(await canAccessBranch(userId, branchId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const orgId = await getOrgIdFromBranch(branchId);
    if (!orgId) return res.status(404).json({ success: false, message: "Branch not found" });
    const data = await procurementService.listProcurementRecommendations(orgId, branchId);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("ai.getProcurementRecommendations", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** GET /procurement/price-history?branchId=&variantId=&vendorId= */
async function getProcurementPriceHistory(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.query.branchId);
    const variantId = Number(req.query.variantId);
    const vendorId = req.query.vendorId ? Number(req.query.vendorId) : undefined;
    if (!Number.isFinite(branchId) || !Number.isFinite(variantId)) {
      return res.status(400).json({ success: false, message: "branchId and variantId required" });
    }
    if (!(await canAccessBranch(userId, branchId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const orgId = await getOrgIdFromBranch(branchId);
    if (!orgId) return res.status(404).json({ success: false, message: "Branch not found" });
    const data = await procurementService.getGrnPriceHistory({
      orgId,
      variantId,
      ...(vendorId && vendorId > 0 ? { vendorId } : {}),
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("ai.getProcurementPriceHistory", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** GET /procurement/lead-time-history?branchId=&vendorId= */
async function getProcurementLeadTimeHistory(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.query.branchId);
    const vendorId = Number(req.query.vendorId);
    if (!Number.isFinite(branchId) || !Number.isFinite(vendorId)) {
      return res.status(400).json({ success: false, message: "branchId and vendorId required" });
    }
    if (!(await canAccessBranch(userId, branchId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const orgId = await getOrgIdFromBranch(branchId);
    if (!orgId) return res.status(404).json({ success: false, message: "Branch not found" });
    const data = await procurementService.getVendorLeadTimeHistory(orgId, vendorId);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("ai.getProcurementLeadTimeHistory", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** GET /control-tower/overview?orgId= */
async function getControlTower(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = Number(req.query.orgId);
    if (!Number.isFinite(orgId)) {
      return res.status(400).json({ success: false, message: "orgId required" });
    }
    const org = await db.organization.findFirst({
      where: { id: orgId, ownerUserId: userId },
      select: { id: true },
    });
    if (!org) return res.status(403).json({ success: false, message: "Forbidden" });
    const data = await controlTowerService.getControlTowerOverview(orgId);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("ai.getControlTower", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** GET /alerts?orgId= */
async function getPlanningAlerts(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = Number(req.query.orgId);
    if (!Number.isFinite(orgId)) {
      return res.status(400).json({ success: false, message: "orgId required" });
    }
    const org = await db.organization.findFirst({
      where: { id: orgId, ownerUserId: userId },
      select: { id: true },
    });
    if (!org) return res.status(403).json({ success: false, message: "Forbidden" });
    const data = await planningAlertsService.getPlanningAlertsForOrg(orgId);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("ai.getPlanningAlerts", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** GET /demand-trend?branchId=&variantId=&windowDays=&warehouseId= */
async function getDemandTrend(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.query.branchId);
    const variantId = Number(req.query.variantId);
    const windowDays = req.query.windowDays ? Number(req.query.windowDays) : 90;
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : undefined;
    if (!Number.isFinite(branchId) || !Number.isFinite(variantId)) {
      return res.status(400).json({ success: false, message: "branchId and variantId required" });
    }
    if (!(await canAccessBranch(userId, branchId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const series = await forecastService.demandTrendSeries(
      branchId,
      variantId,
      windowDays,
      Number.isFinite(warehouseId) && warehouseId! > 0 ? warehouseId : undefined
    );
    return res.json({ success: true, data: { series } });
  } catch (e: any) {
    console.error("ai.getDemandTrend", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

module.exports = {
  getForecast,
  getReplenishmentSuggestions,
  postAcceptSuggestion,
  postDismissSuggestion,
  postBulkDismissSuggestions,
  postBulkAcceptSuggestions,
  getProcurementRecommendations,
  getProcurementPriceHistory,
  getProcurementLeadTimeHistory,
  getControlTower,
  getDemandTrend,
  getPlanningAlerts,
};
