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
import {
  resolveBookingLocationFields,
} from "./bookingLocationDisplay.util";
import {
  buildBookingListWhere,
  parseBookingListFilters,
  type BookingListFilters,
} from "./bookingListFilters.util";
import { BOOKING_LIST_INCLUDE } from "./bookingListFilters.service";

const BOOKING_EXPORT_MAX = 25_000;

export const BOOKING_EXPORT_HEADERS = [
  "reference",
  "booking_date",
  "owner_name",
  "phone",
  "pet_count",
  "city_corporation",
  "area",
  "location_label",
  "status",
  "payment_status",
  "assigned_staff",
  "notes",
  "slot_start",
  "slot_end",
  "paid_amount_bdt",
  "is_walk_in",
  "checked_in_at",
  "completed_at",
  "created_at",
] as const;

export type BookingExportFilters = Omit<
  BookingListFilters,
  "page" | "pageSize"
>;

function staffDisplayName(
  user: { profile?: { displayName?: string | null } | null } | null | undefined
): string {
  return user?.profile?.displayName?.trim() ?? "";
}

function bookingNotes(row: {
  cancelReason?: string | null;
  metadataJson?: unknown;
}): string {
  if (row.cancelReason?.trim()) return row.cancelReason.trim();
  const meta = row.metadataJson as Record<string, unknown> | null;
  if (typeof meta?.notes === "string" && meta.notes.trim()) return meta.notes.trim();
  return "";
}

export async function fetchBookingsForExport(
  campaignId: number,
  filters: BookingExportFilters
) {
  const where = buildBookingListWhere({ ...filters, campaignId });

  return prisma.campaignBooking.findMany({
    where,
    include: BOOKING_LIST_INCLUDE,
    orderBy: [{ bookingDate: "desc" }, { createdAt: "desc" }],
    take: BOOKING_EXPORT_MAX,
  });
}

export function bookingsToExportRows(
  items: Awaited<ReturnType<typeof fetchBookingsForExport>>
): Record<string, unknown>[] {
  return items.map((b) => {
    const loc = resolveBookingLocationFields(b);
    return {
      reference: b.bookingRef,
      booking_date: formatDate(b.bookingDate),
      owner_name: b.ownerName,
      phone: b.ownerPhone,
      pet_count: b.petCount,
      city_corporation: loc?.cityCorporation ?? "",
      area: loc?.area ?? b.bookingArea ?? "",
      location_label: loc?.locationLabel ?? b.location?.name ?? "",
      status: b.status,
      payment_status: b.paymentStatus,
      assigned_staff: staffDisplayName(b.checkedInBy),
      notes: bookingNotes(b),
      slot_start: b.slot?.startTime ?? "",
      slot_end: b.slot?.endTime ?? "",
      paid_amount_bdt: b.paidAmount != null ? Number(b.paidAmount) : "",
      is_walk_in: b.isWalkIn ? "true" : "false",
      checked_in_at: formatIso(b.checkedInAt),
      completed_at: formatIso(b.completedAt),
      created_at: formatIso(b.createdAt),
    };
  });
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

export function parseBookingExportQuery(
  query: Record<string, unknown>,
  campaignId: number
): { format: ExportFormat; filters: BookingExportFilters } {
  const parsed = parseBookingListFilters(query, campaignId);
  const { page: _p, pageSize: _s, ...filters } = parsed;
  return {
    format: parseExportFormat(query.format),
    filters,
  };
}
