import type { PrismaClient } from "@prisma/client";

/**
 * Backfill memberships for existing data:
 * - For each Organization, ensure ownerUserId is OrgMember(OWNER)
 * - For each Branch, ensure owner is BranchMember(BRANCH_MANAGER) or (DELIVERY_MANAGER) based on branch types
 *
 * Safe to run multiple times (uses upsert).
 */
export default async function seedMembershipBackfill(prisma: PrismaClient) {
  const orgs = await prisma.organization.findMany({
    select: { id: true, ownerUserId: true },
  });

  let orgMemberUpserts = 0;
  let branchMemberUpserts = 0;
  let producerStaffUpserts = 0;

  const producerOwnerRole = await prisma.role.findUnique({
    where: { key: "PRODUCER_OWNER" },
    select: { id: true },
  });

  for (const org of orgs) {
    if (!org.ownerUserId) continue;

    await prisma.orgMember.upsert({
      where: {
        orgId_userId: {
          orgId: org.id,
          userId: org.ownerUserId,
        },
      },
      update: {
        role: "OWNER",
        status: "ACTIVE",
      },
      create: {
        orgId: org.id,
        userId: org.ownerUserId,
        role: "OWNER",
        status: "ACTIVE",
      },
    });
    orgMemberUpserts++;

    const branches = await prisma.branch.findMany({
      where: { orgId: org.id },
      select: {
        id: true,
        orgId: true,
        types: { select: { type: { select: { code: true } } } },
      },
    });

    for (const b of branches) {
      const codes = (b.types || []).map((x) => String(x?.type?.code || "").toUpperCase());
      const isDeliveryHub = codes.includes("DELIVERY_HUB");

      const role = isDeliveryHub ? "DELIVERY_MANAGER" : "BRANCH_MANAGER";

      await prisma.branchMember.upsert({
        where: {
          branchId_userId: {
            branchId: b.id,
            userId: org.ownerUserId,
          },
        },
        update: {
          role,
          status: "ACTIVE",
        },
        create: {
          orgId: b.orgId,
          branchId: b.id,
          userId: org.ownerUserId,
          role,
          status: "ACTIVE",
        },
      });
      branchMemberUpserts++;
    }
  }

  if (producerOwnerRole?.id) {
    const producerOrgs = await prisma.producerOrg.findMany({
      select: { id: true, ownerUserId: true },
    });

    for (const org of producerOrgs) {
      if (!org.ownerUserId) continue;

      await prisma.producerOrgStaff.upsert({
        where: {
          producerOrgId_userId: {
            producerOrgId: org.id,
            userId: org.ownerUserId,
          },
        },
        update: { roleId: producerOwnerRole.id },
        create: {
          producerOrgId: org.id,
          userId: org.ownerUserId,
          roleId: producerOwnerRole.id,
          invitedBy: null,
        },
      });
      producerStaffUpserts++;
    }
  }

  // eslint-disable-next-line no-console
  console.log(`✅ Membership backfill done. orgMembers upserted: ${orgMemberUpserts}, branchMembers upserted: ${branchMemberUpserts}, producerStaff upserted: ${producerStaffUpserts}`);
}
