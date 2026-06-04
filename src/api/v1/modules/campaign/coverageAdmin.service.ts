/**
 * Admin helpers for campaign location ↔ CoverageZone / BdArea (reuses location master).
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { LocationErrors } from "./campaign.errors";
import {
  parseLocationAddressJson,
  resolveZoneIdFromBdArea,
} from "./coverageLocation.service";

export type AdminCoverageZoneRow = {
  id: number;
  name: string;
  slug: string;
  city: string | null;
  zoneType: string;
};

export type AdminBdAreaRow = {
  id: number;
  code: string;
  nameEn: string;
  nameBn: string | null;
};

export async function listAdminCoverageZones(): Promise<AdminCoverageZoneRow[]> {
  return prisma.coverageZone.findMany({
    where: {
      isActive: true,
      OR: [
        { city: { equals: "Dhaka", mode: "insensitive" } },
        { zoneType: "METRO" },
        { slug: { startsWith: "dhaka" } },
      ],
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      city: true,
      zoneType: true,
    },
  });
}

export async function listBdAreasForCoverageZone(
  coverageZoneId: number,
  options: { q?: string; limit?: number } = {}
): Promise<AdminBdAreaRow[]> {
  const zone = await prisma.coverageZone.findFirst({
    where: { id: coverageZoneId, isActive: true },
    select: { id: true },
  });
  if (!zone) return [];

  const mappings = await prisma.coverageZoneArea.findMany({
    where: { coverageZoneId, bdAreaId: { not: null } },
    select: { bdAreaId: true },
  });
  const areaIds = [
    ...new Set(
      mappings.map((m) => m.bdAreaId).filter((id): id is number => id != null)
    ),
  ];
  if (areaIds.length === 0) return [];

  const limit = Math.min(options.limit ?? 80, 100);
  const q = options.q?.trim();

  return prisma.bdArea.findMany({
    where: {
      id: { in: areaIds },
      ...(q
        ? {
            OR: [
              { nameEn: { contains: q, mode: "insensitive" } },
              { nameBn: { contains: q, mode: "insensitive" } },
              { code: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { nameEn: "asc" },
    take: limit,
    select: { id: true, code: true, nameEn: true, nameBn: true },
  });
}

export async function isBdAreaInCoverageZone(
  coverageZoneId: number,
  bdAreaId: number
): Promise<boolean> {
  const row = await prisma.coverageZoneArea.findFirst({
    where: { coverageZoneId, bdAreaId },
    select: { id: true },
  });
  return !!row;
}

export async function assertUniqueCampaignLocationName(
  campaignId: number,
  name: string,
  excludeLocationId?: number
) {
  const trimmed = name.trim();
  if (!trimmed) return;

  const existing = await prisma.campaignLocation.findFirst({
    where: {
      campaignId,
      ...(excludeLocationId ? { id: { not: excludeLocationId } } : {}),
      name: { equals: trimmed, mode: "insensitive" },
    },
    select: { id: true, name: true },
  });

  if (existing) {
    throw LocationErrors.DUPLICATE_NAME(trimmed);
  }
}

export async function normalizeLocationCoverageInput(input: {
  coverageZoneId?: number | null;
  bdAreaId?: number | null;
  bookingArea?: string | null;
}): Promise<{
  coverageZoneId: number | null;
  bdAreaId: number | null;
  bookingArea: string | null;
}> {
  let coverageZoneId =
    input.coverageZoneId && input.coverageZoneId > 0 ? input.coverageZoneId : null;
  const bdAreaId = input.bdAreaId && input.bdAreaId > 0 ? input.bdAreaId : null;
  let bookingArea = input.bookingArea?.trim() || null;

  if (bdAreaId) {
    const area = await prisma.bdArea.findUnique({
      where: { id: bdAreaId },
      select: { id: true, nameEn: true, nameBn: true },
    });
    if (!area) {
      throw LocationErrors.INVALID_AREA_MAPPING();
    }
    if (!bookingArea) bookingArea = area.nameEn || area.nameBn || null;

    if (coverageZoneId) {
      const ok = await isBdAreaInCoverageZone(coverageZoneId, bdAreaId);
      if (!ok) throw LocationErrors.INVALID_AREA_MAPPING();
    } else {
      const resolved = await resolveZoneIdFromBdArea(bdAreaId);
      if (!resolved) throw LocationErrors.MISSING_COVERAGE_MAPPING();
      coverageZoneId = resolved;
    }
  }

  if (!coverageZoneId && !bdAreaId) {
    throw LocationErrors.MISSING_COVERAGE_MAPPING();
  }

  if (coverageZoneId && !bdAreaId) {
    const zone = await prisma.coverageZone.findFirst({
      where: { id: coverageZoneId, isActive: true },
      select: { id: true },
    });
    if (!zone) throw LocationErrors.MISSING_COVERAGE_MAPPING();
  }

  return { coverageZoneId, bdAreaId, bookingArea };
}

export function mergeLocationAddressJson(
  existing: unknown,
  coverage: {
    coverageZoneId: number | null;
    bdAreaId: number | null;
    bookingArea: string | null;
  }
) {
  const prev = parseLocationAddressJson(existing);
  return {
    ...((existing && typeof existing === "object" && !Array.isArray(existing)
      ? existing
      : {}) as Record<string, unknown>),
    coverageZoneId: coverage.coverageZoneId ?? undefined,
    bdAreaId: coverage.bdAreaId ?? undefined,
    bookingArea: coverage.bookingArea ?? prev.bookingArea ?? undefined,
  };
}
