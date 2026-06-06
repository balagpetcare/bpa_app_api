import { CoverageZoneType, PrismaClient } from '@prisma/client';
import { DSCC_COVERAGE } from './data/dscc-coverage-mapping';
import { upsertCoverageZone } from './lib/upsertCoverageZone';

/** DSCC CoverageZone — maps CC-DSCC, zones, and all AREA-DSCC-* BdArea rows. */
export default async function seedDhakaSouthCity(prisma: PrismaClient) {
  const dsccAreas = await prisma.bdArea.findMany({
    where: {
      OR: [
        { code: 'CC-DSCC' },
        { code: { startsWith: 'ZONE-DSCC-' } },
        { code: { startsWith: 'AREA-DSCC-' } },
      ],
    },
    select: { code: true },
    orderBy: { code: 'asc' },
  });

  const codes = dsccAreas.length > 0
    ? dsccAreas.map((a) => a.code)
    : [...DSCC_COVERAGE.bdAreaCodes];

  await upsertCoverageZone(prisma, {
    name: DSCC_COVERAGE.name,
    slug: DSCC_COVERAGE.slug,
    description: DSCC_COVERAGE.description,
    city: 'Dhaka',
    zoneType: CoverageZoneType.CITY_CORPORATION,
    sortOrder: 11,
    bdAreaCodes: codes,
  });

  return { mappedAreaCount: codes.length };
}
