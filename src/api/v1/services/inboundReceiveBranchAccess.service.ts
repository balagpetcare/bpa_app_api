/**
 * Branch allow-list for inbound receive (dispatches + transfers) at destination branch.
 */
import prisma from "../../../infrastructure/db/prismaClient";
import { getEffectiveBranchIdsForOwnerPanel } from "./ownerPanelAccess.service";

export async function getOrgIdForInboundUser(userId: number): Promise<number | null> {
  const owner = await prisma.organization.findFirst({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  if (owner) return owner.id;
  const member = await prisma.orgMember.findFirst({
    where: { userId, status: "ACTIVE" },
    select: { orgId: true },
  });
  return member?.orgId ?? null;
}

/** ACTIVE BranchMember branchIds + owner-panel effective branches */
export async function getAllowedBranchIdsForInboundReceive(userId: number): Promise<number[]> {
  const [branchMemberIds, ownerPanelIds] = await Promise.all([
    prisma.branchMember.findMany({
      where: { userId, status: "ACTIVE" },
      select: { branchId: true },
    }),
    getEffectiveBranchIdsForOwnerPanel(prisma, userId),
  ]);
  const set = new Set<number>();
  for (const m of branchMemberIds) if (m.branchId != null) set.add(m.branchId);
  for (const id of ownerPanelIds) set.add(id);
  return Array.from(set);
}
