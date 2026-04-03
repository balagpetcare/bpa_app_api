import { getManagedBranchesForUser } from "../../services/branchManager.service";
import * as financial from "./financialIntelligence.service";
import * as slo from "./slo.service";
import * as ops from "./operationalExceptionIndex.service";

const db = require("../../../../infrastructure/db/prismaClient").default;

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function canAccessOrg(userId: number, orgId: number): Promise<boolean> {
  const owned = await db.organization.findFirst({
    where: { id: orgId, ownerUserId: userId },
    select: { id: true },
  });
  if (owned) return true;
  const managed = await getManagedBranchesForUser(userId);
  return managed.some((m: { orgId: number }) => m.orgId === orgId);
}

function parseWindow(req: any): { periodStart: Date; periodEnd: Date } | null {
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return { periodStart: from, periodEnd: to };
}

/** GET /intelligence/financial/summary?orgId=&from=&to=&branchId= */
export async function getFinancialSummary(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = Number(req.query.orgId);
    if (!Number.isFinite(orgId)) {
      return res.status(400).json({ success: false, message: "orgId required" });
    }
    if (!(await canAccessOrg(userId, orgId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const window = parseWindow(req);
    if (!window) {
      return res.status(400).json({ success: false, message: "from and to (ISO dates) required" });
    }
    const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
    const data = await financial.getFinancialSummary(orgId, window, branchId);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("operationalIntelligence.getFinancialSummary", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** GET /intelligence/financial/cts?orgId=&variantId=&branchId=&from=&to= */
export async function getCts(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = Number(req.query.orgId);
    const variantId = Number(req.query.variantId);
    const branchId = Number(req.query.branchId);
    if (!Number.isFinite(orgId) || !Number.isFinite(variantId) || !Number.isFinite(branchId)) {
      return res.status(400).json({ success: false, message: "orgId, variantId, branchId required" });
    }
    if (!(await canAccessOrg(userId, orgId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const window = parseWindow(req);
    if (!window) {
      return res.status(400).json({ success: false, message: "from and to required" });
    }
    const data = await financial.getCtsDetail(orgId, variantId, branchId, window);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("operationalIntelligence.getCts", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** GET /intelligence/financial/cost-facts?orgId=&from=&to=&skip=&take= */
export async function getCostFacts(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = Number(req.query.orgId);
    if (!Number.isFinite(orgId)) {
      return res.status(400).json({ success: false, message: "orgId required" });
    }
    if (!(await canAccessOrg(userId, orgId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const window = parseWindow(req);
    if (!window) {
      return res.status(400).json({ success: false, message: "from and to required" });
    }
    const skip = req.query.skip ? Number(req.query.skip) : 0;
    const take = req.query.take ? Number(req.query.take) : 50;
    const data = await financial.listCostFacts(orgId, window, { skip, take });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("operationalIntelligence.getCostFacts", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** POST /intelligence/financial/refresh  body: { orgId, from, to } */
export async function postFinancialRefresh(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = Number(req.body?.orgId ?? req.query?.orgId);
    const from = req.body?.from ? new Date(req.body.from) : null;
    const to = req.body?.to ? new Date(req.body.to) : null;
    if (!Number.isFinite(orgId) || !from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return res.status(400).json({ success: false, message: "orgId, from, to required" });
    }
    if (!(await canAccessOrg(userId, orgId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const window = { periodStart: from, periodEnd: to };
    const rollup = await financial.runCostRollup(orgId, window);
    const sloRes = await slo.evaluateSlosForOrg(orgId, window);
    const opsRes = await ops.refreshOperationalExceptions(orgId);
    return res.json({
      success: true,
      data: { rollup, slo: sloRes, exceptions: opsRes },
    });
  } catch (e: any) {
    console.error("operationalIntelligence.postFinancialRefresh", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** GET /intelligence/slo/definitions?orgId= */
export async function getSloDefinitions(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = Number(req.query.orgId);
    if (!Number.isFinite(orgId)) {
      return res.status(400).json({ success: false, message: "orgId required" });
    }
    if (!(await canAccessOrg(userId, orgId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const data = await slo.listSloDefinitions(orgId);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("operationalIntelligence.getSloDefinitions", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** GET /intelligence/slo/measurements?orgId=&from=&to=&sloKey= */
export async function getSloMeasurements(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = Number(req.query.orgId);
    if (!Number.isFinite(orgId)) {
      return res.status(400).json({ success: false, message: "orgId required" });
    }
    if (!(await canAccessOrg(userId, orgId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const window = parseWindow(req);
    if (!window) {
      return res.status(400).json({ success: false, message: "from and to required" });
    }
    const sloKey = req.query.sloKey ? String(req.query.sloKey) : undefined;
    const data = await slo.listSloMeasurements(orgId, window, sloKey);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("operationalIntelligence.getSloMeasurements", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** PUT /intelligence/slo/definitions/:id */
export async function putSloDefinition(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    const orgId = Number(req.body?.orgId ?? req.query?.orgId);
    if (!Number.isFinite(id) || !Number.isFinite(orgId)) {
      return res.status(400).json({ success: false, message: "id and orgId required" });
    }
    if (!(await canAccessOrg(userId, orgId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const data = await slo.updateSloDefinition(orgId, id, {
      targetValue: req.body?.targetValue != null ? Number(req.body.targetValue) : undefined,
      isActive: req.body?.isActive,
      windowDays: req.body?.windowDays != null ? Number(req.body.windowDays) : undefined,
      metaJson: req.body?.metaJson,
    });
    if (!data) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("operationalIntelligence.putSloDefinition", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

module.exports = {
  getFinancialSummary,
  getCts,
  getCostFacts,
  postFinancialRefresh,
  getSloDefinitions,
  getSloMeasurements,
  putSloDefinition,
};
