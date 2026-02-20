import { PrismaClient } from "@prisma/client";

/**
 * Phase 1: Backfill organizations with default country (BD).
 * Keeps backward compatibility if orgs existed before country binding.
 */
export default async function seedOrganizationCountries(prisma: PrismaClient) {
  const bd = await prisma.country.findUnique({ where: { code: "BD" } });
  if (!bd) {
    // eslint-disable-next-line no-console
    console.warn("⚠️ Country BD not found. Skipping organization country backfill.");
    return;
  }

  const res = await prisma.organization.updateMany({
    where: { countryId: null },
    data: { countryId: bd.id },
  });

  // eslint-disable-next-line no-console
  console.log(`✅ Backfilled organizations with BD (${res.count})`);
}

