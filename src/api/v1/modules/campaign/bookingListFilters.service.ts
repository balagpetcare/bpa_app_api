/**
 * Shared admin booking list / export filters — database queries.
 */

import type { Prisma } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
import {
  buildBookingListWhere,
  type BookingListFilters,
  type BookingListSummary,
} from "./bookingListFilters.util";

export type { BookingListFilters, BookingListSummary } from "./bookingListFilters.util";
export { parseBookingListFilters, buildBookingListWhere } from "./bookingListFilters.util";

const BOOKING_LIST_INCLUDE = {
  location: { select: { id: true, name: true, address: true } },
  slot: { select: { startTime: true, endTime: true } },
  checkedInBy: {
    select: {
      id: true,
      profile: { select: { displayName: true } },
    },
  },
  pets: true,
} satisfies Prisma.CampaignBookingInclude;

export async function aggregateBookingListSummary(
  campaignId: number,
  filteredWhere: Prisma.CampaignBookingWhereInput
): Promise<BookingListSummary> {
  const [allAgg, filteredAgg] = await Promise.all([
    prisma.campaignBooking.aggregate({
      where: { campaignId },
      _count: { id: true },
      _sum: { petCount: true },
    }),
    prisma.campaignBooking.aggregate({
      where: filteredWhere,
      _count: { id: true },
      _sum: { petCount: true },
    }),
  ]);

  return {
    totalBookings: allAgg._count.id,
    totalPets: allAgg._sum.petCount ?? 0,
    filteredBookings: filteredAgg._count.id,
    filteredPets: filteredAgg._sum.petCount ?? 0,
  };
}

export async function queryCampaignBookings(filters: BookingListFilters) {
  const where = buildBookingListWhere(filters);
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const skip = (page - 1) * pageSize;

  const [items, total, summary] = await Promise.all([
    prisma.campaignBooking.findMany({
      where,
      include: BOOKING_LIST_INCLUDE,
      orderBy: [{ bookingDate: "desc" }, { createdAt: "desc" }],
      skip,
      take: pageSize,
    }),
    prisma.campaignBooking.count({ where }),
    aggregateBookingListSummary(filters.campaignId, where),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize) || 1,
    summary,
  };
}

export async function getBookingFilterOptions(campaignId: number) {
  const rows = await prisma.campaignBooking.findMany({
    where: { campaignId },
    select: {
      bookingArea: true,
      coverageZoneName: true,
      bookingMode: true,
      paymentStatus: true,
      ownerAddressJson: true,
    },
    take: 5000,
  });

  const areas = new Set<string>();
  const coverageZones = new Set<string>();
  const cityCorporations = new Set<string>();
  const bookingModes = new Set<string>();
  const paymentStatuses = new Set<string>();

  for (const row of rows) {
    if (row.bookingArea?.trim()) areas.add(row.bookingArea.trim());
    if (row.coverageZoneName?.trim()) coverageZones.add(row.coverageZoneName.trim());
    if (row.bookingMode) bookingModes.add(row.bookingMode);
    if (row.paymentStatus) paymentStatuses.add(row.paymentStatus);

    const addr = row.ownerAddressJson as Record<string, unknown> | null;
    const code =
      typeof addr?.cityCorporationCode === "string"
        ? addr.cityCorporationCode.trim().toUpperCase()
        : "";
    if (code === "DNCC" || code === "DSCC") cityCorporations.add(code);
  }

  if (!cityCorporations.size) {
    cityCorporations.add("DNCC");
    cityCorporations.add("DSCC");
  }

  return {
    cityCorporations: [...cityCorporations].sort(),
    areas: [...areas].sort((a, b) => a.localeCompare(b)),
    coverageZones: [...coverageZones].sort((a, b) => a.localeCompare(b)),
    bookingModes: [...bookingModes].sort(),
    paymentStatuses: [...paymentStatuses].sort(),
  };
}

export { BOOKING_LIST_INCLUDE };
