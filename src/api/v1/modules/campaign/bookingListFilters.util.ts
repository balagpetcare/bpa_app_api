/**
 * Pure booking list filter parsing and Prisma where builder (no DB).
 */

import type { Prisma } from "@prisma/client";
import { isValidBdPhone, normalizePhone } from "./campaign.utils";

export type BookingListFilters = {
  campaignId: number;
  status?: string;
  cityCorporation?: string;
  area?: string;
  coverageZone?: string;
  bookingMode?: "VENUE" | "ZONE_INTEREST";
  dateFrom?: string;
  dateTo?: string;
  date?: string;
  ownerName?: string;
  phone?: string;
  reference?: string;
  paymentStatus?: string;
  petCountMin?: number;
  petCountMax?: number;
  locationId?: number;
  page?: number;
  pageSize?: number;
};

export type BookingListSummary = {
  totalBookings: number;
  totalPets: number;
  filteredBookings: number;
  filteredPets: number;
};

export function parseBookingListFilters(
  query: Record<string, unknown>,
  campaignId: number
): BookingListFilters {
  const page = query.page != null ? parseInt(String(query.page), 10) : 1;
  const pageSize = query.pageSize != null ? parseInt(String(query.pageSize), 10) : 20;

  const petCountMin =
    query.petCountMin != null && String(query.petCountMin).trim() !== ""
      ? parseInt(String(query.petCountMin), 10)
      : undefined;
  const petCountMax =
    query.petCountMax != null && String(query.petCountMax).trim() !== ""
      ? parseInt(String(query.petCountMax), 10)
      : undefined;

  const locationId =
    query.locationId != null && String(query.locationId).trim() !== ""
      ? parseInt(String(query.locationId), 10)
      : undefined;

  const bookingModeRaw = query.bookingMode ? String(query.bookingMode).toUpperCase() : undefined;
  const bookingMode =
    bookingModeRaw === "VENUE" || bookingModeRaw === "ZONE_INTEREST"
      ? bookingModeRaw
      : undefined;

  const cityCorporation = query.cityCorporation
    ? String(query.cityCorporation).trim().toUpperCase()
    : query.city
      ? String(query.city).trim().toUpperCase()
      : undefined;

  return {
    campaignId,
    status: query.status ? String(query.status) : undefined,
    cityCorporation: cityCorporation || undefined,
    area: query.area ? String(query.area).trim() : undefined,
    coverageZone: query.coverageZone ? String(query.coverageZone).trim() : undefined,
    bookingMode,
    dateFrom: query.dateFrom ? String(query.dateFrom) : undefined,
    dateTo: query.dateTo ? String(query.dateTo) : undefined,
    date: query.date ? String(query.date) : undefined,
    ownerName: query.ownerName ? String(query.ownerName).trim() : undefined,
    phone: query.phone
      ? (() => {
          const raw = String(query.phone).replace(/\s+/g, "");
          if (!raw) return undefined;
          if (isValidBdPhone(raw)) return normalizePhone(raw);
          return raw.replace(/\D/g, "").slice(-11) || undefined;
        })()
      : undefined,
    reference: query.reference ? String(query.reference).trim() : undefined,
    paymentStatus: query.paymentStatus ? String(query.paymentStatus) : undefined,
    petCountMin: Number.isFinite(petCountMin) ? petCountMin : undefined,
    petCountMax: Number.isFinite(petCountMax) ? petCountMax : undefined,
    locationId: Number.isFinite(locationId) ? locationId : undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 20,
  };
}

export function buildBookingListWhere(filters: BookingListFilters): Prisma.CampaignBookingWhereInput {
  const and: Prisma.CampaignBookingWhereInput[] = [{ campaignId: filters.campaignId }];

  if (filters.status) and.push({ status: filters.status as Prisma.EnumCampaignBookingStatusFilter });
  if (filters.bookingMode) and.push({ bookingMode: filters.bookingMode });
  if (filters.paymentStatus) {
    and.push({ paymentStatus: filters.paymentStatus as Prisma.EnumCampaignPaymentStatusFilter });
  }
  if (filters.locationId) and.push({ locationId: filters.locationId });

  if (filters.date) {
    and.push({ bookingDate: new Date(filters.date) });
  } else {
    if (filters.dateFrom) {
      and.push({ bookingDate: { gte: new Date(filters.dateFrom) } });
    }
    if (filters.dateTo) {
      const end = new Date(filters.dateTo);
      end.setHours(23, 59, 59, 999);
      and.push({ bookingDate: { lte: end } });
    }
  }

  if (filters.petCountMin != null || filters.petCountMax != null) {
    const petCount: Prisma.IntFilter = {};
    if (filters.petCountMin != null) petCount.gte = filters.petCountMin;
    if (filters.petCountMax != null) petCount.lte = filters.petCountMax;
    and.push({ petCount });
  }

  if (filters.ownerName) {
    and.push({ ownerName: { contains: filters.ownerName, mode: "insensitive" } });
  }

  if (filters.phone) {
    const phoneNeedle = isValidBdPhone(filters.phone)
      ? normalizePhone(filters.phone)
      : filters.phone.replace(/\D/g, "").slice(-11);
    if (phoneNeedle) {
      and.push({ ownerPhone: { contains: phoneNeedle } });
    }
  }

  if (filters.reference) {
    const ref = filters.reference.toUpperCase();
    and.push({
      OR: [
        { bookingRef: { equals: ref, mode: "insensitive" } },
        { bookingRef: { contains: ref, mode: "insensitive" } },
      ],
    });
  }

  if (filters.area) {
    and.push({
      OR: [
        { bookingArea: { equals: filters.area, mode: "insensitive" } },
        { bookingArea: { contains: filters.area, mode: "insensitive" } },
      ],
    });
  }

  if (filters.coverageZone) {
    and.push({
      OR: [
        { coverageZoneName: { contains: filters.coverageZone, mode: "insensitive" } },
        { coverageZone: { name: { contains: filters.coverageZone, mode: "insensitive" } } },
      ],
    });
  }

  if (filters.cityCorporation) {
    const code = filters.cityCorporation.toUpperCase();
    const corpOr: Prisma.CampaignBookingWhereInput[] = [
      {
        ownerAddressJson: {
          path: ["cityCorporationCode"],
          equals: code,
        },
      },
    ];
    if (code === "DSCC" || code === "DNCC") {
      corpOr.push({
        coverageZoneName: { contains: code, mode: "insensitive" },
      });
    }
    and.push({ OR: corpOr });
  }

  return and.length === 1 ? and[0] : { AND: and };
}
