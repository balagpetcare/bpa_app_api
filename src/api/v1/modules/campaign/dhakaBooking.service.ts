/**
 * Dhaka city corporation booking — DNCC/DSCC + locality (BdArea ZONE).
 * Hides operational coverage zones (North/South/Middle) from customers.
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { LocationErrors } from "./campaign.errors";
import { resolveZoneIdFromBdArea } from "./coverageLocation.service";
import {
  resolveZoneInterestCoverage,
  type ZoneInterestCoverage,
} from "./zoneInterest.service";

const CORP_CODES = ["DNCC", "DSCC"] as const;
const CC_BY_CORP: Record<string, string> = {
  DNCC: "CC-DNCC",
  DSCC: "CC-DSCC",
};

/** BdArea ZONE code prefix → operational coverage slug (internal analytics only). */
const ZONE_PREFIX_TO_COVERAGE_SLUG: Array<{ prefix: string; slug: string }> = [
  { prefix: "ZONE-DNCC-UTTARA", slug: "dhaka-metro-north" },
  { prefix: "ZONE-DNCC-AIRPORT", slug: "dhaka-metro-north" },
  { prefix: "ZONE-DNCC-DAKKHINKHAN", slug: "dhaka-metro-north" },
  { prefix: "ZONE-DNCC-UTTARKHAN", slug: "dhaka-metro-north" },
  { prefix: "ZONE-DNCC-KHILKHET", slug: "dhaka-metro-north" },
  { prefix: "ZONE-DNCC-MIRPUR", slug: "dhaka-metro-west" },
  { prefix: "ZONE-DNCC-PALLABI", slug: "dhaka-metro-west" },
  { prefix: "ZONE-DNCC-KAFRUL", slug: "dhaka-metro-west" },
  { prefix: "ZONE-DNCC-SHER_E_BANGLA_NAGAR", slug: "dhaka-metro-west" },
  { prefix: "ZONE-DNCC-GULSHAN", slug: "dhaka-metro-central" },
  { prefix: "ZONE-DNCC-TEJGAON", slug: "dhaka-metro-central" },
  { prefix: "ZONE-DNCC-BADDA", slug: "dhaka-metro-east" },
  { prefix: "ZONE-DNCC-MOHAMMADPUR", slug: "dhaka-metro-south" },
  { prefix: "ZONE-DSCC-", slug: "dhaka-metro-south" },
];

export type DhakaCityCorporationRow = {
  id: number;
  code: string;
  nameEn: string;
  nameBn: string | null;
};

export type DhakaBookingAreaRow = {
  id: number;
  code: string;
  nameEn: string;
  nameBn: string | null;
};

const FALLBACK_CORPS: DhakaCityCorporationRow[] = [
  {
    id: 0,
    code: "DNCC",
    nameEn: "Dhaka North City Corporation",
    nameBn: "ঢাকা উত্তর সিটি কর্পোরেশন",
  },
  {
    id: 0,
    code: "DSCC",
    nameEn: "Dhaka South City Corporation",
    nameBn: "ঢাকা দক্ষিণ সিটি কর্পোরেশন",
  },
];

export async function listDhakaCityCorporationsForBooking(): Promise<DhakaCityCorporationRow[]> {
  const rows = await prisma.cityCorporation.findMany({
    where: { code: { in: [...CORP_CODES] } },
    orderBy: { code: "asc" },
    select: { id: true, code: true, nameEn: true, nameBn: true },
  });
  return rows.length ? rows : FALLBACK_CORPS;
}

export async function listDhakaBookingAreas(
  cityCorporationCode: string
): Promise<DhakaBookingAreaRow[]> {
  const corp = cityCorporationCode.trim().toUpperCase();
  const ccCode = CC_BY_CORP[corp];
  if (!ccCode) return [];

  const corpNode = await prisma.bdArea.findFirst({
    where: { code: ccCode, type: "CITY_CORPORATION" },
    select: { id: true },
  });
  if (!corpNode) return [];

  return prisma.bdArea.findMany({
    where: { parentId: corpNode.id, type: "ZONE" },
    orderBy: { nameEn: "asc" },
    select: { id: true, code: true, nameEn: true, nameBn: true },
  });
}

async function findMappedBdAreaUnderZone(
  zoneId: number
): Promise<{ bdAreaId: number; coverageZoneId: number } | null> {
  const children = await prisma.bdArea.findMany({
    where: { parentId: zoneId, type: "AREA" },
    orderBy: { nameEn: "asc" },
    take: 120,
    select: { id: true },
  });
  for (const child of children) {
    const coverageZoneId = await resolveZoneIdFromBdArea(child.id);
    if (coverageZoneId) {
      return { bdAreaId: child.id, coverageZoneId };
    }
  }
  return null;
}

function coverageSlugForZoneCode(zoneCode: string): string | null {
  for (const row of ZONE_PREFIX_TO_COVERAGE_SLUG) {
    if (zoneCode.startsWith(row.prefix)) return row.slug;
  }
  return null;
}

async function loadCoverageZoneBySlug(slug: string): Promise<number | null> {
  const zone = await prisma.coverageZone.findFirst({
    where: { slug, isActive: true },
    select: { id: true },
  });
  return zone?.id ?? null;
}

export async function resolveDhakaCorporationCoverage(input: {
  cityCorporationCode: string;
  bdAreaId: number;
}): Promise<ZoneInterestCoverage> {
  const corp = input.cityCorporationCode.trim().toUpperCase();
  const ccCode = CC_BY_CORP[corp];
  if (!ccCode) {
    throw LocationErrors.INVALID_AREA_MAPPING();
  }

  const corpNode = await prisma.bdArea.findFirst({
    where: { code: ccCode, type: "CITY_CORPORATION" },
    select: { id: true },
  });
  if (!corpNode) {
    throw LocationErrors.MISSING_COVERAGE_MAPPING();
  }

  const locality = await prisma.bdArea.findFirst({
    where: { id: input.bdAreaId, parentId: corpNode.id, type: "ZONE" },
    select: { id: true, code: true, nameEn: true, nameBn: true },
  });
  if (!locality) {
    throw LocationErrors.INVALID_AREA_MAPPING();
  }

  const bookingArea = locality.nameEn || locality.nameBn || null;
  const mapped = await findMappedBdAreaUnderZone(locality.id);

  let coverageZoneId = mapped?.coverageZoneId ?? null;
  let bdAreaId = mapped?.bdAreaId ?? null;

  if (!coverageZoneId) {
    const slug = coverageSlugForZoneCode(locality.code);
    if (slug) {
      coverageZoneId = await loadCoverageZoneBySlug(slug);
    }
  }

  if (!coverageZoneId) {
    throw LocationErrors.MISSING_COVERAGE_MAPPING();
  }

  if (bdAreaId) {
    return resolveZoneInterestCoverage({
      coverageZoneId,
      bdAreaId,
      bookingArea,
    });
  }

  return resolveZoneInterestCoverage({
    coverageZoneId,
    bookingArea,
  });
}
