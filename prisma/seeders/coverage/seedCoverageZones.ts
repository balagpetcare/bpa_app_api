import { CoverageZoneType, PrismaClient } from '@prisma/client';
import { DHAKA_METRO_ROOT, DHAKA_METRO_ZONES } from './data/dhaka-metro-coverage';
import { upsertCoverageZone } from './lib/upsertCoverageZone';

/**
 * Seeds Dhaka Metro CoverageZone hierarchy (parent + 5 directional zones).
 * Maps to existing BdArea rows — does not create bd_* duplicates.
 */
export default async function seedCoverageZones(prisma: PrismaClient) {
  await upsertCoverageZone(prisma, {
    name: DHAKA_METRO_ROOT.name,
    slug: DHAKA_METRO_ROOT.slug,
    description: DHAKA_METRO_ROOT.description,
    city: 'Dhaka',
    zoneType: CoverageZoneType.METRO,
    sortOrder: DHAKA_METRO_ROOT.sortOrder,
    metadata: {
      estimatedPetPopulation: 450000,
      estimatedClinicCount: 120,
      estimatedPetShopCount: 80,
      estimatedVolunteerCount: 200,
    },
  });

  for (const z of DHAKA_METRO_ZONES) {
    await upsertCoverageZone(prisma, {
      name: z.name,
      slug: z.slug,
      description: `${z.name} — Dhaka Metro operational coverage`,
      city: 'Dhaka',
      zoneType: CoverageZoneType.METRO,
      sortOrder: z.sortOrder,
      bdAreaCodes: z.bdAreaCodes,
    });
  }
}
