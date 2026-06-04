/**
 * Verifies BPA campaign checkout anchor: org, ACTIVE branch, campaign.organizerId,
 * and that paid init creates session + order with branchId (payment may fail on gateway env).
 */
import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";
import { initCheckout } from "../src/api/v1/modules/campaign/checkout.service";

const ORG_NAME =
  process.env.CAMPAIGN_ORGANIZER_ORG_NAME?.trim() || "Bangladesh Pet Association";

async function main() {
  const org = await prisma.organization.findFirst({
    where: { name: { equals: ORG_NAME, mode: "insensitive" }, deletedAt: null },
    select: { id: true, name: true, status: true },
  });

  const branch = org
    ? await prisma.branch.findFirst({
        where: { orgId: org.id, status: "ACTIVE" },
        select: { id: true, code: true, name: true, status: true, orgId: true },
      })
    : null;

  const campaigns = await prisma.campaign.findMany({
    orderBy: { id: "asc" },
    select: { id: true, slug: true, organizerId: true, pricingType: true },
  });

  const checks: Record<string, boolean> = {
    organizationExists: !!org,
    organizationApproved: org?.status === "APPROVED",
    activeBranchExists: !!branch,
    branchBelongsToOrg: branch?.orgId === org?.id,
    allCampaignsHaveOrganizer:
      campaigns.length > 0 && campaigns.every((c) => c.organizerId === org?.id),
  };

  const campaign = campaigns[0];
  let flow: Record<string, unknown> = { skipped: !campaign?.slug || !branch };

  if (campaign?.slug && branch) {
    const corp = await prisma.bdArea.findFirst({
      where: { code: "CC-DNCC", type: "CITY_CORPORATION" },
      select: { id: true },
    });
    const zone = corp
      ? await prisma.bdArea.findFirst({
          where: { parentId: corp.id, type: "ZONE" },
          select: { id: true },
        })
      : null;

    const phone = `017${String(Date.now()).slice(-8)}`;
    let initError: string | null = null;
    try {
      await initCheckout({
        campaignSlug: campaign.slug,
        phone,
        cityCorporationCode: "DNCC",
        bdAreaId: zone?.id ?? 0,
        catCount: 1,
        paymentMethod: "BKASH",
      });
    } catch (e) {
      initError = e instanceof Error ? e.message : String(e);
    }

    const session = await prisma.campaignCheckoutSession.findFirst({
      where: { ownerPhone: phone },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, orderId: true, campaignId: true },
    });

    const order = session?.orderId
      ? await prisma.order.findUnique({
          where: { id: session.orderId },
          select: { id: true, branchId: true, paymentStatus: true, orderNumber: true },
        })
      : null;

    const branchGatePassed =
      !initError?.includes("Campaign payment setup not configured");
    const gatewayOnly =
      !!initError &&
      (initError.includes("SSLCommerz") ||
        initError.includes("payment") ||
        initError.includes("Payment") ||
        initError.includes("configured"));

    flow = {
      campaignSlug: campaign.slug,
      sessionCreated: !!session,
      orderCreated: !!order,
      orderBranchId: order?.branchId ?? null,
      orderMatchesActiveBranch: order?.branchId === branch.id,
      branchGatePassed,
      paymentIntentError: initError,
      gatewayEnvOnly: branchGatePassed && gatewayOnly,
    };

    checks.checkoutSessionCreated = !!session;
    checks.orderLinkedToSession = !!session?.orderId;
    checks.orderUsesActiveBranch = order?.branchId === branch.id;
    checks.noBranchValidationError = branchGatePassed;
  }

  const allOk = Object.values(checks).every(Boolean);

  console.log(
    JSON.stringify(
      {
        ok: allOk,
        organization: org,
        branch,
        campaigns,
        checks,
        flow,
      },
      null,
      2
    )
  );

  process.exit(allOk ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
