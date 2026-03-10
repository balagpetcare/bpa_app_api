/**
 * Scope-based permission check for owner panel routes.
 * - If user is the resource owner (ownerUserId === req.user.id), allow.
 * - If user is delegated, allow only if hasPermissionWithScope(userId, permissionKey, context).
 * - When resourceType is set, loads the resource to derive ownerUserId/orgId/branchId.
 */
import type { Request, Response, NextFunction } from "express";

const prisma = require("../infrastructure/db/prismaClient").default;
const { hasPermissionWithScope } = require("../api/v1/services/scopePermission.service");

type RequestWithUser = Request & { user?: { id: number } };
type ResourceType = "organization" | "branch" | null;

async function getOwnerContext(
  req: RequestWithUser,
  resourceType: ResourceType
): Promise<{ ownerUserId: number; orgId?: number; branchId?: number } | null> {
  if (!resourceType) {
    const uid = req.user?.id;
    return uid ? { ownerUserId: Number(uid) } : null;
  }

  // Branch routes use :branchId (e.g. /clinic/branches/:branchId/dashboard-stats), others use :id
  const idParam =
    req.params?.branchId != null
      ? Number(req.params.branchId)
      : req.params?.id != null
        ? Number(req.params.id)
        : NaN;
  if (!Number.isFinite(idParam)) return null;

  if (resourceType === "organization") {
    const org = await prisma.organization.findUnique({
      where: { id: idParam },
      select: { ownerUserId: true, id: true },
    });
    return org ? { ownerUserId: org.ownerUserId, orgId: org.id } : null;
  }

  if (resourceType === "branch") {
    const branch = await prisma.branch.findUnique({
      where: { id: idParam },
      select: { id: true, orgId: true, org: { select: { ownerUserId: true } } },
    });
    if (!branch?.org) return null;
    return {
      ownerUserId: branch.org.ownerUserId,
      orgId: branch.orgId ?? undefined,
      branchId: branch.id,
    };
  }

  return null;
}

/**
 * Middleware factory: require permission for owner panel.
 * @param permissionKey - e.g. 'org.write', 'branch.write', 'staff.read'
 * @param resourceType - 'organization' | 'branch' | null. If set, loads resource from req.params.id to derive context.
 */
export function requireOwnerPermission(
  permissionKey: string,
  resourceType: ResourceType = null
) {
  return async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      const context = await getOwnerContext(req, resourceType);
      if (!context) {
        return next();
      }

      // TEAM_MANAGE: never auto-allow; only allow if user has the permission (team owners get it, delegates do not)
      if (permissionKey !== "TEAM_MANAGE" && context.ownerUserId === Number(userId)) {
        return next();
      }

      const allowed = await hasPermissionWithScope(Number(userId), permissionKey, context);
      if (allowed) return next();

      const role = (req as any).user?.role;
      return res.status(403).json({
        success: false,
        error: "Forbidden: insufficient scope",
        code: "ACCESS_DENIED",
        detail: `Required permission: ${permissionKey}`,
        debug: { required: permissionKey, role: role || "unknown" },
      });
    } catch (e) {
      console.error("[requireOwnerPermission]", e);
      return res.status(500).json({ success: false, error: "Server error" });
    }
  };
}

module.exports = { requireOwnerPermission };
export {};
