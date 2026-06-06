import { CoverageZoneType, PrismaClient } from '@prisma/client';
import { resolveBdAreaByCode } from './resolveBdArea';

export type CoverageZoneSeed = {
  name: string;
  slug: string;
  description?: string;
  city?: string;
  zoneType: CoverageZoneType;
  sortOrder?: number;
  metadata?: {
    estimatedPetPopulation?: number;
    estimatedClinicCount?: number;
    estimatedPetShopCount?: number;
    estimatedVolunteerCount?: number;
  };
  bdAreaCodes?: string[];
};

export async function upsertCoverageZone(prisma: PrismaClient, seed: CoverageZoneSeed) {
  const zone = await prisma.coverageZone.upsert({
    where: { slug: seed.slug },
    update: {
      name: seed.name,
      description: seed.description ?? null,
      city: seed.city ?? null,
      zoneType: seed.zoneType,
      sortOrder: seed.sortOrder ?? 0,
      isActive: true,
    },
    create: {
      name: seed.name,
      slug: seed.slug,
      description: seed.description ?? null,
      city: seed.city ?? 'Dhaka',
      zoneType: seed.zoneType,
      sortOrder: seed.sortOrder ?? 0,
      isActive: true,
    },
  });

  if (seed.metadata) {
    await prisma.coverageZoneMetadata.upsert({
      where: { coverageZoneId: zone.id },
      update: seed.metadata,
      create: { coverageZoneId: zone.id, ...seed.metadata },
    });
  }

  const codes = seed.bdAreaCodes ?? [];
  for (const code of codes) {
    const resolved = await resolveBdAreaByCode(prisma, code);
    if (!resolved) {
      console.warn(`[coverage] BdArea not found for code=${code} (zone=${seed.slug})`);
      continue;
    }
    await prisma.coverageZoneArea.upsert({
      where: {
        coverageZoneId_bdAreaId: {
          coverageZoneId: zone.id,
          bdAreaId: resolved.bdAreaId,
        },
      },
      update: {
        bdUnionId: resolved.bdUnionId,
        bdUpazilaId: resolved.bdUpazilaId,
        bdDistrictId: resolved.bdDistrictId,
      },
      create: {
        coverageZoneId: zone.id,
        bdAreaId: resolved.bdAreaId,
        bdUnionId: resolved.bdUnionId,
        bdUpazilaId: resolved.bdUpazilaId,
        bdDistrictId: resolved.bdDistrictId,
      },
    });
  }

  return zone;
}
