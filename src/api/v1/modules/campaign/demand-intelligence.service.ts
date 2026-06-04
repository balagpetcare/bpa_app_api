/**
 * Vaccination Demand Forecasting & Rollout Planning — aggregation & recommendations.
 */

import { Prisma } from "@prisma/client";
import * as repo from "./demand-intelligence.repository";
import type {
  AiRecommendation,
  DemandIntelligenceReport,
  DemandPriority,
  DistrictRankingRow,
  DivisionRankingRow,
  ForecastConfidence,
  GeographicIntelligence,
  GeoRankRow,
  HeatmapPoint,
  UpazilaRankingRow,
} from "./demand-intelligence.types";

const FORECAST_DAYS = 30;
const BUFFER_PERCENT = 15;
const CATS_PER_VACCINATOR_PER_DAY = 40;
const CATS_PER_VOLUNTEER_PER_DAY = 80;
const DEFAULT_VACCINES_PER_CAT = 2;

type GeoBucket = {
  preRegistrations: number;
  preRegCats: number;
  bookingCount: number;
  bookingCats: number;
};

function parseAddressJson(raw: unknown): {
  division?: string;
  district?: string;
  area?: string;
  upazila?: string;
} {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? o[k] : undefined);
  return {
    division: str("division"),
    district: str("district"),
    area: str("area"),
    upazila: str("upazila"),
  };
}

function decimalToNumber(v: Prisma.Decimal | number | null | undefined): number | null {
  if (v == null) return null;
  return typeof v === "number" ? v : Number(v);
}

function normalizeScore(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((value / max) * 100));
}

function bucketKey(parts: { districtId?: number | null; upazilaId?: number | null; area?: string | null }) {
  return `${parts.districtId ?? 0}:${parts.upazilaId ?? 0}:${(parts.area ?? "").toLowerCase().trim()}`;
}

function addToBucket(bucket: GeoBucket, preReg: boolean, cats: number) {
  if (preReg) {
    bucket.preRegistrations += 1;
    bucket.preRegCats += cats;
  } else {
    bucket.bookingCount += 1;
    bucket.bookingCats += cats;
  }
}

function emptyBucket(): GeoBucket {
  return { preRegistrations: 0, preRegCats: 0, bookingCount: 0, bookingCats: 0 };
}

function priorityFromGap(gap: number): DemandPriority {
  if (gap > 500) return "high";
  if (gap > 100) return "medium";
  return "low";
}

function formatDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getDemandIntelligence(campaignId: number): Promise<DemandIntelligenceReport> {
  const campaign = await repo.findCampaignContext(campaignId);
  const pricePerCat =
    campaign.pricingType === "FREE" ? 0 : Number(campaign.priceAmount ?? 500);

  const [
    preRegs,
    bookings,
    vaccinatedCount,
    geoRef,
    locations,
    staff,
    vaccineInv,
    regions,
    locationBookingGroups,
    vaccinationTrendRows,
  ] = await Promise.all([
    repo.findPreRegistrations(campaignId),
    repo.findBookings(campaignId),
    repo.countVaccinatedPets(campaignId),
    repo.findGeoReference(),
    repo.findLocationsWithSlots(campaignId),
    repo.findStaffSummary(campaignId),
    repo.findVaccineInventory(campaignId),
    repo.findRolloutRegions(campaignId),
    repo.aggregateBookingsByLocation(campaignId),
    repo.findVaccinationTrendByDay(campaignId, new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)),
  ]);

  const divisionMap = new Map(geoRef.divisions.map((d) => [d.id, d]));
  const divisionCentroidMap = repo.deriveDivisionCentroids(geoRef.districts);
  const districtMap = new Map(geoRef.districts.map((d) => [d.id, d]));
  const upazilaMap = new Map(geoRef.upazilas.map((u) => [u.id, u]));
  const districtByName = new Map(geoRef.districts.map((d) => [d.nameEn.toLowerCase(), d]));
  const upazilaByName = new Map<string, (typeof geoRef.upazilas)[0][]>();
  for (const u of geoRef.upazilas) {
    const key = u.nameEn.toLowerCase();
    const list = upazilaByName.get(key) ?? [];
    list.push(u);
    upazilaByName.set(key, list);
  }

  const divisionDemand = new Map<number, GeoBucket>();
  const districtDemand = new Map<number, GeoBucket & { districtId: number }>();
  const upazilaDemand = new Map<number, GeoBucket & { upazilaId: number; districtId: number | null }>();
  const areaDemand = new Map<
    string,
    GeoBucket & { areaKey: string; districtId: number | null; upazilaId: number | null }
  >();

  for (const row of preRegs) {
    if (row.districtId) {
      const d = districtDemand.get(row.districtId) ?? { ...emptyBucket(), districtId: row.districtId };
      addToBucket(d, true, row.catCount);
      districtDemand.set(row.districtId, d);
      const dist = districtMap.get(row.districtId);
      if (dist?.divisionId) {
        const div = divisionDemand.get(dist.divisionId) ?? emptyBucket();
        addToBucket(div, true, row.catCount);
        divisionDemand.set(dist.divisionId, div);
      }
    }
    if (row.upazilaId) {
      const c = upazilaDemand.get(row.upazilaId) ?? {
        ...emptyBucket(),
        upazilaId: row.upazilaId,
        districtId: row.districtId,
      };
      addToBucket(c, true, row.catCount);
      upazilaDemand.set(row.upazilaId, c);
    }
  }

  for (const b of bookings) {
    const addr = parseAddressJson(b.ownerAddressJson);
    let districtId: number | null = null;
    let upazilaId: number | null = null;

    if (addr.district) {
      const match = districtByName.get(addr.district.toLowerCase());
      if (match) districtId = match.id;
    }
    const cityName = addr.upazila || addr.area;
    if (cityName) {
      const matches = upazilaByName.get(cityName.toLowerCase());
      if (matches?.length) {
        const u = districtId ? matches.find((x) => x.districtId === districtId) ?? matches[0] : matches[0];
        upazilaId = u.id;
        if (!districtId) districtId = u.districtId;
      }
    }

    if (districtId) {
      const d = districtDemand.get(districtId) ?? { ...emptyBucket(), districtId };
      addToBucket(d, false, b.petCount);
      districtDemand.set(districtId, d);
      const dist = districtMap.get(districtId);
      if (dist?.divisionId) {
        const div = divisionDemand.get(dist.divisionId) ?? emptyBucket();
        addToBucket(div, false, b.petCount);
        divisionDemand.set(dist.divisionId, div);
      }
    }
    if (upazilaId) {
      const c = upazilaDemand.get(upazilaId) ?? { ...emptyBucket(), upazilaId, districtId };
      addToBucket(c, false, b.petCount);
      upazilaDemand.set(upazilaId, c);
    }
    const areaLabel = (addr.area ?? "").trim();
    if (areaLabel) {
      const key = bucketKey({ districtId, upazilaId, area: areaLabel });
      const a = areaDemand.get(key) ?? {
        ...emptyBucket(),
        areaKey: areaLabel,
        districtId,
        upazilaId,
      };
      addToBucket(a, false, b.petCount);
      areaDemand.set(key, a);
    }
  }

  const mapRank = <T extends GeoBucket, R extends GeoRankRow>(
    rows: T[],
    maxCats: number,
    extra: (row: T, index: number) => Omit<R, keyof GeoRankRow>
  ): R[] =>
    rows
      .map((row) => ({
        ...row,
        totalCats: row.preRegCats + row.bookingCats,
        totalSignals: row.preRegistrations + row.bookingCount,
      }))
      .sort((a, b) => b.totalCats - a.totalCats)
      .map((row, index): R => {
        const totalCats = row.preRegCats + row.bookingCats;
        return {
          rank: index + 1,
          demandScore: normalizeScore(totalCats, maxCats),
          preRegistrations: row.preRegistrations,
          preRegCats: row.preRegCats,
          bookingCount: row.bookingCount,
          bookingCats: row.bookingCats,
          totalCats,
          totalSignals: row.preRegistrations + row.bookingCount,
          ...extra(row, index),
        } as R;
      });

  const districtRowsRaw = [...districtDemand.values()];
  const maxDistrictCats = Math.max(1, ...districtRowsRaw.map((r) => r.preRegCats + r.bookingCats));
  const districtRanking: DistrictRankingRow[] = mapRank(districtRowsRaw, maxDistrictCats, (row) => {
    const d = districtMap.get(row.districtId);
    const div = d?.divisionId ? divisionMap.get(d.divisionId) : null;
    return {
      districtId: row.districtId,
      districtName: d?.nameEn ?? "Unknown",
      divisionId: d?.divisionId ?? null,
      divisionName: div?.nameEn ?? null,
    };
  });

  const divisionRowsRaw = [...divisionDemand.entries()].map(([divisionId, bucket]) => ({
    divisionId,
    ...bucket,
  }));
  const maxDivisionCats = Math.max(1, ...divisionRowsRaw.map((r) => r.preRegCats + r.bookingCats));
  const divisionRanking: DivisionRankingRow[] = mapRank(divisionRowsRaw, maxDivisionCats, (row) => ({
    divisionId: row.divisionId,
    divisionName: divisionMap.get(row.divisionId)?.nameEn ?? "Unknown",
  }));

  const upazilaRowsRaw = [...upazilaDemand.values()];
  const maxUpazilaCats = Math.max(1, ...upazilaRowsRaw.map((r) => r.preRegCats + r.bookingCats));
  const upazilaRanking: UpazilaRankingRow[] = mapRank(upazilaRowsRaw, maxUpazilaCats, (row) => {
    const u = upazilaMap.get(row.upazilaId);
    const d = u?.districtId ? districtMap.get(u.districtId) : null;
    return {
      upazilaId: row.upazilaId,
      upazilaName: u?.nameEn ?? "Unknown",
      districtId: u?.districtId ?? null,
      districtName: d?.nameEn ?? null,
    };
  });

  const areaRowsRaw = [...areaDemand.values()];
  const maxAreaCats = Math.max(1, ...areaRowsRaw.map((r) => r.preRegCats + r.bookingCats));
  const topAreas: GeographicIntelligence["topAreas"] = areaRowsRaw
    .map((row) => ({
      ...row,
      totalCats: row.preRegCats + row.bookingCats,
    }))
    .sort((a, b) => b.totalCats - a.totalCats)
    .slice(0, 25)
    .map((row, index) => ({
      rank: index + 1,
      demandScore: normalizeScore(row.totalCats, maxAreaCats),
      areaName: row.areaKey,
      districtName: row.districtId ? districtMap.get(row.districtId)?.nameEn ?? null : null,
      upazilaName: row.upazilaId ? upazilaMap.get(row.upazilaId)?.nameEn ?? null : null,
      totalCats: row.totalCats,
    }));

  const bookingByLocation = new Map(
    locationBookingGroups
      .filter((g) => g.locationId != null)
      .map((g) => [g.locationId!, { count: g._count.id, cats: g._sum.petCount ?? 0 }])
  );

  const locationRows = locations.map((loc) => {
    const slotCapacity = loc.slots.reduce((s, sl) => s + sl.capacity, 0);
    const slotBooked = loc.slots.reduce((s, sl) => s + sl.bookedCount, 0);
    const bk = bookingByLocation.get(loc.id);
    const bookingCats = bk?.cats ?? 0;
    const bookingCount = bk?.count ?? 0;
    const totalCats = bookingCats;
    return {
      locationId: loc.id,
      locationName: loc.name,
      dailyCapacity: loc.dailyCapacity,
      slotCapacity,
      slotBooked,
      isActive: loc.isActive,
      preRegistrations: 0,
      preRegCats: 0,
      bookingCount,
      bookingCats,
      totalCats,
      totalSignals: bookingCount,
      utilizationPercent:
        slotCapacity > 0 ? Math.min(100, Math.round((slotBooked / slotCapacity) * 100)) : 0,
    };
  });
  const maxLocCats = Math.max(1, ...locationRows.map((r) => r.totalCats));
  const locationRanking = locationRows
    .sort((a, b) => b.totalCats - a.totalCats)
    .map((row, index) => ({
      rank: index + 1,
      demandScore: normalizeScore(row.totalCats, maxLocCats),
      ...row,
    }));

  const heatmapDivision: HeatmapPoint[] = divisionRanking.map((d) => {
    const centroid = divisionCentroidMap.get(d.divisionId);
    return {
      level: "division" as const,
      id: d.divisionId,
      name: d.divisionName,
      latitude: centroid?.latitude ?? null,
      longitude: centroid?.longitude ?? null,
      demandScore: d.demandScore,
      totalCats: d.totalCats,
      preRegCats: d.preRegCats,
      bookingCats: d.bookingCats,
    };
  });

  const heatmapDistrict: HeatmapPoint[] = districtRanking.map((d) => {
    const geo = districtMap.get(d.districtId);
    return {
      level: "district" as const,
      id: d.districtId,
      name: d.districtName,
      divisionName: d.divisionName,
      latitude: decimalToNumber(geo?.latitude ?? null),
      longitude: decimalToNumber(geo?.longitude ?? null),
      demandScore: d.demandScore,
      totalCats: d.totalCats,
      preRegCats: d.preRegCats,
      bookingCats: d.bookingCats,
    };
  });

  const heatmapUpazila: HeatmapPoint[] = upazilaRanking.slice(0, 40).map((c) => {
    const geo = upazilaMap.get(c.upazilaId);
    return {
      level: "upazila" as const,
      id: c.upazilaId,
      name: c.upazilaName,
      districtName: c.districtName,
      latitude: decimalToNumber(geo?.latitude ?? null),
      longitude: decimalToNumber(geo?.longitude ?? null),
      demandScore: c.demandScore,
      totalCats: c.totalCats,
    };
  });

  const heatmapArea: HeatmapPoint[] = topAreas.slice(0, 20).map((a, i) => ({
    level: "area" as const,
    id: i,
    name: a.areaName,
    districtName: a.districtName,
    demandScore: a.demandScore,
    totalCats: a.totalCats,
    latitude: null,
    longitude: null,
  }));

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const preRegCatsLast7 = preRegs.filter((p) => p.createdAt >= weekAgo).reduce((s, p) => s + p.catCount, 0);
  const bookingsLast7 = bookings.filter((b) => b.createdAt >= weekAgo);
  const bookingCatsLast7 = bookingsLast7.reduce((s, b) => s + b.petCount, 0);
  const totalPreRegCats = preRegs.reduce((s, p) => s + p.catCount, 0);
  const totalBookingCats = bookings.reduce((s, b) => s + b.petCount, 0);
  const currentDemandCats = totalPreRegCats + totalBookingCats;
  const weeklyVelocityCats = preRegCatsLast7 + bookingCatsLast7;
  const projectedAdditional = Math.round((weeklyVelocityCats / 7) * FORECAST_DAYS);
  const projectedDemand = currentDemandCats + projectedAdditional;
  const projectedRevenue = projectedDemand * pricePerCat;
  const conversionRate =
    currentDemandCats > 0 ? Math.round((totalBookingCats / currentDemandCats) * 1000) / 10 : 0;

  const confidence: ForecastConfidence =
    weeklyVelocityCats > 50 ? "high" : weeklyVelocityCats > 0 ? "medium" : "low";

  const executiveSummary = {
    totalPreRegistrations: preRegs.length,
    totalPreRegCats,
    totalBookings: bookings.length,
    totalBookingCats,
    totalVaccinated: vaccinatedCount,
    conversionRate,
    currentDemandCats,
    projectedDemand,
    projectedRevenue,
    horizonDays: FORECAST_DAYS,
    weeklyVelocityCats,
    forecast: {
      horizonDays: FORECAST_DAYS,
      currentDemandCats,
      vaccinatedToDate: vaccinatedCount,
      weeklyPreRegCats: preRegCatsLast7,
      weeklyBookingCats: bookingCatsLast7,
      projectedNewDemandCats: projectedAdditional,
      projectedTotalDemandCats: projectedDemand,
      projectedVaccinations: vaccinatedCount + Math.round(projectedDemand * 0.85),
      confidence,
    },
  };

  const vaccinesPerCat = Math.max(1, vaccineInv.included.length || DEFAULT_VACCINES_PER_CAT);
  const requiredQuantity = projectedDemand * vaccinesPerCat;
  const bufferQuantity = Math.ceil(requiredQuantity * (BUFFER_PERCENT / 100));
  const totalWithBuffer = requiredQuantity + bufferQuantity;

  let availableInventory = 0;
  let hasInventoryData = false;
  for (const vt of vaccineInv.typed) {
    if (vt.allocatedDoses != null) {
      hasInventoryData = true;
      availableInventory += Math.max(0, vt.allocatedDoses - vt.usedDoses);
    }
  }
  if (!hasInventoryData && vaccineInv.included.length > 0) {
    availableInventory = Math.max(0, Math.round(projectedDemand * vaccinesPerCat * 1.2));
  }

  const netShortage = Math.max(0, totalWithBuffer - availableInventory);
  const byVaccine = (vaccineInv.included.length ? vaccineInv.included : [{ id: 0, name: "Campaign vaccines" }]).map(
    (v, idx) => {
      const dosesPerCat = 1;
      const projectedDoses = projectedDemand * dosesPerCat;
      const bufferDoses = Math.ceil(projectedDoses * (BUFFER_PERCENT / 100));
      const totalRequired = projectedDoses + bufferDoses;
      const typed = vaccineInv.typed[idx];
      const allocated = typed?.allocatedDoses ?? null;
      const used = typed?.usedDoses ?? 0;
      const available = allocated != null ? Math.max(0, allocated - used) : null;
      const shortage = available != null ? Math.max(0, totalRequired - available) : 0;
      return {
        vaccineId: v.id,
        name: v.name,
        dosesPerCat,
        projectedDoses,
        bufferDoses,
        totalRequired,
        allocatedDoses: allocated,
        usedDoses: used,
        availableInventory: available,
        shortage,
        hasShortage: shortage > 0,
      };
    }
  );

  const vaccineForecast = {
    vaccinesPerCat,
    requiredQuantity,
    bufferPercent: BUFFER_PERCENT,
    bufferQuantity,
    totalWithBuffer,
    availableInventory,
    netShortage,
    hasShortageWarning: netShortage > 0,
    byVaccine,
  };

  const vaccinators = staff.filter((s) => s.role === "VACCINATOR").length;
  const volunteers = staff.filter((s) => s.role === "SUPPORT" || s.role === "CHECK_IN").length;
  const coordinators = staff.filter((s) => s.role === "COORDINATOR" || s.role === "ADMIN").length;

  const existingSlots = locations.reduce((s, l) => s + l.slots.length, 0);
  const openSlotCapacity = locations.reduce(
    (s, l) => s + l.slots.filter((sl) => sl.status === "OPEN" || sl.status === "FULL").reduce((a, sl) => a + sl.capacity, 0),
    0
  );
  const catsPerDayCapacity = locations.reduce((s, l) => s + l.dailyCapacity, 0) || openSlotCapacity || 100;
  const requiredSlots = Math.ceil(projectedDemand / Math.max(1, Math.round(catsPerDayCapacity / 3)));
  const recommendedDoctors = Math.max(
    vaccinators,
    Math.ceil(projectedDemand / (CATS_PER_VACCINATOR_PER_DAY * Math.max(1, executiveSummary.forecast.horizonDays / 7)))
  );
  const recommendedVolunteers = Math.max(
    volunteers,
    Math.ceil(projectedDemand / (CATS_PER_VOLUNTEER_PER_DAY * Math.max(1, executiveSummary.forecast.horizonDays / 7)))
  );
  const recommendedCoordinators = Math.max(coordinators, Math.ceil(locations.length / 3));

  const slotByDate = new Map<string, { capacity: number; booked: number; count: number }>();
  for (const loc of locations) {
    for (const sl of loc.slots) {
      const key = formatDateKey(sl.date);
      const cur = slotByDate.get(key) ?? { capacity: 0, booked: 0, count: 0 };
      cur.capacity += sl.capacity;
      cur.booked += sl.bookedCount;
      cur.count += 1;
      slotByDate.set(key, cur);
    }
  }
  const dailyCapacityAnalysis = [...slotByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-21)
    .map(([date, v]) => ({
      date,
      slotCount: v.count,
      totalCapacity: v.capacity,
      booked: v.booked,
      utilizationPercent: v.capacity > 0 ? Math.round((v.booked / v.capacity) * 100) : 0,
    }));

  const campaignDays = Math.max(
    1,
    Math.ceil((campaign.endDate.getTime() - campaign.startDate.getTime()) / (24 * 60 * 60 * 1000))
  );
  const estimatedWorkingDays = Math.min(campaignDays, Math.ceil(projectedDemand / Math.max(1, catsPerDayCapacity)));

  const capacityByDistrict = districtRanking.slice(0, 25).map((d) => {
    const activeRegion = regions.find((r) => r.districtId === d.districtId && r.isActive);
    const plannedRegion = regions.find((r) => r.districtId === d.districtId);
    const currentCapacity = activeRegion?.targetCapacity ?? plannedRegion?.targetCapacity ?? 0;
    const recommendedCapacity = Math.max(currentCapacity, Math.ceil(d.totalCats * 1.25), 100);
    const capacityGap = Math.max(0, d.totalCats - currentCapacity);
    return {
      districtId: d.districtId,
      districtName: d.districtName,
      totalDemandCats: d.totalCats,
      currentCapacity,
      recommendedCapacity,
      capacityGap,
      priority: priorityFromGap(capacityGap),
      hasActiveRegion: Boolean(activeRegion),
    };
  });

  const resourcePlanning = {
    recommendedDoctors,
    recommendedVolunteers,
    recommendedCoordinators,
    currentStaff: {
      vaccinators,
      support: volunteers,
      coordinators,
      total: staff.length,
    },
    requiredSlots,
    existingSlots,
    openSlotCapacity,
    estimatedWorkingDays,
    catsPerDayCapacity,
    dailyCapacityAnalysis,
    capacityByDistrict,
  };

  const recommendations: AiRecommendation[] = [];

  for (const d of districtRanking.filter((r) => r.demandScore >= 70).slice(0, 5)) {
    const cap = capacityByDistrict.find((c) => c.districtId === d.districtId);
    if (cap && !cap.hasActiveRegion) {
      recommendations.push({
        id: `rollout-${d.districtId}`,
        category: "rollout",
        priority: cap.priority === "high" ? "high" : "medium",
        title: `Activate rollout in ${d.districtName}`,
        detail: `${d.totalCats} cats in demand signals; region not yet active.`,
        actionHint: "Open Rollout → add or activate region",
      });
    }
  }

  if (vaccineForecast.hasShortageWarning) {
    recommendations.push({
      id: "procurement-shortage",
      category: "procurement",
      priority: netShortage > 500 ? "critical" : "high",
      title: "Vaccine procurement required",
      detail: `Projected need ${totalWithBuffer.toLocaleString()} doses (incl. ${BUFFER_PERCENT}% buffer); available ~${availableInventory.toLocaleString()}. Shortage ~${netShortage.toLocaleString()}.`,
      actionHint: "Update CampaignVaccineType allocated doses",
    });
  }

  if (recommendedDoctors > vaccinators) {
    recommendations.push({
      id: "staff-vaccinators",
      category: "staffing",
      priority: "medium",
      title: "Increase vaccinator staffing",
      detail: `Recommend ${recommendedDoctors} vaccinators for projected load; ${vaccinators} currently assigned.`,
      actionHint: "Campaign → Staff assignments",
    });
  }

  if (requiredSlots > existingSlots) {
    recommendations.push({
      id: "capacity-slots",
      category: "capacity",
      priority: "medium",
      title: "Expand appointment slots",
      detail: `~${requiredSlots} slots recommended vs ${existingSlots} existing (${openSlotCapacity} open capacity).`,
      actionHint: "Campaign → Slots → bulk create",
    });
  }

  const trendMap = new Map<
    string,
    { preRegistrations: number; preRegCats: number; bookings: number; bookingCats: number; vaccinations: number }
  >();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    trendMap.set(formatDateKey(d), {
      preRegistrations: 0,
      preRegCats: 0,
      bookings: 0,
      bookingCats: 0,
      vaccinations: 0,
    });
  }
  for (const p of preRegs) {
    const key = formatDateKey(p.createdAt);
    const t = trendMap.get(key);
    if (t) {
      t.preRegistrations += 1;
      t.preRegCats += p.catCount;
    }
  }
  for (const b of bookings) {
    const key = formatDateKey(b.createdAt);
    const t = trendMap.get(key);
    if (t) {
      t.bookings += 1;
      t.bookingCats += b.petCount;
    }
  }
  for (const v of vaccinationTrendRows) {
    const key = formatDateKey(v.updatedAt);
    const t = trendMap.get(key);
    if (t) t.vaccinations += 1;
  }

  const charts = {
    demandTrend: [...trendMap.entries()].map(([date, v]) => ({ date, ...v })),
    districtComparison: districtRanking.slice(0, 12).map((d) => ({
      name: d.districtName,
      totalCats: d.totalCats,
      demandScore: d.demandScore,
    })),
    vaccineDemand: byVaccine.map((v) => ({
      name: v.name,
      totalRequired: v.totalRequired,
      available: v.availableInventory ?? 0,
    })),
    capacityUtilization: dailyCapacityAnalysis.map((d) => ({
      date: d.date,
      capacity: d.totalCapacity,
      booked: d.booked,
      utilization: d.utilizationPercent,
    })),
  };

  const generatedAt = now.toISOString();

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      pricingType: campaign.pricingType,
      pricePerCat,
      currency: campaign.currency ?? "BDT",
      targetVaccinations: campaign.targetVaccinations,
      startDate: campaign.startDate.toISOString(),
      endDate: campaign.endDate.toISOString(),
    },
    generatedAt,
    executiveSummary,
    geographic: {
      divisionRanking,
      districtRanking,
      upazilaRanking,
      locationRanking,
      topAreas,
      heatmap: {
        division: heatmapDivision,
        district: heatmapDistrict,
        upazila: heatmapUpazila,
        area: heatmapArea,
      },
    },
    vaccineForecast,
    resourcePlanning,
    recommendations,
    charts,
    summary: {
      topRequestedAreas: topAreas.slice(0, 10),
      topRequestedDistricts: districtRanking.slice(0, 10).map((d) => ({
        rank: d.rank,
        districtName: d.districtName,
        totalCats: d.totalCats,
        demandScore: d.demandScore,
      })),
      projectedVaccineDemand: projectedDemand,
      projectedRevenue,
      totalPreRegistrations: preRegs.length,
      totalBookings: bookings.length,
      currentDemandCats,
    },
    heatmap: {
      division: heatmapDivision,
      district: heatmapDistrict,
      upazila: heatmapUpazila,
      area: heatmapArea,
      city: heatmapUpazila,
    },
    districtRanking,
    vaccinationForecast: executiveSummary.forecast,
    capacityRecommendations: capacityByDistrict,
    tracking: {
      districtDemand: districtRanking,
      cityDemand: upazilaRanking,
      areaDemand: topAreas,
    },
  };
}
