import { PrismaClient } from '@prisma/client';
import { BUSINESS_COVERAGE_READINESS } from './data/business-coverage-readiness';
import { upsertCoverageZone } from './lib/upsertCoverageZone';

/** Registers business coverage types (no entity rows, no BdArea mappings). */
export default async function seedBusinessCoverageReadiness(prisma: PrismaClient) {
  for (const row of BUSINESS_COVERAGE_READINESS) {
    await upsertCoverageZone(prisma, {
      name: row.name,
      slug: row.slug,
      description: row.description,
      city: 'Dhaka',
      zoneType: row.zoneType,
      sortOrder: row.sortOrder,
    });
  }
}
