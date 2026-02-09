/**
 * Owner Staff Control Controller
 * Staff Control Dashboard: list staff (exclude owners), detail, status/role/permissions/
 * shift rules, force-logout, transfer, audit logs, activity summary.
 * All routes require auth + OWNER/ADMIN (enforced by owner.routes).
 */

const { writeAudit } = require("../../../../middlewares/auditWriter");
const {
  listStaffForOwner,
  getStaffDetailForOwner,
  updateStaffStatus,
  updateStaffRole,
  updateStaffPermissions,
  forceLogoutStaff,
  transferStaffBranch,
  getStaffAuditLogs,
  getStaffActivitySummary,
} = require("../../services/ownerStaffControl.service");

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

/** GET /owner/staff — list staff for control dashboard (exclude owners) */
exports.list = async (req: any, res: any) => {
  try {
    const ownerUserId = asIntId(req.user?.id ?? req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const branchId = asIntId(req.query.branchId);
    const role = req.query.role ? String(req.query.role).trim() : undefined;
    const status = req.query.status ? String(req.query.status).trim() : undefined;
    const lastActiveFrom = req.query.lastActiveFrom ? String(req.query.lastActiveFrom) : undefined;

    const { items, total } = await listStaffForOwner(ownerUserId, {
      branchId: branchId ?? undefined,
      role,
      status,
      lastActiveFrom,
    });

    return res.json({ success: true, data: { items, total } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message ?? "Server error" });
  }
};

/** GET /owner/staff/:id — staff detail (:id = userId) */
exports.getOne = async (req: any, res: any) => {
  try {
    const ownerUserId = asIntId(req.user?.id ?? req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const detail = await getStaffDetailForOwner(ownerUserId, id);
    if (!detail) return res.status(404).json({ success: false, message: "Staff not found" });

    return res.json({ success: true, data: detail });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message ?? "Server error" });
  }
};

/** PATCH /owner/staff/:id/status — suspend or resume */
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

    const before = await getStaffDetailForOwner(ownerUserId, id);
    if (!before) return res.status(404).json({ success: false, message: "Staff not found" });

    await updateStaffStatus(ownerUserId, id, status);

    await writeAudit({
      prisma,
      req,
      action: status === "SUSPENDED" ? "OWNER_STAFF_SUSPEND" : "OWNER_STAFF_RESUME",
      entityType: "USER",
      entityId: String(id),
      before: { status: before.memberships?.[0]?.status },
      after: { status },
    });

    return res.json({
      success: true,
      data: { status },
      message: status === "SUSPENDED" ? "Staff suspended" : "Staff resumed",
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message ?? "Server error" });
  }
};

/** PATCH /owner/staff/:id/role — change role (optional branchId for single branch) */
exports.updateRole = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id ?? req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const role = req.body?.role;
    if (!role || typeof role !== "string") {
      return res.status(400).json({ success: false, message: "role is required" });
    }

    const branchId = asIntId(req.body?.branchId);
    const before = await getStaffDetailForOwner(ownerUserId, id);
    if (!before) return res.status(404).json({ success: false, message: "Staff not found" });

    const result = await updateStaffRole(ownerUserId, id, role, branchId ?? undefined);

    await writeAudit({
      prisma,
      req,
      action: "OWNER_STAFF_ROLE",
      entityType: "USER",
      entityId: String(id),
      before: { role: before.memberships?.[0]?.role },
      after: { role: result.role, branchId: branchId ?? null },
    });

    return res.json({ success: true, data: result, message: "Role updated" });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message ?? "Server error" });
  }
};

