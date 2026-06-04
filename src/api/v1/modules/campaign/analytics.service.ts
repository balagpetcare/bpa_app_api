/**
 * Campaign Analytics Service
 * Bookings by location/zone, payment analytics, revenue tracking
 */

import prisma from "../../../../infrastructure/db/prismaClient";

export async function getBookingsByLocation(campaignId: number) {
  const rows = await prisma.campaignBooking.groupBy({
    by: ["locationId"],
    where: {
      campaignId,
      status: { notIn: ["CANCELLED"] },
      locationId: { not: null },
    },
    _count: { id: true },
    _sum: { petCount: true, paidAmount: true },
  });

  const locations = await prisma.campaignLocation.findMany({
    where: { campaignId },
    select: { id: true, name: true, address: true, dailyCapacity: true },
  });
  const locMap = new Map(locations.map((l) => [l.id, l]));

  return rows
    .map((r) => {
      const loc = locMap.get(r.locationId);
      const revenue = Number(r._sum.paidAmount ?? 0);
      return {
        locationId: r.locationId,
        locationName: loc?.name ?? "Unknown",
        address: loc?.address ?? null,
        dailyCapacity: loc?.dailyCapacity ?? 0,
        totalBookings: r._count.id,
        totalCats: r._sum.petCount ?? 0,
        totalRevenue: Math.round(revenue * 100) / 100,
      };
    })
    .sort((a, b) => b.totalBookings - a.totalBookings);
}

