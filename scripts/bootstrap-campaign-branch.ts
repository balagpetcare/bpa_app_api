/**
 * Idempotent bootstrap for campaign checkout payment branch anchor.
 *
 * Ensures:
 * - BPA organization exists (APPROVED)
 * - ACTIVE branch exists for campaign orders (orders.branchId)
 * - campaigns.organizerId linked when null
 *
 * Safe to re-run — never creates duplicate branches (unique orgId + code).
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/bootstrap-campaign-branch.ts
 *   npm run bootstrap:campaign-branch
 *
 * Optional env:
 *   CAMPAIGN_ORGANIZER_ORG_NAME    (default: Bangladesh Pet Association)
 *   CAMPAIGN_CHECKOUT_BRANCH_CODE  (default: BPA-CAMPAIGN-CHECKOUT)
 *   CAMPAIGN_CHECKOUT_BRANCH_NAME  (default: BPA Campaign Operations (Central))
 *   CAMPAIGN_PAYMENT_BRANCH_ID     (optional override — verified if set)
 */
import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";
import { resolveCampaignPaymentBranch } from "../src/api/v1/modules/campaign/payment.service";

export const DEFAULT_ORG_NAME = "Bangladesh Pet Association";
export const DEFAULT_BRANCH_CODE = "BPA-CAMPAIGN-CHECKOUT";
export const DEFAULT_BRANCH_NAME = "BPA Campaign Operations (Central)";

export type BootstrapCampaignBranchResult = {
  organization: {
    id: number;
    name: string;
    status: string;
    created: boolean;
  };
  branch: {
    id: number;
    orgId: number;
    code: string | null;
    name: string;
    status: string;
    created: boolean;
    reactivated: boolean;
  };
  campaigns: {
    linkedCount: number;
    previouslyUnlinked: Array<{ id: number; slug: string | null }>;
    campaigns: Array<{
      id: number;
      slug: string | null;
      pricingType: string;
      organizerId: number | null;
    }>;
  };
  activeBranchesForOrganizer: number;
  envRecommendation: {
    CAMPAIGN_PAYMENT_BRANCH_ID: string;
  };
  resolverCheck: {
    branchId: number | null;
    branchName: string | null;
    ok: boolean;
  };
};

function configFromEnv() {
  return {
    orgName: process.env.CAMPAIGN_ORGANIZER_ORG_NAME?.trim() || DEFAULT_ORG_NAME,
    branchCode: process.env.CAMPAIGN_CHECKOUT_BRANCH_CODE?.trim() || DEFAULT_BRANCH_CODE,
    branchName: process.env.CAMPAIGN_CHECKOUT_BRANCH_NAME?.trim() || DEFAULT_BRANCH_NAME,
  };
}

async function resolveOwnerUserId(): Promise<number> {
  const user = await prisma.user.findFirst({ orderBy: { id: "asc" }, select: { id: true } });
  if (!user) {
    throw new Error(
      "No users in database — create at least one user before bootstrapping campaign branch"
    );
  }
  return user.id;
}

async function ensureBpaOrganization(ownerUserId: number, orgName: string) {
  let org = await prisma.organization.findFirst({
    where: {
      name: { equals: orgName, mode: "insensitive" },
      deletedAt: null,
    },
  });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: orgName,
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

async function ensureActiveCheckoutBranch(orgId: number, branchCode: string, branchName: string) {
  let branch = await prisma.branch.findFirst({
    where: { orgId, code: branchCode },
  });

  if (branch) {
    const wasActive = branch.status === "ACTIVE";
    if (!wasActive) {
      branch = await prisma.branch.update({
        where: { id: branch.id },
        data: { status: "ACTIVE", name: branchName },
      });
    }
    return { branch, created: false, reactivated: !wasActive };
  }

  branch = await prisma.branch.create({
    data: {
      orgId,
      code: branchCode,
      name: branchName,
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

  return { branch, created: true, reactivated: false };
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

export async function bootstrapCampaignBranch(): Promise<BootstrapCampaignBranchResult> {
  const { orgName, branchCode, branchName } = configFromEnv();
  const ownerUserId = await resolveOwnerUserId();
  const { org, created: orgCreated } = await ensureBpaOrganization(ownerUserId, orgName);
  const { branch, created: branchCreated, reactivated } = await ensureActiveCheckoutBranch(
    org.id,
    branchCode,
    branchName
  );
  const link = await linkCampaignsToOrganizer(org.id);

  const activeForOrg = await prisma.branch.count({
    where: { orgId: org.id, status: "ACTIVE" },
  });

  const sampleCampaign = link.campaigns[0] ?? { organizerId: org.id };
  const resolved = await resolveCampaignPaymentBranch({
    organizerId: sampleCampaign.organizerId ?? org.id,
  });

  return {
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
      reactivated,
    },
    campaigns: link,
    activeBranchesForOrganizer: activeForOrg,
    envRecommendation: {
      CAMPAIGN_PAYMENT_BRANCH_ID: String(branch.id),
    },
    resolverCheck: {
      branchId: resolved?.id ?? null,
      branchName: resolved?.name ?? null,
      ok: !!resolved,
    },
  };
}

async function main() {
  const result = await bootstrapCampaignBranch();

  console.log(JSON.stringify(result, null, 2));
  console.log("");
  console.log("--- Production .env recommendation ---");
  console.log(`CAMPAIGN_PAYMENT_BRANCH_ID=${result.envRecommendation.CAMPAIGN_PAYMENT_BRANCH_ID}`);
  console.log("");
  console.log(
    result.resolverCheck.ok
      ? "resolveCampaignPaymentBranch(): OK"
      : "resolveCampaignPaymentBranch(): FAILED — checkout will still be blocked"
  );

  if (!result.resolverCheck.ok) {
    process.exit(1);
  }
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
