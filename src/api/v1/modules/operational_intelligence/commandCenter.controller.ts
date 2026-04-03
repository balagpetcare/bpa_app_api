import { getManagedBranchesForUser } from "../../services/branchManager.service";
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

/** GET /operations/command-center/exceptions */
export async function listExceptions(req: any, res: any) {
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
    const data = await ops.listExceptions(orgId, {
      status: req.query.status,
      severity: req.query.severity,
      branchId: req.query.branchId ? Number(req.query.branchId) : undefined,
      breachOnly: req.query.breachOnly === "1" || req.query.breachOnly === "true",
      skip: req.query.skip ? Number(req.query.skip) : 0,
      take: req.query.take ? Number(req.query.take) : 50,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("commandCenter.listExceptions", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** GET /operations/command-center/exceptions/:id */
export async function getException(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = Number(req.query.orgId);
    const id = Number(req.params.id);
    if (!Number.isFinite(orgId) || !Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "orgId (query) and id required" });
    }
    if (!(await canAccessOrg(userId, orgId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const data = await ops.getExceptionDetail(orgId, id);
    if (!data) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("commandCenter.getException", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** PATCH /operations/command-center/exceptions/:id */
export async function patchException(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = Number(req.body?.orgId ?? req.query?.orgId);
    const id = Number(req.params.id);
    if (!Number.isFinite(orgId) || !Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "orgId and id required" });
    }
    if (!(await canAccessOrg(userId, orgId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const snoozedUntil = req.body?.snoozedUntil ? new Date(req.body.snoozedUntil) : undefined;
    const data = await ops.patchException(orgId, id, userId, {
      status: req.body?.status,
      assignedToUserId:
        req.body?.assignedToUserId === null ? null : req.body?.assignedToUserId != null
          ? Number(req.body.assignedToUserId)
          : undefined,
      resolutionNote: req.body?.resolutionNote,
      snoozedUntil: snoozedUntil !== undefined && Number.isNaN(snoozedUntil?.getTime() ?? NaN) ? undefined : snoozedUntil,
      acknowledge: !!req.body?.acknowledge,
    });
    if (!data) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("commandCenter.patchException", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** POST /operations/command-center/exceptions/:id/rca */
export async function postRca(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = Number(req.body?.orgId ?? req.query?.orgId);
    const id = Number(req.params.id);
    if (!Number.isFinite(orgId) || !Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "orgId and id required" });
    }
    if (!(await canAccessOrg(userId, orgId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const primaryCause = req.body?.primaryCause || "UNKNOWN";
    const data = await ops.upsertRca(orgId, id, userId, {
      primaryCause,
      contributingFactorsJson: req.body?.contributingFactorsJson,
      notes: req.body?.notes,
    });
    if (!data) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("commandCenter.postRca", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

/** POST /operations/command-center/refresh */
export async function postRefreshExceptions(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = Number(req.body?.orgId ?? req.query?.orgId);
    if (!Number.isFinite(orgId)) {
      return res.status(400).json({ success: false, message: "orgId required" });
    }
    if (!(await canAccessOrg(userId, orgId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const data = await ops.refreshOperationalExceptions(orgId);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("commandCenter.postRefreshExceptions", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

module.exports = {
  listExceptions,
  getException,
  patchException,
  postRca,
  postRefreshExceptions,
};
