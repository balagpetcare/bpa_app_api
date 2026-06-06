import { CoverageZoneType, PrismaClient } from '@prisma/client';
import { DNCC_COVERAGE } from './data/dncc-coverage-mapping';
import { upsertCoverageZone } from './lib/upsertCoverageZone';

/** DNCC CoverageZone — maps CC-DNCC, zones, and all AREA-DNCC-* BdArea rows. */
export default async function seedDhakaNorthCity(prisma: PrismaClient) {
  const dnccAreas = await prisma.bdArea.findMany({
    where: {
      OR: [
        { code: 'CC-DNCC' },
        { code: { startsWith: 'ZONE-DNCC-' } },
        { code: { startsWith: 'AREA-DNCC-' } },
      ],
    },
    select: { code: true },
    orderBy: { code: 'asc' },
  });

  const codes = dnccAreas.length > 0
    ? dnccAreas.map((a) => a.code)
    : [...DNCC_COVERAGE.bdAreaCodes];

  await upsertCoverageZone(prisma, {
    name: DNCC_COVERAGE.name,
    slug: DNCC_COVERAGE.slug,
    description: DNCC_COVERAGE.description,
    city: 'Dhaka',
    zoneType: CoverageZoneType.CITY_CORPORATION,
    sortOrder: 10,
    bdAreaCodes: codes,
  });

  return { mappedAreaCount: codes.length };
}
