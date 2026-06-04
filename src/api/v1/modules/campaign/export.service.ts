/**
 * Campaign export service — bookings and analytics (CSV / XLSX / PDF).
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { formatDate, formatIso } from "../../utils/csvExportHelper";
import {
  parseExportFormat,
  rowsToBuffer,
  exportFilename,
  type ExportFormat,
} from "../../utils/campaignExportFormats";
import {
  getBookingsByLocation,
  getBookingsByCoverageZone,
  getPaymentAnalytics,
} from "./analytics.service";

const BOOKING_EXPORT_MAX = 25_000;

export const BOOKING_EXPORT_HEADERS = [
  "booking_ref",
  "status",
  "owner_name",
  "owner_phone",
  "pet_count",
  "booking_date",
  "location_name",
  "slot_start",
  "slot_end",
  "payment_status",
  "paid_amount_bdt",
  "is_walk_in",
  "checked_in_at",
  "completed_at",
  "created_at",
] as const;

export type BookingExportFilters = {
  status?: string;
  date?: string;
  locationId?: number;
};

export async function fetchBookingsForExport(
  campaignId: number,
  filters: BookingExportFilters
) {
  const where: Record<string, unknown> = { campaignId };
  if (filters.status) where.status = filters.status;
  if (filters.date) where.bookingDate = new Date(filters.date);
  if (filters.locationId) where.locationId = filters.locationId;

  const items = await prisma.campaignBooking.findMany({
    where,
    include: {
      location: { select: { name: true } },
      slot: { select: { startTime: true, endTime: true } },
    },
    orderBy: [{ bookingDate: "desc" }, { createdAt: "desc" }],
    take: BOOKING_EXPORT_MAX,
  });

  return items;
}

export function bookingsToExportRows(
  items: Awaited<ReturnType<typeof fetchBookingsForExport>>
): Record<string, unknown>[] {
  return items.map((b) => ({
    booking_ref: b.bookingRef,
    status: b.status,
    owner_name: b.ownerName,
    owner_phone: b.ownerPhone,
    pet_count: b.petCount,
    booking_date: formatDate(b.bookingDate),
    location_name: b.location?.name ?? "",
    slot_start: b.slot?.startTime ?? "",
    slot_end: b.slot?.endTime ?? "",
    payment_status: b.paymentStatus,
    paid_amount_bdt: b.paidAmount != null ? Number(b.paidAmount) : "",
    is_walk_in: b.isWalkIn ? "true" : "false",
    checked_in_at: formatIso(b.checkedInAt),
    completed_at: formatIso(b.completedAt),
    created_at: formatIso(b.createdAt),
  }));
}

export async function buildBookingsExport(
  campaignId: number,
  format: ExportFormat,
  filters: BookingExportFilters
): Promise<{ buffer: Buffer; filename: string; rowCount: number }> {
  const items = await fetchBookingsForExport(campaignId, filters);
  const rows = bookingsToExportRows(items);
  const buffer = await rowsToBuffer(
    rows,
    [...BOOKING_EXPORT_HEADERS],
    format,
    "Bookings"
  );
  return {
    buffer,
    filename: exportFilename(`campaign_${campaignId}_bookings`, format),
    rowCount: rows.length,
  };
}

export async function buildAnalyticsExport(
  campaignId: number,
  format: ExportFormat
): Promise<{ buffer: Buffer; filename: string }> {
  const [byLocation, byZone, payments] = await Promise.all([
    getBookingsByLocation(campaignId),
    getBookingsByCoverageZone(campaignId),
    getPaymentAnalytics(campaignId),
  ]);

  const rows: Record<string, unknown>[] = [];

  rows.push({ section: "PAYMENT_SUMMARY", metric: "online_payments", value: payments.onlinePayments });
  rows.push({ section: "PAYMENT_SUMMARY", metric: "online_revenue_bdt", value: payments.onlineRevenue });
  rows.push({ section: "PAYMENT_SUMMARY", metric: "venue_payments", value: payments.venuePayments });
  rows.push({ section: "PAYMENT_SUMMARY", metric: "venue_revenue_bdt", value: payments.venueRevenue });
  rows.push({ section: "PAYMENT_SUMMARY", metric: "pending_payments", value: payments.pendingPayments });
  rows.push({ section: "PAYMENT_SUMMARY", metric: "expected_revenue_bdt", value: payments.expectedRevenue });
  rows.push({ section: "PAYMENT_SUMMARY", metric: "collected_revenue_bdt", value: payments.collectedRevenue });
  rows.push({ section: "PAYMENT_SUMMARY", metric: "revenue_bdt", value: payments.revenue });
  rows.push({ section: "PAYMENT_SUMMARY", metric: "total_bookings", value: payments.totalBookings });

  for (const split of payments.paymentSplit) {
    rows.push({
      section: "PAYMENT_SPLIT",
      metric: split.channel,
      value: split.count,
      extra: split.amountBdt,
    });
  }

  for (const loc of byLocation) {
    rows.push({
      section: "BOOKINGS_BY_LOCATION",
      metric: loc.locationName,
      value: loc.totalBookings,
      extra: loc.totalCats,
      detail: loc.address ?? "",
    });
  }

  for (const zone of byZone) {
    const label =
      zone.coverageZoneName ||
      (zone.bookingArea ? `Area: ${zone.bookingArea}` : "Unassigned");
    rows.push({
      section: "BOOKINGS_BY_COVERAGE_ZONE",
      metric: label,
      value: zone.totalBookings,
      extra: zone.totalCats,
      detail: [zone.city, zone.coverageZoneSlug].filter(Boolean).join(" · ") || "",
    });
  }

  const headers = ["section", "metric", "value", "extra", "detail"];
  const buffer = await rowsToBuffer(rows, headers, format, "Analytics");
  return {
    buffer,
    filename: exportFilename(`campaign_${campaignId}_analytics`, format),
  };
}

export function parseBookingExportQuery(query: Record<string, unknown>) {
  return {
    format: parseExportFormat(query.format),
    filters: {
      status: query.status ? String(query.status) : undefined,
      date: query.date ? String(query.date) : undefined,
      locationId: query.locationId
        ? parseInt(String(query.locationId), 10)
        : undefined,
    } as BookingExportFilters,
  };
}