export async function getRevenueByLocation(campaignId: number) {
  const byLocation = await getBookingsByLocation(campaignId);
  return byLocation
    .map((r) => ({
      locationId: r.locationId,
      locationName: r.locationName,
      totalBookings: r.totalBookings,
      totalCats: r.totalCats,
      totalRevenue: r.totalRevenue,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

export async function getBookingsByCoverageZone(campaignId: number) {
  const rows = await prisma.campaignBooking.groupBy({
    by: ["coverageZoneId"],
    where: {
      campaignId,
      status: { notIn: ["CANCELLED"] },
      coverageZoneId: { not: null },
    },
    _count: { id: true },
    _sum: { petCount: true, paidAmount: true },
  });

  const zoneIds = rows
    .map((r) => r.coverageZoneId)
    .filter((id): id is number => id != null);

  const zones =
    zoneIds.length > 0
      ? await prisma.coverageZone.findMany({
          where: { id: { in: zoneIds } },
          select: { id: true, name: true, slug: true, city: true, zoneType: true },
        })
      : [];
  const zoneMap = new Map(zones.map((z) => [z.id, z]));

  const areaBookings = await prisma.campaignBooking.findMany({
    where: {
      campaignId,
      status: { notIn: ["CANCELLED"] },
      coverageZoneId: null,
      bookingArea: { not: null },
    },
    select: { bookingArea: true, petCount: true, paidAmount: true },
  });

  const areaAgg = new Map<
    string,
    { bookings: number; cats: number; revenue: number }
  >();
  for (const b of areaBookings) {
    const key = b.bookingArea!.trim();
    if (!key) continue;
    const cur = areaAgg.get(key) ?? { bookings: 0, cats: 0, revenue: 0 };
    cur.bookings += 1;
    cur.cats += b.petCount ?? 0;
    cur.revenue += Number(b.paidAmount ?? 0);
    areaAgg.set(key, cur);
  }

  const fromZones = rows.map((r) => {
    const zone = zoneMap.get(r.coverageZoneId!);
    const revenue = Number(r._sum.paidAmount ?? 0);
    return {
      rowKey: `zone-${r.coverageZoneId}`,
      coverageZoneId: r.coverageZoneId,
      coverageZoneName: zone?.name ?? "Unknown zone",
      coverageZoneSlug: zone?.slug ?? null,
      city: zone?.city ?? null,
      zoneType: zone?.zoneType ?? null,
      bookingArea: null as string | null,
      totalBookings: r._count.id,
      totalCats: r._sum.petCount ?? 0,
      totalRevenue: Math.round(revenue * 100) / 100,
    };
  });

  const fromAreas = [...areaAgg.entries()].map(([bookingArea, agg]) => ({
    rowKey: `area-${bookingArea}`,
    coverageZoneId: null,
    coverageZoneName: null,
    coverageZoneSlug: null,
    city: null,
    zoneType: null,
    bookingArea,
    totalBookings: agg.bookings,
    totalCats: agg.cats,
    totalRevenue: Math.round(agg.revenue * 100) / 100,
  }));

  return [...fromZones, ...fromAreas].sort((a, b) => b.totalBookings - a.totalBookings);
}

export async function getPaymentAnalytics(campaignId: number) {
  const bookings = await prisma.campaignBooking.findMany({
    where: { campaignId, status: { notIn: ["CANCELLED"] } },
    select: {
      id: true,
      paymentStatus: true,
      paidAmount: true,
      petCount: true,
      isWalkIn: true,
    },
  });

  let onlinePayments = 0;
  let onlineRevenue = 0;
  let venuePayments = 0;
  let venueRevenue = 0;
  let pendingPayments = 0;
  let expectedRevenue = 0;
  let collectedRevenue = 0;

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { pricingType: true, priceAmount: true },
  });
  const unitPrice = campaign?.pricingType === "FREE" ? 0 : Number(campaign?.priceAmount ?? 0);

  for (const b of bookings) {
    const paid = Number(b.paidAmount ?? 0);
    const expected = unitPrice * (b.petCount ?? 1);
    expectedRevenue += expected;

    if (b.paymentStatus === "COMPLETED") {
      collectedRevenue += paid;
      if (b.isWalkIn) {
        venuePayments++;
        venueRevenue += paid;
      } else {
        onlinePayments++;
        onlineRevenue += paid;
      }
    } else if (b.paymentStatus === "PENDING") {
      pendingPayments++;
    }
  }

  const onlineRev = Math.round(onlineRevenue * 100) / 100;
  const venueRev = Math.round(venueRevenue * 100) / 100;
  const expectedRev = Math.round(expectedRevenue * 100) / 100;
  const collectedRev = Math.round(collectedRevenue * 100) / 100;

  return {
    onlinePayments,
    onlineRevenue: onlineRev,
    venuePayments,
    venueRevenue: venueRev,
    pendingPayments,
    expectedRevenue: expectedRev,
    collectedRevenue: collectedRev,
    revenue: collectedRev,
    totalBookings: bookings.length,
    paymentSplit: [
      { channel: "ONLINE", count: onlinePayments, amountBdt: onlineRev },
      { channel: "VENUE", count: venuePayments, amountBdt: venueRev },
      { channel: "PENDING", count: pendingPayments, amountBdt: 0 },
    ],
  };
}

export async function getTopCampaignLocations(campaignId: number, limit = 10) {
  const rows = await prisma.campaignBooking.groupBy({
    by: ["locationId"],
    where: {
      campaignId,
      status: { notIn: ["CANCELLED"] },
      locationId: { not: null },
    },
    _count: { id: true },
    _sum: { petCount: true, paidAmount: true },
    orderBy: { _count: { id: "desc" } },
    take: limit,
  });

  const locationIds = rows
    .map((r) => r.locationId)
    .filter((id): id is number => id != null);
  const locations = await prisma.campaignLocation.findMany({
    where: { id: { in: locationIds } },
    select: { id: true, name: true, address: true },
  });
  const locMap = new Map(locations.map((l) => [l.id, l]));

  const vaccinationCounts = await prisma.campaignPet.groupBy({
    by: ["bookingId"],
    where: {
      booking: { campaignId, locationId: { in: locationIds } },
      vaccinationStatus: "COMPLETED",
    },
    _count: { id: true },
  });

  const bookingLocationMap = new Map<number, number>();
  const bookingRows = await prisma.campaignBooking.findMany({
    where: { campaignId, locationId: { in: locationIds } },
    select: { id: true, locationId: true },
  });
  for (const br of bookingRows) bookingLocationMap.set(br.id, br.locationId);

  const vaccByLocation = new Map<number, number>();
  for (const vc of vaccinationCounts) {
    const locId = bookingLocationMap.get(vc.bookingId);
    if (locId) vaccByLocation.set(locId, (vaccByLocation.get(locId) ?? 0) + vc._count.id);
  }

  return rows.map((r, idx) => {
    const loc = locMap.get(r.locationId);
    const revenue = Number(r._sum.paidAmount ?? 0);
    return {
      rank: idx + 1,
      locationId: r.locationId,
      locationName: loc?.name ?? "Unknown",
      address: loc?.address ?? null,
      totalBookings: r._count.id,
      totalCats: r._sum.petCount ?? 0,
      totalRevenue: Math.round(revenue * 100) / 100,
      totalVaccinations: vaccByLocation.get(r.locationId) ?? 0,
    };
  });
}

export async function getBookingsByBdArea(campaignId: number) {
  const rows = await prisma.campaignBooking.groupBy({
    by: ["bdAreaId"],
    where: {
      campaignId,
      status: { notIn: ["CANCELLED"] },
      bdAreaId: { not: null },
    },
    _count: { id: true },
    _sum: { petCount: true, paidAmount: true },
  });

  const areaIds = rows
    .map((r) => r.bdAreaId)
    .filter((id): id is number => id != null);

  const areas =
    areaIds.length > 0
      ? await prisma.bdArea.findMany({
          where: { id: { in: areaIds } },
          select: { id: true, code: true, nameEn: true, nameBn: true },
        })
      : [];
  const areaMap = new Map(areas.map((a) => [a.id, a]));

  const zoneIds = await prisma.campaignBooking.findMany({
    where: { campaignId, bdAreaId: { in: areaIds }, coverageZoneId: { not: null } },
    select: { bdAreaId: true, coverageZoneId: true, coverageZoneName: true },
    distinct: ["bdAreaId"],
  });
  const zoneNameByArea = new Map(
    zoneIds.map((z) => [
      z.bdAreaId!,
      z.coverageZoneName ?? null,
    ])
  );

  return rows
    .map((r) => {
      const area = areaMap.get(r.bdAreaId!);
      const revenue = Number(r._sum.paidAmount ?? 0);
      return {
        bdAreaId: r.bdAreaId,
        areaCode: area?.code ?? null,
        areaName: area?.nameEn ?? area?.nameBn ?? "Unknown area",
        coverageZoneName: zoneNameByArea.get(r.bdAreaId!) ?? null,
        totalBookings: r._count.id,
        totalCats: r._sum.petCount ?? 0,
        totalRevenue: Math.round(revenue * 100) / 100,
      };
    })
    .sort((a, b) => b.totalBookings - a.totalBookings);
}

export async function getCampaignAnalyticsDashboard(campaignId: number) {
  const [
    bookingsByLocation,
    bookingsByCoverageZone,
    bookingsByBdArea,
    revenueByLocation,
    paymentAnalytics,
    topLocations,
  ] = await Promise.all([
    getBookingsByLocation(campaignId),
    getBookingsByCoverageZone(campaignId),
    getBookingsByBdArea(campaignId),
    getRevenueByLocation(campaignId),
    getPaymentAnalytics(campaignId),
    getTopCampaignLocations(campaignId),
  ]);

  const catsByZone = bookingsByCoverageZone
    .filter((z) => z.coverageZoneId != null)
    .map((z) => ({
      coverageZoneId: z.coverageZoneId,
      coverageZoneName: z.coverageZoneName,
      totalCats: z.totalCats,
    }));

  const revenueByZone = bookingsByCoverageZone
    .filter((z) => z.coverageZoneId != null)
    .map((z) => ({
      coverageZoneId: z.coverageZoneId,
      coverageZoneName: z.coverageZoneName,
      totalRevenue: z.totalRevenue,
    }));

  const catsByArea = bookingsByBdArea.map((a) => ({
    bdAreaId: a.bdAreaId,
    areaName: a.areaName,
    totalCats: a.totalCats,
  }));

  const revenueByArea = bookingsByBdArea.map((a) => ({
    bdAreaId: a.bdAreaId,
    areaName: a.areaName,
    totalRevenue: a.totalRevenue,
  }));

  return {
    bookingsByLocation,
    bookingsByCoverageZone,
    bookingsByBdArea,
    bookingsByArea: bookingsByBdArea,
    catsByZone,
    catsByArea,
    revenueByZone,
    revenueByArea,
    revenueByLocation,
    paymentAnalytics,
    topLocations,
    generatedAt: new Date().toISOString(),
  };
}
