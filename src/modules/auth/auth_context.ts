import type { Request } from "express";
import { prisma } from "../../lib/prisma";

/**
 * Your project should already have authentication.
 * This adapter is intentionally lightweight:
 * - If your existing auth middleware sets req.user, use it.
 * - Otherwise for dev/testing, allow headers: x-user-id, x-org-id
 */
export type AuthContext = {
  userId: number;
  staffId?: number;      // StaffProfile.id (if staff)
  orgId?: number;        // Organization scope (if staff)
  branchIds?: number[];  // assigned branches
  permissions?: string[];
};

export async function getAuthContext(req: Request): Promise<AuthContext> {
  // 1) If you already attach user to req in your auth middleware:
  // @ts-ignore
  if (req.user?.id) {
    // @ts-ignore
    return { userId: Number(req.user.id) };
  }

  // 2) DEV fallback (DO NOT rely on this in production)
  const userIdHeader = req.header("x-user-id");
  const orgIdHeader = req.header("x-org-id");
  const userId = userIdHeader ? Number(userIdHeader) : NaN;
  const orgId = orgIdHeader ? Number(orgIdHeader) : undefined;

  if (!Number.isFinite(userId)) {
    throw Object.assign(new Error("Unauthenticated"), { statusCode: 401 });
  }

  // Resolve staff + permissions (if staff in org)
  if (orgId) {
    const staff = await (prisma as any).staffProfile.findFirst({
      where: { userId, orgId },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        branches: true,
      },
    });

    if (staff) {
      const permissions = Array.from(
        new Set(
          staff.roles.flatMap((sr) =>
            sr.role.permissions.map((rp) => rp.permission.key)
          )
        )
      );

      return {
        userId,
        staffId: staff.id,
        orgId,
        branchIds: staff.branches.map((b) => b.branchId),
        permissions: (permissions as any[]).map(String),
      };
    }
  }

  return { userId, orgId };
}