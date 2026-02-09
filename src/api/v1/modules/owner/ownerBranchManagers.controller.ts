/**
 * Owner Branch Managers Controller
 * Owner-only: monitor, control, restrict, evaluate, and audit Branch Managers.
 * All routes require auth + OWNER/ADMIN role (enforced by owner.routes).
 */

const { writeAudit } = require("../../../../middlewares/auditWriter");
const {
  listBranchManagersForOwner,
  getBranchManagerDetailForOwner,
  updateBranchManagerStatus,
  updateBranchManagerPermissions,
  forceLogoutUser,
  getBranchManagerAuditLogs,
  getBranchManagerPerformance,
} = require("../../services/ownerBranchManagers.service");

function getPrisma(req: any) {
  if (!req.prisma) throw new Error("Prisma instance not found on req.prisma");
  return req.prisma;
}

function asIntId(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return n;
}

/** GET /owner/branch-managers — list all branch managers in owner's orgs */
exports.list = async (req: any, res: any) => {
  try {
    const ownerUserId = asIntId(req.user?.id ?? req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const branchId = asIntId(req.query.branchId);
    const status = req.query.status ? String(req.query.status).trim() : undefined;
    const lastActiveFrom = req.query.lastActiveFrom ? String(req.query.lastActiveFrom) : undefined;

    const { items, total } = await listBranchManagersForOwner(ownerUserId, {
      branchId: branchId ?? undefined,
      status,
      lastActiveFrom,
    });

    return res.json({ success: true, data: { items, total } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message ?? "Server error" });
  }
};

/** GET /owner/branch-managers/:id — get one branch manager (id = userId) */
exports.getOne = async (req: any, res: any) => {
  try {
    const ownerUserId = asIntId(req.user?.id ?? req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const detail = await getBranchManagerDetailForOwner(ownerUserId, id);
    if (!detail) return res.status(404).json({ success: false, message: "Branch manager not found" });

    return res.json({ success: true, data: detail });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message ?? "Server error" });
  }
};

/** PATCH /owner/branch-managers/:id/status — suspend or resume (soft block) */
exports.updateStatus = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id ?? req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const status = req.body?.status;
    if (status !== "ACTIVE" && status !== "SUSPENDED") {
      return res.status(400).json({ success: false, message: "Invalid status; use ACTIVE or SUSPENDED" });
    }

    const before = await getBranchManagerDetailForOwner(ownerUserId, id);
    if (!before) return res.status(404).json({ success: false, message: "Branch manager not found" });

    await updateBranchManagerStatus(ownerUserId, id, status);

    await writeAudit({
      prisma,
      req,
      action: status === "SUSPENDED" ? "OWNER_MANAGER_SUSPEND" : "OWNER_MANAGER_RESUME",
      entityType: "USER",
      entityId: String(id),
      before: { status: before.memberships?.[0]?.status },
      after: { status },
    });

    return res.json({ success: true, data: { status }, message: status === "SUSPENDED" ? "Manager suspended" : "Manager resumed" });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message ?? "Server error" });
  }
};

/** PATCH /owner/branch-managers/:id/permissions — permission override and/or login time window */
exports.updatePermissions = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id ?? req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const before = await getBranchManagerDetailForOwner(ownerUserId, id);
    if (!before) return res.status(404).json({ success: false, message: "Branch manager not found" });

    const branchId = asIntId(req.body?.branchId);
    const permissionOverrides = Array.isArray(req.body?.permissionOverrides)
      ? req.body.permissionOverrides
      : undefined;
    const loginWindowStart = req.body?.loginWindowStart != null ? String(req.body.loginWindowStart) : undefined;
    const loginWindowEnd = req.body?.loginWindowEnd != null ? String(req.body.loginWindowEnd) : undefined;

    const result = await updateBranchManagerPermissions(ownerUserId, id, {
      branchId: branchId ?? undefined,
      permissionOverrides,
      loginWindowStart,
      loginWindowEnd,
    });

    await writeAudit({
      prisma,
      req,
      action: "OWNER_MANAGER_PERMISSIONS",
      entityType: "USER",
      entityId: String(id),
      before: null,
      after: { permissionOverrides, loginWindowStart, loginWindowEnd, branchId },
    });

    return res.json({ success: true, data: result, message: "Permissions updated" });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message ?? "Server error" });
  }
};

/** POST /owner/branch-managers/:id/force-logout — invalidate all sessions for this manager */
exports.forceLogout = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id ?? req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const exists = await getBranchManagerDetailForOwner(ownerUserId, id);
    if (!exists) return res.status(404).json({ success: false, message: "Branch manager not found" });

    const revokedCount = await forceLogoutUser(id);

    await writeAudit({
      prisma,
      req,
      action: "OWNER_MANAGER_FORCE_LOGOUT",
      entityType: "USER",
      entityId: String(id),
      before: null,
      after: { sessionsRevoked: revokedCount },
    });

    return res.json({ success: true, data: { sessionsRevoked: revokedCount }, message: "Sessions revoked" });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message ?? "Server error" });
  }
};

/** GET /owner/branch-managers/:id/audit-logs — manager-wise audit logs */
exports.getAuditLogs = async (req: any, res: any) => {
  try {
    const ownerUserId = asIntId(req.user?.id ?? req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const limit = Math.min(parseInt(String(req.query.limit || "100"), 10) || 100, 200);
    const logs = await getBranchManagerAuditLogs(ownerUserId, id, limit);

    return res.json({ success: true, data: logs });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message ?? "Server error" });
  }
};

/** GET /owner/branch-managers/:id/performance — branch performance snapshot for this manager */
exports.getPerformance = async (req: any, res: any) => {
  try {
    const ownerUserId = asIntId(req.user?.id ?? req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const performance = await getBranchManagerPerformance(ownerUserId, id);
    if (!performance) return res.status(404).json({ success: false, message: "Branch manager not found" });

    return res.json({ success: true, data: performance });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message ?? "Server error" });
  }
};

export {};
