import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";
import { validateActivePaymentProviderConfig, getEpsConfig, getActivePaymentProvider } from "../src/api/v1/providers/paymentProvider.config";
import { validateSmsProviderConfig } from "../src/shared/services/sms/sms.constants";
import { bootstrapSmsProvider } from "../src/integrations/sms/smsProvider.bootstrap";
import { bootstrapPaymentProvider } from "../src/api/v1/payments/paymentProvider.bootstrap";
import { isSmsEnabled } from "../src/shared/services/sms/sms.constants";
import { bulkSmsBdProvider } from "../src/integrations/sms/bulkSmsBd.provider";

async function main() {
  const branches = await prisma.branch.count({ where: { status: "ACTIVE" } });
  const branchSample = await prisma.branch.findFirst({
    where: { status: "ACTIVE" },
    select: { id: true, code: true, name: true, orgId: true },
  });
  const configs = await prisma.campaignConfig.findMany({
    select: {
      campaignId: true,
      bookingEnabled: true,
      onlinePaymentEnabled: true,
      payAtVenueEnabled: true,
    },
  });
  const campaigns = await prisma.campaign.findMany({
    select: { id: true, slug: true, pricingType: true, priceAmount: true, organizerId: true, status: true },
  });
  const smsLogs = await prisma.smsLog.count();
  const campaignSms = await prisma.campaignSmsLog.count();
  const recentSms = await prisma.smsLog.findMany({
    orderBy: { id: "desc" },
    take: 5,
    select: { id: true, status: true, template: true, provider: true, createdAt: true },
  });
  const paymentLogs = await prisma.paymentTransactionLog.count();
  const bookings = await prisma.campaignBooking.groupBy({
    by: ["paymentStatus"],
    _count: true,
  });

  const paymentBoot = bootstrapPaymentProvider();
  const smsBoot = bootstrapSmsProvider();
  const paymentValidation = validateActivePaymentProviderConfig();
  const smsValidation = validateSmsProviderConfig();

  const epsWhenActive = (() => {
    process.env.PAYMENT_PROVIDER = "eps";
    const v = validateActivePaymentProviderConfig();
    const eps = getEpsConfig();
    process.env.PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER || "sslcommerz";
    return { validation: v, callbackUrls: { success: eps.successUrl, fail: eps.failUrl, cancel: eps.cancelUrl, webhook: eps.callbackUrl } };
  })();

  console.log(
    JSON.stringify(
      {
        env: {
          NODE_ENV: process.env.NODE_ENV,
          PAYMENT_PROVIDER: getActivePaymentProvider(),
          SMS_PROVIDER: process.env.SMS_PROVIDER,
          SMS_ENABLED: isSmsEnabled(),
          REDIS_ENABLED: process.env.REDIS_ENABLED,
          API_PUBLIC_BASE_URL: Boolean(process.env.API_PUBLIC_BASE_URL?.trim()),
          CAMPAIGN_LANDING_URL: Boolean(process.env.CAMPAIGN_LANDING_URL?.trim()),
          CAMPAIGN_PAYMENT_BRANCH_ID: process.env.CAMPAIGN_PAYMENT_BRANCH_ID || null,
        },
        paymentBoot,
        smsBoot,
        paymentValidation,
        smsValidation,
        bulksmsbdConfigured: bulkSmsBdProvider.isConfigured(),
        epsIfActive: epsWhenActive,
        db: { branches, branchSample, configs, campaigns, smsLogs, campaignSms, recentSms, paymentLogs, bookings },
      },
      null,
      2
    )
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
