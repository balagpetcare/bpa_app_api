/**
 * Owner Overview Log Service
 * Audit log for delegation and team management actions.
 */

import prisma from "../../../infrastructure/db/prismaClient";

export const OVERVIEW_ACTIONS = {
  TEAM_CREATED: "TEAM_CREATED",
  TEAM_UPDATED: "TEAM_UPDATED",
  TEAM_DELETED: "TEAM_DELETED",
  MEMBER_ADDED: "MEMBER_ADDED",
  MEMBER_REMOVED: "MEMBER_REMOVED",
  DELEGATION_ASSIGNED: "DELEGATION_ASSIGNED",
  DELEGATION_REVOKED: "DELEGATION_REVOKED",
  DELEGATION_REVOKED_ALL: "DELEGATION_REVOKED_ALL",
  PERMISSION_CHECK: "PERMISSION_CHECK",
} as const;

export async function writeOwnerOverviewLog(
  ownerUserId: number,
  action: string,
  meta?: Record<string, unknown>,
  actorUserId?: number | null
) {
  try {
    await prisma.ownerOverviewLog.create({
      data: {
        ownerUserId,
        actorUserId: actorUserId ?? null,
        action,
        meta: (meta ?? {}) as object,
      },
    });
  } catch (e) {
    console.warn("[OwnerOverviewLog] Failed to write log:", (e as Error)?.message);
  }
}
