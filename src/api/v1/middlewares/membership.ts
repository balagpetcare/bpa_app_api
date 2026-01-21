
const prisma = require("@prisma/client");
/**
 * Membership helpers for BPA (OrgMember / BranchMember)
 * - DOES NOT replace existing req.user.role (OWNER/ADMIN/etc)
 * - Adds DB-based membership checks for org/branch staff access
 */

async function getActiveOrgMember(orgId, userId) {
  return prisma.orgMember.findFirst({
    where: { orgId: Number(orgId), userId: Number(userId), status: "ACTIVE" },
  });
}

async function getActiveBranchMember(branchId, userId) {
  return prisma.branchMember.findFirst({
    where: { branchId: Number(branchId), userId: Number(userId), status: "ACTIVE" },
  });
}

function requireOrgMemberRoles(allowedRoles = []) {
  return async function (req, res, next) {
    try {
      const orgId = Number(req.params.orgId || req.body.orgId || req.query.orgId);
      if (!orgId) return res.status(400).json({ success: false, message: "orgId is required" });

      const m = await getActiveOrgMember(orgId, req.user.id);
      if (!m) return res.status(403).json({ success: false, message: "Forbidden: not an org member" });

      if (allowedRoles.length && !allowedRoles.includes(m.role)) {
        return res.status(403).json({ success: false, message: "Forbidden: insufficient org role" });
      }

      req.orgMember = m;
      return next();
    } catch (e) {
      return res.status(500).json({ success: false, message: "Server error" });
    }
  };
}

function requireBranchMemberRoles(allowedRoles = []) {
  return async function (req, res, next) {
    try {
      const branchId = Number(req.params.branchId || req.params.id || req.body.branchId || req.query.branchId);
      if (!branchId) return res.status(400).json({ success: false, message: "branchId is required" });

      const m = await getActiveBranchMember(branchId, req.user.id);
      if (!m) return res.status(403).json({ success: false, message: "Forbidden: not a branch member" });

      if (allowedRoles.length && !allowedRoles.includes(m.role)) {
        return res.status(403).json({ success: false, message: "Forbidden: insufficient branch role" });
      }

      req.branchMember = m;
      return next();
    } catch (e) {
      return res.status(500).json({ success: false, message: "Server error" });
    }
  };
}

async function isOrgOwner(orgId, userId) {
  const m = await getActiveOrgMember(orgId, userId);
  return !!m && m.role === "OWNER";
}

module.exports = {
  getActiveOrgMember,
  getActiveBranchMember,
  requireOrgMemberRoles,
  requireBranchMemberRoles,
  isOrgOwner,
};

export {};
