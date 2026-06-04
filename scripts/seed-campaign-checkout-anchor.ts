/**
 * Ensures BPA campaign checkout anchor: Organization + ACTIVE Branch + campaign.organizerId.
 * Idempotent — safe to re-run. No hardcoded numeric IDs.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/seed-campaign-checkout-anchor.ts
 *
 * Optional env:
 *   CAMPAIGN_ORGANIZER_ORG_NAME   (default: Bangladesh Pet Association)
 *   CAMPAIGN_CHECKOUT_BRANCH_CODE (default: BPA-CAMPAIGN-CHECKOUT)
 *   CAMPAIGN_CHECKOUT_BRANCH_NAME (default: BPA Campaign Operations (Central))
 */
import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";

const ORG_NAME =
  process.env.CAMPAIGN_ORGANIZER_ORG_NAME?.trim() || "Bangladesh Pet Association";
const BRANCH_CODE =
  process.env.CAMPAIGN_CHECKOUT_BRANCH_CODE?.trim() || "BPA-CAMPAIGN-CHECKOUT";
const BRANCH_NAME =
  process.env.CAMPAIGN_CHECKOUT_BRANCH_NAME?.trim() ||
  "BPA Campaign Operations (Central)";

async function resolveOwnerUserId(): Promise<number> {
  const user = await prisma.user.findFirst({ orderBy: { id: "asc" }, select: { id: true } });
  if (!user) {
    throw new Error("No users in database — create at least one user before seeding campaign checkout anchor");
  }
  return user.id;
}

async function ensureBpaOrganization(ownerUserId: number) {
  let org = await prisma.organization.findFirst({
    where: {
      name: { equals: ORG_NAME, mode: "insensitive" },
      deletedAt: null,
    },
  });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: ORG_NAME,
        ownerUserId,
        status: "APPROVED",
        orgType: "PARTNER",
        supportPhone: "09600272738",
        addressJson: {
          kind: "BPA_HQ",
          city: "Dhaka",
          country: "Bangladesh",
        },
      },
    });
    return { org, created: true };
  }

  org = await prisma.organization.update({
    where: { id: org.id },
    data: {
      status: "APPROVED",
      deletedAt: null,
    },
  });

  return { org, created: false };
}

async function ensureActiveCheckoutBranch(orgId: number) {
  let branch = await prisma.branch.findFirst({
    where: { orgId, code: BRANCH_CODE },
  });

  if (branch) {
    const wasActive = branch.status === "ACTIVE";
    if (!wasActive) {
      branch = await prisma.branch.update({
        where: { id: branch.id },
        data: { status: "ACTIVE", name: BRANCH_NAME },
      });
    }
    return { branch, created: false, activated: true, reactivated: !wasActive };
  }

  branch = await prisma.branch.create({
    data: {
      orgId,
      code: BRANCH_CODE,
      name: BRANCH_NAME,
      status: "ACTIVE",
      capabilitiesJson: { campaignCheckout: true },
      featuresJson: {},
      addressJson: {
        label: "BPA central campaign checkout",
        city: "Dhaka",
        country: "Bangladesh",
      },
    },
  });

  return { branch, created: true, activated: true };
}

async function linkCampaignsToOrganizer(orgId: number) {
  const before = await prisma.campaign.findMany({
    where: { organizerId: null },
    select: { id: true, slug: true },
  });

  const updated = await prisma.campaign.updateMany({
    where: { organizerId: null },
    data: { organizerId: orgId },
  });

  const campaigns = await prisma.campaign.findMany({
    where: { organizerId: orgId },
    select: { id: true, slug: true, pricingType: true, organizerId: true },
    orderBy: { id: "asc" },
  });

  return { linkedCount: updated.count, previouslyUnlinked: before, campaigns };
}

async function main() {
  const ownerUserId = await resolveOwnerUserId();
  const { org, created: orgCreated } = await ensureBpaOrganization(ownerUserId);
  const { branch, created: branchCreated, activated } = await ensureActiveCheckoutBranch(org.id);
  const link = await linkCampaignsToOrganizer(org.id);

  const activeForOrg = await prisma.branch.count({
    where: { orgId: org.id, status: "ACTIVE" },
  });

  console.log(
    JSON.stringify(
      {
        organization: {
          id: org.id,
          name: org.name,
          status: org.status,
          created: orgCreated,
        },
        branch: {
          id: branch.id,
          orgId: branch.orgId,
          code: branch.code,
          name: branch.name,
          status: branch.status,
          created: branchCreated,
          activated,
        },
        campaigns: link,
        activeBranchesForOrganizer: activeForOrg,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
