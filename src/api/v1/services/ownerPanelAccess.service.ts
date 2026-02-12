/**
 * Owner panel access: effective org/branch IDs for the current user.
 * Used so Staff/Team members can use /owner/* routes scoped to their allowed orgs/branches.
 */

/**
 * Returns org IDs the user can access in the owner panel:
 * - Orgs they own (Organization.ownerUserId)
 * - Orgs where they are ACTIVE OrgMember
 * - Orgs of owners for whom they have a UserContext (team member)
 * - Orgs from OwnerDelegation (delegatedUserId = userId, distinct orgId)
 */
export async function getEffectiveOrgIdsForOwnerPanel(
  prismaInstance: any,
  userId: number
): Promise<number[]> {
  if (!userId) return [];
  const id = Number(userId);

  const [owned, orgMembers, userContexts, delegations] = await Promise.all([
    prismaInstance.organization.findMany({
      where: { ownerUserId: id },
      select: { id: true },
    }),
    prismaInstance.orgMember.findMany({
      where: { userId: id, status: "ACTIVE" },
      select: { orgId: true },
    }),
    prismaInstance.userContext.findMany({
      where: { userId: id, ownerUserId: { not: null } },
      select: { ownerUserId: true },
    }),
    prismaInstance.ownerDelegation.findMany({
      where: { delegatedUserId: id },
      select: { orgId: true, ownerUserId: true },
    }),
  ]);

  const set = new Set<number>();
  for (const o of owned) set.add(o.id);
  for (const m of orgMembers) if (m.orgId) set.add(m.orgId);
  for (const uc of userContexts) {
    if (uc.ownerUserId) {
      const ownerOrgs = await prismaInstance.organization.findMany({
        where: { ownerUserId: uc.ownerUserId },
        select: { id: true },
      });
      for (const o of ownerOrgs) set.add(o.id);
    }
  }
  const delegationOrgIds = delegations.filter((d: any) => d.orgId != null).map((d: any) => d.orgId);
  for (const oid of delegationOrgIds) set.add(oid);
  const fullScopeOwnerIds = delegations
    .filter((d: any) => d.orgId == null)
    .map((d: any) => d.ownerUserId)
    .filter(Boolean);
  if (fullScopeOwnerIds.length > 0) {
    const ownerOrgs = await prismaInstance.organization.findMany({
      where: { ownerUserId: { in: [...new Set(fullScopeOwnerIds)] } },
      select: { id: true },
    });
    for (const o of ownerOrgs) set.add(o.id);
  }
  return Array.from(set);
}

/**
 * Returns branch IDs the user can access in the owner panel (for staff-scoped lists).
 * Owners: all branches in effective orgs. Staff/Team: branches in effective orgs that they
 * have BranchMember or OwnerDelegation access to.
 */
export async function getEffectiveBranchIdsForOwnerPanel(
  prismaInstance: any,
  userId: number
): Promise<number[]> {
  const orgIds = await getEffectiveOrgIdsForOwnerPanel(prismaInstance, userId);
  if (orgIds.length === 0) return [];

  const ownedOrg = await prismaInstance.organization.findFirst({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  if (ownedOrg) {
    const branches = await prismaInstance.branch.findMany({
      where: { orgId: { in: orgIds } },
      select: { id: true },
    });
    return branches.map((b: { id: number }) => b.id);
  }

  const [branchMembers, delegations] = await Promise.all([
    prismaInstance.branchMember.findMany({
      where: { userId, status: "ACTIVE" },
      select: { branchId: true },
    }),
    prismaInstance.ownerDelegation.findMany({
      where: { delegatedUserId: userId },
      select: { branchId: true, orgId: true },
    }),
  ]);

  const branchSet = new Set<number>();
  for (const bm of branchMembers) if (bm.branchId) branchSet.add(bm.branchId);
  const hasFullDelegation = delegations.some((d: any) => d.branchId == null && d.orgId == null);
  if (hasFullDelegation) {
    const allInOrgs = await prismaInstance.branch.findMany({
      where: { orgId: { in: orgIds } },
      select: { id: true },
    });
    for (const b of allInOrgs) branchSet.add(b.id);
  } else {
    for (const d of delegations) {
      if (d.branchId) branchSet.add(d.branchId);
      if (d.branchId == null && d.orgId != null && orgIds.includes(d.orgId)) {
        const inOrg = await prismaInstance.branch.findMany({
          where: { orgId: d.orgId },
          select: { id: true },
        });
        for (const b of inOrg) branchSet.add(b.id);
      }
    }
  }
  return Array.from(branchSet);
}

module.exports = {
  getEffectiveOrgIdsForOwnerPanel,
  getEffectiveBranchIdsForOwnerPanel,
};
