/**
 * Verification script for clone-products authorization.
 * Demonstrates:
 *   (a) Owner can clone (getOrgIdForUser returns orgId)
 *   (b) Owner Team member with org membership can clone (getOrgIdForUser returns orgId; userHasAccessToOrg true)
 *   (c) User without org membership cannot clone (getOrgIdForUser returns null or userHasAccessToOrg false)
 *
 * Run: npx ts-node scripts/verify-clone-auth.ts
 * Requires DB with at least one Organization (owner), optional OwnerTeamMember, and users.
 */
import prisma from "../src/infrastructure/db/prismaClient";

async function getOrgIdForUser(userId: number): Promise<number | null> {
  const member = await prisma.orgMember.findFirst({
    where: { userId, status: "ACTIVE" },
    select: { orgId: true },
  });
  if (member?.orgId) return member.orgId;
  const owned = await prisma.organization.findFirst({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  if (owned?.id) return owned.id;
  const teamMember = await prisma.ownerTeamMember.findFirst({
    where: { userId },
    select: { team: { select: { ownerUserId: true } } },
  });
  if (teamMember?.team?.ownerUserId) {
    const org = await prisma.organization.findFirst({
      where: { ownerUserId: teamMember.team.ownerUserId },
      select: { id: true },
    });
    if (org?.id) return org.id;
  }
  return null;
}

async function userHasAccessToOrg(userId: number, orgId: number): Promise<boolean> {
  const org = await prisma.organization.findFirst({
    where: { id: orgId },
    select: { ownerUserId: true },
  });
  if (!org) return false;
  if (org.ownerUserId === userId) return true;
  const member = await prisma.orgMember.findFirst({
    where: { userId, orgId, status: "ACTIVE" },
    select: { id: true },
  });
  if (member) return true;
  const teamMember = await prisma.ownerTeamMember.findFirst({
    where: { userId, team: { ownerUserId: org.ownerUserId } },
    select: { id: true },
  });
  return !!teamMember;
}

async function main() {
  console.log("=== Clone auth verification ===\n");

  const orgWithOwner = await prisma.organization.findFirst({
    where: {},
    select: { id: true, name: true, ownerUserId: true },
  });
  if (!orgWithOwner) {
    console.log("(a) Owner can clone: SKIP - no organization in DB");
    console.log("(b) Owner Team member can clone: SKIP");
    console.log("(c) User without org membership: SKIP");
    await prisma.$disconnect();
    return;
  }

  const ownerId = orgWithOwner.ownerUserId;
  const ownerOrgId = await getOrgIdForUser(ownerId);
  const ownerHasAccess = ownerOrgId ? await userHasAccessToOrg(ownerId, ownerOrgId) : false;
  console.log("(a) Owner can clone:", ownerOrgId != null && ownerHasAccess ? "PASS" : "FAIL", {
    ownerUserId: ownerId,
    resolvedOrgId: ownerOrgId,
    hasAccessToOrg: ownerHasAccess,
  });

  const teamMemberRow = await prisma.ownerTeamMember.findFirst({
    where: { team: { ownerUserId: ownerId } },
    select: { userId: true },
  });
  if (teamMemberRow) {
    const tmOrgId = await getOrgIdForUser(teamMemberRow.userId);
    const tmHasAccess = tmOrgId ? await userHasAccessToOrg(teamMemberRow.userId, tmOrgId) : false;
    console.log("(b) Owner Team member can clone:", tmOrgId != null && tmHasAccess ? "PASS" : "FAIL", {
      teamMemberUserId: teamMemberRow.userId,
      resolvedOrgId: tmOrgId,
      hasAccessToOrg: tmHasAccess,
    });
  } else {
    console.log("(b) Owner Team member can clone: SKIP (no team member in DB)");
  }

  const randomUser = await prisma.user.findFirst({
    where: {
      id: { notIn: [ownerId, ...(teamMemberRow ? [teamMemberRow.userId] : [])] },
    },
    select: { id: true },
  });
  if (randomUser) {
    const noOrgId = await getOrgIdForUser(randomUser.id);
    const noAccess = orgWithOwner.id ? await userHasAccessToOrg(randomUser.id, orgWithOwner.id) : false;
    console.log("(c) User without org membership cannot clone:", noOrgId == null && !noAccess ? "PASS" : "FAIL", {
      userId: randomUser.id,
      resolvedOrgId: noOrgId,
      hasAccessToOrg: noAccess,
    });
  } else {
    console.log("(c) User without org membership: SKIP (no other user in DB)");
  }

  console.log("\nDone.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
