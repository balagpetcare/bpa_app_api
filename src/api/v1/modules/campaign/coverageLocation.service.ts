/**
 * Campaign location ↔ Dhaka metro / CoverageZone resolution.
 * Reuses CoverageZone + BdArea (no duplicate location master).
 */

import prisma from "../../../../infrastructure/db/prismaClient";

export type LocationAddressMeta = {
  coverageZoneId?: number;
  bdAreaId?: number;
  bdAreaCode?: string;
  bookingArea?: string;
  area?: string;
  dhakaAreaId?: number;
};

export type ResolvedLocationCoverage = {
  coverageZoneId: number | null;
  coverageZoneName: string | null;
  coverageZoneSlug: string | null;
  bookingArea: string | null;
  coverageZones: string[];
};

export function parseLocationAddressJson(raw: unknown): LocationAddressMeta {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const o = raw as Record<string, unknown>;
  const asInt = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
  };
  return {
    coverageZoneId: asInt(o.coverageZoneId),
    bdAreaId: asInt(o.bdAreaId ?? o.areaId),
    bdAreaCode: typeof o.bdAreaCode === "string" ? o.bdAreaCode.trim() : undefined,
    bookingArea:
      typeof o.bookingArea === "string"
        ? o.bookingArea.trim()
        : typeof o.area === "string"
          ? o.area.trim()
          : undefined,
    area: typeof o.area === "string" ? o.area.trim() : undefined,
    dhakaAreaId: asInt(o.dhakaAreaId),
  };
}

async function loadZoneById(id: number) {
  return prisma.coverageZone.findFirst({
    where: { id, isActive: true },
    select: { id: true, name: true, slug: true },
  });
}

export async function resolveZoneIdFromBdArea(bdAreaId: number): Promise<number | null> {
  const row = await prisma.coverageZoneArea.findFirst({
    where: { bdAreaId },
    orderBy: { coverageZoneId: "asc" },
    select: { coverageZoneId: true },
  });
  return row?.coverageZoneId ?? null;
}

async function resolveBdAreaLabel(meta: LocationAddressMeta): Promise<string | null> {
  if (meta.bookingArea) return meta.bookingArea;
  if (meta.area) return meta.area;

  if (meta.bdAreaId) {
    const area = await prisma.bdArea.findUnique({
      where: { id: meta.bdAreaId },
      select: { nameEn: true, nameBn: true },
    });
    if (area) return area.nameEn || area.nameBn || null;
  }

  if (meta.bdAreaCode) {
    const area = await prisma.bdArea.findFirst({
      where: { code: meta.bdAreaCode },
      select: { nameEn: true, nameBn: true },
    });
    if (area) return area.nameEn || area.nameBn || null;
  }

  return null;
}

/**
 * Resolve metro / coverage zone labels for a campaign location from addressJson.
 */
export async function resolveCoverageForLocation(
  addressJson: unknown
): Promise<ResolvedLocationCoverage> {
  const meta = parseLocationAddressJson(addressJson);

  let coverageZoneId = meta.coverageZoneId ?? null;
  if (!coverageZoneId && meta.bdAreaId) {
    coverageZoneId = await resolveZoneIdFromBdArea(meta.bdAreaId);
  }

  let zone: { id: number; name: string; slug: string } | null = null;
  if (coverageZoneId) {
    zone = await loadZoneById(coverageZoneId);
    if (!zone) coverageZoneId = null;
  }

  const bookingArea = await resolveBdAreaLabel(meta);

  const coverageZones: string[] = [];
  if (zone?.name) coverageZones.push(zone.name);

  return {
    coverageZoneId: zone?.id ?? coverageZoneId,
    coverageZoneName: zone?.name ?? null,
    coverageZoneSlug: zone?.slug ?? null,
    bookingArea,
    coverageZones,
  };
}

export async function resolveCoverageBatch(
  locations: Array<{ id: number; addressJson: unknown }>
): Promise<Map<number, ResolvedLocationCoverage>> {
  const map = new Map<number, ResolvedLocationCoverage>();
  await Promise.all(
    locations.map(async (loc) => {
      map.set(loc.id, await resolveCoverageForLocation(loc.addressJson));
    })
  );
  return map;
}

export async function resolveCoverageForCampaignLocationId(
  locationId: number,
  campaignId: number
): Promise<ResolvedLocationCoverage & { locationId: number }> {
  const loc = await prisma.campaignLocation.findFirst({
    where: { id: locationId, campaignId, isActive: true },
    select: { id: true, addressJson: true },
  });
  if (!loc) {
    return {
      locationId,
      coverageZoneId: null,
      coverageZoneName: null,
      coverageZoneSlug: null,
      bookingArea: null,
      coverageZones: [],
    };
  }
  const cov = await resolveCoverageForLocation(loc.addressJson);
  return { locationId: loc.id, ...cov };
}
