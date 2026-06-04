/**
 * Zone-interest booking — coverage zone + BdArea without venue/slot at checkout.
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { LocationErrors } from "./campaign.errors";
import { isBdAreaInCoverageZone } from "./coverageAdmin.service";

export type ZoneInterestCoverage = {
  coverageZoneId: number;
  coverageZoneName: string;
  bdAreaId: number | null;
  bookingArea: string | null;
};

export async function resolveZoneInterestCoverage(input: {
  coverageZoneId: number;
  bdAreaId?: number | null;
  bookingArea?: string | null;
}): Promise<ZoneInterestCoverage> {
  const coverageZoneId =
    input.coverageZoneId && input.coverageZoneId > 0 ? input.coverageZoneId : 0;
  if (!coverageZoneId) {
    throw LocationErrors.MISSING_COVERAGE_MAPPING();
  }

  const zone = await prisma.coverageZone.findFirst({
    where: { id: coverageZoneId, isActive: true },
    select: { id: true, name: true },
  });
  if (!zone) {
    throw LocationErrors.MISSING_COVERAGE_MAPPING();
  }

  let bdAreaId =
    input.bdAreaId && input.bdAreaId > 0 ? input.bdAreaId : null;
  let bookingArea = input.bookingArea?.trim() || null;

  if (bdAreaId) {
    const area = await prisma.bdArea.findUnique({
      where: { id: bdAreaId },
      select: { id: true, nameEn: true, nameBn: true },
    });
    if (!area) {
      throw LocationErrors.INVALID_AREA_MAPPING();
    }
    const ok = await isBdAreaInCoverageZone(coverageZoneId, bdAreaId);
    if (!ok) {
      throw LocationErrors.INVALID_AREA_MAPPING();
    }
    if (!bookingArea) {
      bookingArea = area.nameEn || area.nameBn || null;
    }
  }

  if (!bookingArea && !bdAreaId) {
    throw LocationErrors.MISSING_COVERAGE_MAPPING();
  }

  return {
    coverageZoneId,
    coverageZoneName: zone.name,
    bdAreaId,
    bookingArea: bookingArea?.slice(0, 200) ?? null,
  };
}

export function isZoneInterestAddress(address: Record<string, unknown>): boolean {
  if (address.bookingMode === "ZONE_INTEREST") return true;
  const hasZone =
    typeof address.coverageZoneId === "number" && address.coverageZoneId > 0;
  const hasLoc =
    (typeof address.campaignLocationId === "number" && address.campaignLocationId > 0) ||
    (typeof address.locationId === "number" && address.locationId > 0);
  const hasRollout =
    typeof address.divisionId === "number" && typeof address.districtId === "number";
  return hasZone && !hasLoc && !hasRollout;
}
