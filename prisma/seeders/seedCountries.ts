import { PrismaClient } from "@prisma/client";

/**
 * Global-Ready Phase 1: Seed countries (BD + IN, US).
 * Reference: docs/GLOBAL_READY_FULL_PLANNING.md
 */
export default async function seedCountries(prisma: PrismaClient) {
  const countries = [
    { code: "BD", name: "Bangladesh", currencyCode: "BDT", timezoneDefault: "Asia/Dhaka" },
    { code: "IN", name: "India", currencyCode: "INR", timezoneDefault: "Asia/Kolkata" },
    { code: "US", name: "United States", currencyCode: "USD", timezoneDefault: "America/New_York" },
  ];

  for (const c of countries) {
    await prisma.country.upsert({
      where: { code: c.code },
      update: {
        name: c.name,
        currencyCode: c.currencyCode,
        timezoneDefault: c.timezoneDefault,
        isActive: true,
      },
      create: {
        code: c.code,
        name: c.name,
        currencyCode: c.currencyCode,
        timezoneDefault: c.timezoneDefault,
        isActive: true,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(`✅ Seeded ${countries.length} countries (BD, IN, US)`);
}
