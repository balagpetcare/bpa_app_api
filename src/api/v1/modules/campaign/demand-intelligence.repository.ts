/**
 * Data access for demand intelligence aggregations.
 */

import type { Prisma } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
import { CampaignErrors } from "./campaign.errors";

/** District row shape used for division centroid derivation (schema-aligned). */
export type GeoDistrictCoordinateRow = {
  divisionId: number;
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
};

export type DivisionCentroid = {
  latitude: number | null;
  longitude: number | null;
  /** Districts that contributed coordinates (for diagnostics). */
  districtCount: number;
};

/**
 * Mean lat/lng of districts per division — BdDivision has no stored coordinates.
 */
export function deriveDivisionCentroids(
  districts: GeoDistrictCoordinateRow[]
): Map<number, DivisionCentroid> {
  const acc = new Map<number, { latSum: number; lngSum: number; n: number }>();

  for (const d of districts) {
    if (d.latitude == null || d.longitude == null) continue;
    const lat = Number(d.latitude);
    const lng = Number(d.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const cur = acc.get(d.divisionId) ?? { latSum: 0, lngSum: 0, n: 0 };
    cur.latSum += lat;
    cur.lngSum += lng;
    cur.n += 1;
    acc.set(d.divisionId, cur);
  }

  const result = new Map<number, DivisionCentroid>();
  for (const [divisionId, v] of acc) {
    result.set(divisionId, {
      latitude: v.n > 0 ? v.latSum / v.n : null,
      longitude: v.n > 0 ? v.lngSum / v.n : null,
      districtCount: v.n,
    });
  }
  return result;
}

export async function findCampaignContext(campaignId: number) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      name: true,
      priceAmount: true,
      pricingType: true,
      currency: true,
      targetVaccinations: true,
      startDate: true,
      endDate: true,
    },
  });
  if (!campaign) throw CampaignErrors.NOT_FOUND(campaignId);
  return campaign;
}

export async function findPreRegistrations(campaignId: number) {
  return prisma.campaignPreRegistration.findMany({
    where: { campaignId },
    select: {
      id: true,
      divisionId: true,
      districtId: true,
      upazilaId: true,
      catCount: true,
      createdAt: true,
    },
  });
}

export async function findBookings(campaignId: number) {
  return prisma.campaignBooking.findMany({
    where: {
      campaignId,
      status: { notIn: ["CANCELLED"] },
    },
    select: {
      id: true,
      petCount: true,
      locationId: true,
      ownerAddressJson: true,
      createdAt: true,
    },
  });
}

export async function countVaccinatedPets(campaignId: number) {
  return prisma.campaignPet.count({
    where: {
      vaccinationStatus: "COMPLETED",
      booking: { campaignId },
    },
  });
}

export async function findVaccinationTrendByDay(campaignId: number, since: Date) {
  return prisma.campaignPet.findMany({
    where: {
      vaccinationStatus: "COMPLETED",
      updatedAt: { gte: since },
      booking: { campaignId },
    },
    select: { updatedAt: true },
  });
}

export async function findGeoReference() {
  const [divisions, districts, upazilas] = await Promise.all([
    prisma.bdDivision.findMany({
      select: { id: true, nameEn: true },
    }),
    prisma.bdDistrict.findMany({
      select: { id: true, nameEn: true, divisionId: true, latitude: true, longitude: true },
    }),
    prisma.bdUpazila.findMany({
      select: { id: true, nameEn: true, districtId: true, latitude: true, longitude: true },
    }),
  ]);
  return { divisions, districts, upazilas };
}

export async function findLocationsWithSlots(campaignId: number) {
  return prisma.campaignLocation.findMany({
    where: { campaignId },
    select: {
      id: true,
      name: true,
      dailyCapacity: true,
      isActive: true,
      slots: {
        select: {
          id: true,
          capacity: true,
          bookedCount: true,
          date: true,
          status: true,
        },
      },
      _count: { select: { bookings: { where: { status: { notIn: ["CANCELLED"] } } } } },
    },
  });
}

export async function findStaffSummary(campaignId: number) {
  const staff = await prisma.campaignStaff.findMany({
    where: { campaignId, isActive: true },
    select: { role: true },
  });
  return staff;
}

export async function findVaccineInventory(campaignId: number) {
  const [included, typed] = await Promise.all([
    prisma.campaignIncludedVaccine.findMany({
      where: { campaignId, isActive: true },
      orderBy: { displayOrder: "asc" },
      select: { id: true, name: true },
    }),
    prisma.campaignVaccineType.findMany({
      where: { campaignId, isActive: true },
      select: {
        id: true,
        allocatedDoses: true,
        usedDoses: true,
        vaccineType: { select: { id: true, name: true } },
      },
    }),
  ]);
  return { included, typed };
}

export async function findRolloutRegions(campaignId: number) {
  return prisma.campaignRolloutRegion.findMany({
    where: { campaignId },
    include: { _count: { select: { preRegistrations: true } } },
  });
}

export async function aggregateBookingsByLocation(campaignId: number) {
  return prisma.campaignBooking.groupBy({
    by: ["locationId"],
    where: {
      campaignId,
      status: { notIn: ["CANCELLED"] },
      locationId: { not: null },
    },
    _sum: { petCount: true },
    _count: { id: true },
  });
}
