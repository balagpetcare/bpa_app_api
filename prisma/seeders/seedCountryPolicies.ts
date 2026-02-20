import { PrismaClient } from "@prisma/client";

/**
 * Global-Ready Phase 1: BD ACTIVE policy with DONATION=true, PRODUCTS=true + donation rules.
 * Reference: docs/GLOBAL_READY_FULL_PLANNING.md
 */
export default async function seedCountryPolicies(prisma: PrismaClient) {
  const bd = await prisma.country.findUnique({ where: { code: "BD" } });
  if (!bd) {
    throw new Error("Country BD not found. Run seedCountries first.");
  }

  // Ensure one ACTIVE policy for BD
  let policy = await prisma.countryPolicy.findFirst({
    where: { countryId: bd.id, status: "ACTIVE" },
  });
  if (!policy) {
    policy = await prisma.countryPolicy.create({
      data: {
        countryId: bd.id,
        name: "Bangladesh Default Policy",
        status: "ACTIVE",
        effectiveFrom: new Date(),
        effectiveTo: null,
      },
    });
  }

  const featureCodes = ["DONATION", "FUNDRAISING", "PRODUCTS", "ADS"];
  for (const code of featureCodes) {
    await prisma.policyFeature.upsert({
      where: {
        countryPolicyId_featureCode: { countryPolicyId: policy.id, featureCode: code },
      },
      update: { enabled: true },
      create: {
        countryPolicyId: policy.id,
        featureCode: code,
        enabled: true,
      },
    });
  }

  const rules = [
    { ruleType: "INBOUND", maxAmountSingle: 500000, maxAmountDaily: 2000000 },
    { ruleType: "OUTBOUND", maxAmountSingle: 100000, maxAmountDaily: 500000 },
  ];
  for (const r of rules) {
    const existing = await prisma.policyDonationRule.findFirst({
      where: { countryPolicyId: policy.id, ruleType: r.ruleType },
    });
    if (existing) {
      await prisma.policyDonationRule.update({
        where: { id: existing.id },
        data: {
          maxAmountSingle: r.maxAmountSingle,
          maxAmountDaily: r.maxAmountDaily,
          enabled: true,
        },
      });
    } else {
      await prisma.policyDonationRule.create({
        data: {
          countryPolicyId: policy.id,
          ruleType: r.ruleType,
          maxAmountSingle: r.maxAmountSingle,
          maxAmountDaily: r.maxAmountDaily,
          enabled: true,
        },
      });
    }
  }

  // Phase 3: BD payment methods (BKASH, NAGAD, ROCKET)
  const paymentProviders = [
    { providerCode: "BKASH", sortOrder: 1 },
    { providerCode: "NAGAD", sortOrder: 2 },
    { providerCode: "ROCKET", sortOrder: 3 },
  ];
  for (const p of paymentProviders) {
    await prisma.policyPaymentMethod.upsert({
      where: {
        countryPolicyId_providerCode: { countryPolicyId: policy.id, providerCode: p.providerCode },
      },
      update: { enabled: true, sortOrder: p.sortOrder },
      create: {
        countryPolicyId: policy.id,
        providerCode: p.providerCode,
        enabled: true,
        sortOrder: p.sortOrder,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log("✅ Seeded BD ACTIVE policy (DONATION=true, PRODUCTS=true + donation rules + payment methods)");
}
