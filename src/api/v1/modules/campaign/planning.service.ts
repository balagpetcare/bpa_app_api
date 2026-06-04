/**
 * Campaign planning — zone/area demand from zone-interest + venue bookings (analytics only).
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import {
  getBookingsByCoverageZone,
  getBookingsByBdArea,
  getPaymentAnalytics,
} from "./analytics.service";

export async function getCampaignPlanningDashboard(campaignId: number) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      name: true,
      pricingType: true,
      priceAmount: true,
      startDate: true,
      endDate: true,
    },
  });

  const [zoneRows, areaRows, payment, pendingAssignment] = await Promise.all([
    getBookingsByCoverageZone(campaignId),
    getBookingsByBdArea(campaignId),
    getPaymentAnalytics(campaignId),
    prisma.campaignBooking.count({
      where: {
        campaignId,
        bookingMode: "ZONE_INTEREST",
        status: "PENDING_ASSIGNMENT",
      },
    }),
  ]);

  const unitPrice =
    campaign?.pricingType === "FREE" ? 0 : Number(campaign?.priceAmount ?? 0);

  const topZones = zoneRows
    .filter((z) => z.coverageZoneId != null)
    .slice(0, 15)
    .map((z, idx) => ({
      rank: idx + 1,
      coverageZoneId: z.coverageZoneId,
      coverageZoneName: z.coverageZoneName,
      totalBookings: z.totalBookings,
      totalCats: z.totalCats,
      totalRevenue: z.totalRevenue,
      expectedRevenue: Math.round(unitPrice * z.totalCats * 100) / 100,
    }));

  const topAreas = areaRows.slice(0, 20).map((a, idx) => ({
    rank: idx + 1,
    bdAreaId: a.bdAreaId,
    areaName: a.areaName,
    coverageZoneName: a.coverageZoneName,
    totalBookings: a.totalBookings,
    totalCats: a.totalCats,
    totalRevenue: a.totalRevenue,
    expectedRevenue: Math.round(unitPrice * a.totalCats * 100) / 100,
  }));

  const demandRanking = [...topZones, ...topAreas]
    .sort((a, b) => b.totalCats - a.totalCats)
    .slice(0, 25);

  return {
    campaign,
    pendingVenueAssignment: pendingAssignment,
    topZones,
    topAreas,
    demandRanking,
    zoneDemand: zoneRows,
    areaDemand: areaRows,
    bookingsByZone: zoneRows,
    bookingsByArea: areaRows,
    catsByZone: zoneRows.map((z) => ({
      coverageZoneId: z.coverageZoneId,
      coverageZoneName: z.coverageZoneName,
      totalCats: z.totalCats,
    })),
    catsByArea: areaRows.map((a) => ({
      bdAreaId: a.bdAreaId,
      areaName: a.areaName,
      totalCats: a.totalCats,
    })),
    revenueByZone: zoneRows.map((z) => ({
      coverageZoneId: z.coverageZoneId,
      coverageZoneName: z.coverageZoneName,
      totalRevenue: z.totalRevenue,
    })),
    revenueByArea: areaRows.map((a) => ({
      bdAreaId: a.bdAreaId,
      areaName: a.areaName,
      totalRevenue: a.totalRevenue,
    })),
    paymentSummary: payment,
    generatedAt: new Date().toISOString(),
  };
}
