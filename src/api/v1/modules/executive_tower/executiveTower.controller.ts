import { canAccessOrg } from "./orgAccess";
import { isBranchInOrg } from "./branchScope";
import * as tower from "./executiveTower.service";
import * as decisionPkg from "../decision_assist/decisionPackage.service";
import * as decisionApr from "../decision_assist/decisionApproval.service";
import * as scenario from "../scenario/scenarioSimulation.service";

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function requireExecRead(req: any): boolean {
  const p = req.user?.permissions || [];
  return (
    p.includes("inventory.executive_tower.read") ||
    p.includes("inventory.ai.control_tower.read") ||
    p.includes("org.read")
  );
}

function requireExecManage(req: any): boolean {
  const p = req.user?.permissions || [];
  return (
    p.includes("inventory.executive_tower.manage") ||
    p.includes("inventory.write") ||
    p.includes("org.write")
  );
}

/** GET /overview?orgId= */
export async function getOverview(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!requireExecRead(req)) {
      return res.status(403).json({ success: false, message: "Permission denied", code: "MISSING_PERMISSION" });
    }
    const orgId = Number(req.query.orgId);
    if (!Number.isFinite(orgId)) return res.status(400).json({ success: false, message: "orgId required" });
    if (!(await canAccessOrg(userId, orgId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const data = await tower.getExecutiveOverview(orgId);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("executiveTower.getOverview", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** GET /kpis?orgId=&domain= */
export async function getKpis(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!requireExecRead(req)) return res.status(403).json({ success: false, message: "Permission denied" });
    const orgId = Number(req.query.orgId);
    if (!Number.isFinite(orgId)) return res.status(400).json({ success: false, message: "orgId required" });
    if (!(await canAccessOrg(userId, orgId))) return res.status(403).json({ success: false, message: "Forbidden" });
    const domain = req.query.domain ? String(req.query.domain) : undefined;
    const branchRaw = req.query.branchId;
    const branchId = branchRaw !== undefined && branchRaw !== "" ? Number(branchRaw) : undefined;
    if (branchId !== undefined && !Number.isFinite(branchId)) {
      return res.status(400).json({ success: false, message: "Invalid branchId" });
    }
    if (branchId !== undefined && !(await isBranchInOrg(orgId, branchId))) {
      return res.status(400).json({ success: false, message: "branchId does not belong to org" });
    }
    const data = await tower.getExecutiveKpis(orgId, { domain, branchId });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("executiveTower.getKpis", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** GET /drilldown?orgId=&kpiKey=&branchId=&take= */
export async function getDrilldown(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!requireExecRead(req)) return res.status(403).json({ success: false, message: "Permission denied" });
    const orgId = Number(req.query.orgId);
    const kpiKey = String(req.query.kpiKey || "");
    if (!Number.isFinite(orgId) || !kpiKey) {
      return res.status(400).json({ success: false, message: "orgId and kpiKey required" });
    }
    if (!(await canAccessOrg(userId, orgId))) return res.status(403).json({ success: false, message: "Forbidden" });
    const branchRaw = req.query.branchId;
    const branchId = branchRaw !== undefined && branchRaw !== "" ? Number(branchRaw) : undefined;
    if (branchId !== undefined && !Number.isFinite(branchId)) {
      return res.status(400).json({ success: false, message: "Invalid branchId" });
    }
    if (branchId !== undefined && !(await isBranchInOrg(orgId, branchId))) {
      return res.status(400).json({ success: false, message: "branchId does not belong to org" });
    }
    const take = req.query.take ? Number(req.query.take) : 40;
    const data = await tower.getDrilldown(orgId, kpiKey, { branchId, take });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("executiveTower.getDrilldown", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** GET /decision-packages?orgId=&status= */
export async function getDecisionPackages(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!requireExecRead(req)) return res.status(403).json({ success: false, message: "Permission denied" });
    const orgId = Number(req.query.orgId);
    if (!Number.isFinite(orgId)) return res.status(400).json({ success: false, message: "orgId required" });
    if (!(await canAccessOrg(userId, orgId))) return res.status(403).json({ success: false, message: "Forbidden" });
    const status = req.query.status ? String(req.query.status) : undefined;
    const data = await decisionPkg.listDecisionPackages(orgId, status);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("executiveTower.getDecisionPackages", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** GET /decision-packages/:id?orgId= */
export async function getDecisionPackage(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!requireExecRead(req)) return res.status(403).json({ success: false, message: "Permission denied" });
    const orgId = Number(req.query.orgId);
    const id = Number(req.params.id);
    if (!Number.isFinite(orgId) || !Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "orgId and id required" });
    }
    if (!(await canAccessOrg(userId, orgId))) return res.status(403).json({ success: false, message: "Forbidden" });
    const data = await decisionPkg.getDecisionPackageById(orgId, id);
    if (!data) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("executiveTower.getDecisionPackage", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** POST /decision-packages/synthesize */
export async function postSynthesizeDecisionPackage(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!requireExecManage(req)) return res.status(403).json({ success: false, message: "Permission denied" });
    const orgId = Number(req.body?.orgId);
    if (!Number.isFinite(orgId)) return res.status(400).json({ success: false, message: "orgId required" });
    if (!(await canAccessOrg(userId, orgId))) return res.status(403).json({ success: false, message: "Forbidden" });
    const take = req.body?.take ? Number(req.body.take) : undefined;
    const data = await decisionPkg.synthesizeFromReplenishment({ orgId, createdByUserId: userId, take });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("executiveTower.postSynthesize", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** POST /decision-packages/:id/approve */
export async function postApprovePackage(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!requireExecManage(req)) return res.status(403).json({ success: false, message: "Permission denied" });
    const orgId = Number(req.body?.orgId);
    const packageId = Number(req.params.id);
    if (!Number.isFinite(orgId) || !Number.isFinite(packageId)) {
      return res.status(400).json({ success: false, message: "orgId and package id required" });
    }
    if (!(await canAccessOrg(userId, orgId))) return res.status(403).json({ success: false, message: "Forbidden" });
    const r = await decisionApr.approveDecisionPackage({
      orgId,
      packageId,
      actorUserId: userId,
      clientRequestId: req.body?.clientRequestId ? String(req.body.clientRequestId) : undefined,
      comment: req.body?.comment ? String(req.body.comment) : undefined,
    });
    if (!r.ok) return res.status(r.code === "NOT_FOUND" ? 404 : 409).json({ success: false, message: r.message });
    return res.json({ success: true, data: r });
  } catch (e: any) {
    console.error("executiveTower.postApprove", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** POST /decision-packages/:id/reject */
export async function postRejectPackage(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!requireExecManage(req)) return res.status(403).json({ success: false, message: "Permission denied" });
    const orgId = Number(req.body?.orgId);
    const packageId = Number(req.params.id);
    if (!Number.isFinite(orgId) || !Number.isFinite(packageId)) {
      return res.status(400).json({ success: false, message: "orgId and package id required" });
    }
    if (!(await canAccessOrg(userId, orgId))) return res.status(403).json({ success: false, message: "Forbidden" });
    const r = await decisionApr.rejectDecisionPackage({
      orgId,
      packageId,
      actorUserId: userId,
      comment: req.body?.comment ? String(req.body.comment) : undefined,
    });
    if (!r.ok) return res.status(404).json({ success: false, message: (r as { message?: string }).message ?? "Error" });
    return res.json({ success: true, data: r });
  } catch (e: any) {
    console.error("executiveTower.postReject", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** POST /decision-packages/:id/override */
export async function postOverridePackage(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!requireExecManage(req)) return res.status(403).json({ success: false, message: "Permission denied" });
    const orgId = Number(req.body?.orgId);
    const packageId = Number(req.params.id);
    if (!Number.isFinite(orgId) || !Number.isFinite(packageId)) {
      return res.status(400).json({ success: false, message: "orgId and package id required" });
    }
    if (!(await canAccessOrg(userId, orgId))) return res.status(403).json({ success: false, message: "Forbidden" });
    const overrideJson = req.body?.overrideJson && typeof req.body.overrideJson === "object" ? req.body.overrideJson : {};
    const r = await decisionApr.overrideDecisionPackage({
      orgId,
      packageId,
      actorUserId: userId,
      overrideJson,
      comment: req.body?.comment ? String(req.body.comment) : undefined,
    });
    if (!r.ok) return res.status(404).json({ success: false, message: r.message });
    return res.json({ success: true, data: r });
  } catch (e: any) {
    console.error("executiveTower.postOverride", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** GET /scenarios?orgId= */
export async function getScenarios(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!requireExecRead(req)) return res.status(403).json({ success: false, message: "Permission denied" });
    const orgId = Number(req.query.orgId);
    if (!Number.isFinite(orgId)) return res.status(400).json({ success: false, message: "orgId required" });
    if (!(await canAccessOrg(userId, orgId))) return res.status(403).json({ success: false, message: "Forbidden" });
    const data = await scenario.listScenarioRuns(orgId);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("executiveTower.getScenarios", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** GET /scenarios/:runId?orgId= */
export async function getScenario(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!requireExecRead(req)) return res.status(403).json({ success: false, message: "Permission denied" });
    const orgId = Number(req.query.orgId);
    const runId = Number(req.params.runId);
    if (!Number.isFinite(orgId) || !Number.isFinite(runId)) {
      return res.status(400).json({ success: false, message: "orgId and runId required" });
    }
    if (!(await canAccessOrg(userId, orgId))) return res.status(403).json({ success: false, message: "Forbidden" });
    const data = await scenario.getScenarioRun(orgId, runId);
    if (!data) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("executiveTower.getScenario", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** POST /scenarios */
export async function postScenario(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!requireExecManage(req)) return res.status(403).json({ success: false, message: "Permission denied" });
    const orgId = Number(req.body?.orgId);
    if (!Number.isFinite(orgId)) return res.status(400).json({ success: false, message: "orgId required" });
    if (!(await canAccessOrg(userId, orgId))) return res.status(403).json({ success: false, message: "Forbidden" });
    const templateKey = String(req.body?.templateKey || "COMBINED_STRESS");
    const horizonDays = req.body?.horizonDays ? Number(req.body.horizonDays) : 28;
    const parametersJson = (req.body?.parametersJson && typeof req.body.parametersJson === "object"
      ? req.body.parametersJson
      : {}) as Record<string, unknown>;
    const bParam = parametersJson.branchId != null ? Number(parametersJson.branchId) : undefined;
    if (bParam !== undefined && !Number.isFinite(bParam)) {
      return res.status(400).json({ success: false, message: "Invalid parametersJson.branchId" });
    }
    if (bParam !== undefined && !(await isBranchInOrg(orgId, bParam))) {
      return res.status(400).json({ success: false, message: "branchId does not belong to org" });
    }
    const data = await scenario.createAndExecuteScenario({
      orgId,
      createdByUserId: userId,
      templateKey,
      horizonDays,
      parametersJson: parametersJson as any,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("executiveTower.postScenario", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** GET /scenario-templates */
export async function getScenarioTemplates(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!requireExecRead(req)) return res.status(403).json({ success: false, message: "Permission denied" });
    return res.json({ success: true, data: scenario.SCENARIO_TEMPLATES });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}