/** PATCH /owner/staff/:id/permissions — permission overrides and/or shift (login window) */
exports.updatePermissions = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id ?? req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const before = await getStaffDetailForOwner(ownerUserId, id);
    if (!before) return res.status(404).json({ success: false, message: "Staff not found" });

    const branchId = asIntId(req.body?.branchId);
    const permissionOverrides = Array.isArray(req.body?.permissionOverrides)
      ? req.body.permissionOverrides
      : undefined;
    const loginWindowStart = req.body?.loginWindowStart != null ? String(req.body.loginWindowStart) : undefined;
    const loginWindowEnd = req.body?.loginWindowEnd != null ? String(req.body.loginWindowEnd) : undefined;

    const result = await updateStaffPermissions(ownerUserId, id, {
      branchId: branchId ?? undefined,
      permissionOverrides,
      loginWindowStart,
      loginWindowEnd,
    });

    await writeAudit({
      prisma,
      req,
      action: "OWNER_STAFF_PERMISSIONS",
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

/** PATCH /owner/staff/:id/shift-rules — alias for login window (same as permissions) */
exports.updateShiftRules = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id ?? req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const branchId = asIntId(req.body?.branchId);
    const loginWindowStart = req.body?.loginWindowStart != null ? String(req.body.loginWindowStart) : undefined;
    const loginWindowEnd = req.body?.loginWindowEnd != null ? String(req.body.loginWindowEnd) : undefined;

    const result = await updateStaffPermissions(ownerUserId, id, {
      branchId: branchId ?? undefined,
      loginWindowStart,
      loginWindowEnd,
    });

    await writeAudit({
      prisma,
      req,
      action: "OWNER_STAFF_SHIFT_RULES",
      entityType: "USER",
      entityId: String(id),
      before: null,
      after: { loginWindowStart, loginWindowEnd, branchId },
    });

    return res.json({ success: true, data: result, message: "Shift rules updated" });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message ?? "Server error" });
  }
};

/** POST /owner/staff/:id/force-logout */
exports.forceLogout = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id ?? req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const exists = await getStaffDetailForOwner(ownerUserId, id);
    if (!exists) return res.status(404).json({ success: false, message: "Staff not found" });

    const revokedCount = await forceLogoutStaff(id);

    await writeAudit({
      prisma,
      req,
      action: "OWNER_STAFF_FORCE_LOGOUT",
      entityType: "USER",
      entityId: String(id),
      before: null,
      after: { sessionsRevoked: revokedCount },
    });

    return res.json({
      success: true,
      data: { sessionsRevoked: revokedCount },
      message: "Sessions revoked",
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message ?? "Server error" });
  }
};

/** POST /owner/staff/:id/transfer-branch — body: fromBranchId, toBranchId */
exports.transferBranch = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id ?? req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const fromBranchId = asIntId(req.body?.fromBranchId);
    const toBranchId = asIntId(req.body?.toBranchId);
    if (!fromBranchId || !toBranchId) {
      return res.status(400).json({ success: false, message: "fromBranchId and toBranchId required" });
    }

    const result = await transferStaffBranch(ownerUserId, id, fromBranchId, toBranchId);

    await writeAudit({
      prisma,
      req,
      action: "OWNER_STAFF_TRANSFER_BRANCH",
      entityType: "USER",
      entityId: String(id),
      before: { fromBranchId, toBranchId: null },
      after: { fromBranchId, toBranchId },
    });

    return res.json({ success: true, data: result, message: "Transfer completed" });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message ?? "Server error" });
  }
};

/** GET /owner/staff/:id/audit-logs */
exports.getAuditLogs = async (req: any, res: any) => {
  try {
    const ownerUserId = asIntId(req.user?.id ?? req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const limit = Math.min(parseInt(String(req.query.limit || "100"), 10) || 100, 200);
    const logs = await getStaffAuditLogs(ownerUserId, id, limit);

    return res.json({ success: true, data: logs });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message ?? "Server error" });
  }
};

/** GET /owner/staff/:id/activity-summary */
exports.getActivitySummary = async (req: any, res: any) => {
  try {
    const ownerUserId = asIntId(req.user?.id ?? req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const summary = await getStaffActivitySummary(ownerUserId, id);
    if (!summary) return res.status(404).json({ success: false, message: "Staff not found" });

    return res.json({ success: true, data: summary });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message ?? "Server error" });
  }
};

export {};
