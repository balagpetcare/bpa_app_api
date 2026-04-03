import { getManagedBranchesForUser } from "../../services/branchManager.service";

const db = require("../../../../infrastructure/db/prismaClient").default;

/** Owner, active org member, or user with managed branch in org. */
export async function canAccessOrg(userId: number, orgId: number): Promise<boolean> {
  const owned = await db.organization.findFirst({
    where: { id: orgId, ownerUserId: userId },
    select: { id: true },
  });
  if (owned) return true;
  const member = await db.orgMember.findFirst({
    where: { userId, orgId, status: "ACTIVE" },
    select: { id: true },
  });
  if (member) return true;
  const managed = await getManagedBranchesForUser(userId);
  return managed.some((m: { orgId: number }) => m.orgId === orgId);
}
