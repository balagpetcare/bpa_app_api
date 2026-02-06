/**
 * Branch Access Controller
 * Handles API endpoints for branch access permission management
 */

import type { Request, Response, NextFunction } from "express";
import {
  requestBranchAccess,
  approveBranchAccess,
  revokeBranchAccess,
  checkBranchAccess,
  getPendingRequestsForBranch,
  getPendingRequestsForManager,
  getActivePermissionsForUser,
  getAllPermissionsForUser,
  updateLastLoginAt,
  getPermissionsForBranch,
  resolveBranchAccessProfile,
  resolveBranchAccessProfileFromPermission,
} from "../../services/branchAccessPermission.service";
import {
  notifyManagerOfAccessRequest,
  notifyStaffOfApproval,
  notifyStaffOfRevocation,
  notifyOwnerOfAccessRequest,
} from "../../services/branchAccessNotification.service";

function getAuthUserId(req: any): number | null {
  const id =
    req?.user?.id ??
    req?.userId ??
    req?.auth?.userId ??
    req?.authUser?.id ??
    req?.session?.user?.id;

  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * POST /api/v1/branch-access/request
 * Staff requests access to a branch
 */
export async function requestAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { branchId, role: requestedRole } = req.body;
    if (!branchId || !Number.isFinite(Number(branchId))) {
      return res.status(400).json({ success: false, message: "Invalid branchId" });
    }

    const normalizedRole = requestedRole ? String(requestedRole).toUpperCase() : undefined;
    const permission = await requestBranchAccess(userId, Number(branchId), normalizedRole);

    // If this is a new pending request, notify manager
    if (permission.status === "PENDING" && permission.requestedAt) {
      // Check if this was just created (not updated from another status)
      const isNewRequest = new Date(permission.requestedAt).getTime() > Date.now() - 5000;
      if (isNewRequest) {
        notifyManagerOfAccessRequest(Number(branchId), userId).catch((err) => {
          console.error("[CONTROLLER] Failed to notify manager:", err);
        });
        notifyOwnerOfAccessRequest(Number(branchId), userId, permission.id).catch((err) => {
          console.error("[CONTROLLER] Failed to notify owner:", err);
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: permission,
      message:
        permission.status === "PENDING"
          ? "Access request submitted. Waiting for manager approval."
          : permission.status === "APPROVED"
            ? "You already have access to this branch."
            : "Access request updated.",
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to request access",
    });
  }
}

/**
 * GET /api/v1/branch-access/my-requests
 * Staff views their own permission requests (enriched with role, permissions, accessScopes)
 */
export async function getMyRequests(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const permissions = await getAllPermissionsForUser(userId);
    const enriched = await Promise.all(
      permissions.map(async (p: any) => {
        const profile = await resolveBranchAccessProfileFromPermission(p);
        return {
          ...p,
          role: profile.role,
          permissions: profile.permissions,
          accessScopes: profile.scopes,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: enriched,
    });
  } catch (error: any) {
    return next(error);
  }
}

/**
 * GET /api/v1/branch-access/active
 * Staff views their active permissions (enriched with role, permissions)
 */
export async function getActivePermissions(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const permissions = await getActivePermissionsForUser(userId);
    const enriched = await Promise.all(
      permissions.map(async (p: any) => {
        const profile = await resolveBranchAccessProfileFromPermission(p);
        return {
          ...p,
          role: profile.role,
          permissions: profile.permissions,
          accessScopes: profile.scopes,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: enriched,
    });
  } catch (error: any) {
    return next(error);
  }
}

/**
 * GET /api/v1/branch-access/pending
 * Manager views pending requests for their branches
 */
export async function getPendingRequests(req: Request, res: Response, next: NextFunction) {
  try {
    const managerId = getAuthUserId(req as any);
    if (!managerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const requests = await getPendingRequestsForManager(managerId);

    return res.status(200).json({
      success: true,
      data: requests,
    });
  } catch (error: any) {
    return next(error);
  }
}

/**
 * POST /api/v1/branch-access/:id/approve
 * Manager approves a permission request
 */
export async function approveAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const managerId = getAuthUserId(req as any);
    if (!managerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const permissionId = Number(req.params.id);
    if (!permissionId || !Number.isFinite(permissionId)) {
      return res.status(400).json({ success: false, message: "Invalid permission ID" });
    }

    const { expiresAt } = req.body;
    let expiresAtDate: Date | undefined;
    if (expiresAt) {
      expiresAtDate = new Date(expiresAt);
      if (isNaN(expiresAtDate.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid expiration date" });
      }
    }

    const permission = await approveBranchAccess(permissionId, managerId, expiresAtDate);

    // Notify staff
    notifyStaffOfApproval(permission.userId, permission.branchId).catch((err) => {
      console.error("[CONTROLLER] Failed to notify staff:", err);
    });

    return res.status(200).json({
      success: true,
      data: permission,
      message: "Access approved successfully",
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to approve access",
    });
  }
}

/**
 * POST /api/v1/branch-access/:id/revoke
 * Manager revokes access
 */
export async function revokeAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const managerId = getAuthUserId(req as any);
    if (!managerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const permissionId = Number(req.params.id);
    if (!permissionId || !Number.isFinite(permissionId)) {
      return res.status(400).json({ success: false, message: "Invalid permission ID" });
    }

    const permission = await revokeBranchAccess(permissionId, managerId);

    // Notify staff
    notifyStaffOfRevocation(permission.userId, permission.branchId).catch((err) => {
      console.error("[CONTROLLER] Failed to notify staff:", err);
    });

    return res.status(200).json({
      success: true,
      data: permission,
      message: "Access revoked successfully",
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to revoke access",
    });
  }
}

/**
 * GET /api/v1/branch-access/branch/:branchId
 * Get all permissions for a branch (manager view)
 */
export async function getBranchPermissions(req: Request, res: Response, next: NextFunction) {
  try {
    const managerId = getAuthUserId(req as any);
    if (!managerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const branchId = Number(req.params.branchId);
    if (!branchId || !Number.isFinite(branchId)) {
      return res.status(400).json({ success: false, message: "Invalid branch ID" });
    }

    // Verify manager has access to this branch
    const branchMember = await require("../../../../infrastructure/db/prismaClient").default.branchMember.findFirst({
      where: {
        branchId,
        userId: managerId,
        role: "BRANCH_MANAGER",
        status: "ACTIVE",
      },
    });

    // Also check if user is org owner
    const branch = await require("../../../../infrastructure/db/prismaClient").default.branch.findUnique({
      where: { id: branchId },
      include: {
        org: {
          select: {
            ownerUserId: true,
          },
        },
      },
    });

    const isAuthorized = branchMember || branch?.org.ownerUserId === managerId;

    if (!isAuthorized) {
      return res.status(403).json({ success: false, message: "Not authorized to view this branch" });
    }

    const permissions = await getPermissionsForBranch(branchId);

    return res.status(200).json({
      success: true,
      data: permissions,
    });
  } catch (error: any) {
    return next(error);
  }
}

/**
 * GET /api/v1/branch-access/check/:branchId
 * Check if user has active access to a branch (returns role + permissions when hasAccess)
 */
export async function checkAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const branchId = Number(req.params.branchId);
    if (!branchId || !Number.isFinite(branchId)) {
      return res.status(400).json({ success: false, message: "Invalid branch ID" });
    }

    const hasAccess = await checkBranchAccess(userId, branchId);
    const profile = hasAccess ? await resolveBranchAccessProfile(userId, branchId) : null;

    return res.status(200).json({
      success: true,
      data: {
        hasAccess,
        branchId,
        ...(profile && {
          role: profile.role,
          permissions: profile.permissions,
          scopes: profile.scopes,
        }),
      },
    });
  } catch (error: any) {
    return next(error);
  }
}
