/**
 * Campaign discovery — upcoming campaigns, locator search, schedule views.
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { Prisma } from "@prisma/client";
import {
  addDays,
  endOfDay,
  formatDate,
  startOfDay,
} from "./campaign.utils";
import { checkAreaActive, resolveCampaignId } from "./rollout.service";

export type DiscoveryWindow = "today" | "this_week" | "this_month";

function getWindowRange(window: DiscoveryWindow): { start: Date; end: Date } {
  const start = startOfDay(new Date());
  if (window === "today") {
    return { start, end: endOfDay(new Date()) };
  }
  if (window === "this_week") {
    return { start, end: endOfDay(addDays(start, 6)) };
  }
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function decimalToNumber(v: Prisma.Decimal | number | null | undefined): number | null {
  if (v == null) return null;
  return typeof v === "number" ? v : Number(v);
}

function parseAddressJson(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

async function resolveGeoFromSearch(input: {
  divisionId?: number;
  districtId?: number;
  district?: string;
  city?: string;
  area?: string;
  upazilaId?: number;
  postalCode?: string;
}) {
  let divisionId = input.divisionId;
  let districtId = input.districtId;
  let upazilaId = input.upazilaId;
  let refLat: number | null = null;
  let refLng: number | null = null;

  if (!districtId && input.district?.trim()) {
    const d = await prisma.bdDistrict.findFirst({
      where: { nameEn: { contains: input.district.trim(), mode: "insensitive" } },
      include: { division: true },
    });
    if (d) {
      districtId = d.id;
      divisionId = divisionId ?? d.divisionId;
      refLat = decimalToNumber(d.latitude);
      refLng = decimalToNumber(d.longitude);
    }
  }

  if (districtId && !divisionId) {
    const d = await prisma.bdDistrict.findUnique({ where: { id: districtId } });
    if (d) {
      divisionId = d.divisionId;
      refLat = refLat ?? decimalToNumber(d.latitude);
      refLng = refLng ?? decimalToNumber(d.longitude);
    }
  }

  if (!upazilaId && input.city?.trim()) {
    const u = await prisma.bdUpazila.findFirst({
      where: {
        nameEn: { contains: input.city.trim(), mode: "insensitive" },
        ...(districtId ? { districtId } : {}),
      },
    });
    if (u) {
      upazilaId = u.id;
      districtId = districtId ?? u.districtId;
      refLat = refLat ?? decimalToNumber(u.latitude);
      refLng = refLng ?? decimalToNumber(u.longitude);
    }
  }

  if (upazilaId) {
    const u = await prisma.bdUpazila.findUnique({ where: { id: upazilaId } });
    if (u) {
      districtId = districtId ?? u.districtId;
      refLat = refLat ?? decimalToNumber(u.latitude);
      refLng = refLng ?? decimalToNumber(u.longitude);
    }
  }

  if (input.area?.trim() && districtId) {
    const a = await prisma.bdArea.findFirst({
      where: {
        nameEn: { contains: input.area.trim(), mode: "insensitive" },
        OR: [{ districtId }, { upazilaId: upazilaId ?? undefined }],
      },
    });
    if (a) {
      refLat = refLat ?? decimalToNumber(a.latitude);
      refLng = refLng ?? decimalToNumber(a.longitude);
    }
  }

  return { divisionId, districtId, upazilaId, refLat, refLng, postalCode: input.postalCode?.trim() };
}

async function findNextSlotForLocation(locationId: number, from: Date, to: Date) {
  const inWindow = await prisma.campaignSlot.findMany({
    where: {
      locationId,
      date: { gte: startOfDay(from), lte: startOfDay(to) },
      status: "OPEN",
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
  const open = inWindow.find((s) => s.bookedCount < s.capacity);
  if (open) return open;

  const future = await prisma.campaignSlot.findMany({
    where: {
      locationId,
      date: { gte: startOfDay(from) },
      status: "OPEN",
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: 20,
  });
  return future.find((s) => s.bookedCount < s.capacity) ?? null;
}

async function countRemainingCapacity(locationId: number, from: Date, to: Date) {
  const slots = await prisma.campaignSlot.findMany({
    where: {
      locationId,
      date: { gte: startOfDay(from), lte: startOfDay(to) },
      status: "OPEN",
    },
  });
  return slots.reduce((sum, s) => sum + Math.max(0, s.capacity - s.bookedCount), 0);
}

export async function getUpcomingCampaigns(
  window: DiscoveryWindow,
  opts?: { campaignId?: number; campaignSlug?: string }
) {
  const { start, end } = getWindowRange(window);
  const now = new Date();

  const where: Prisma.CampaignWhereInput = {
    status: "ACTIVE",
    visibility: "PUBLIC",
    endDate: { gte: start },
    startDate: { lte: end },
  };

  if (opts?.campaignId) where.id = opts.campaignId;
  if (opts?.campaignSlug) where.slug = opts.campaignSlug;

  const campaigns = await prisma.campaign.findMany({
    where,
    orderBy: { startDate: "asc" },
    include: {
      locations: { where: { isActive: true }, select: { id: true } },
    },
  });

  const results = await Promise.all(
    campaigns.map(async (c) => {
      const locationIds = c.locations.map((l) => l.id);
      let nextSlotDate: string | null = null;
      let nextSlotStartTime: string | null = null;
      let availableSlots = 0;
      let remainingCapacity = 0;

      if (locationIds.length > 0) {
        const slots = await prisma.campaignSlot.findMany({
          where: {
            locationId: { in: locationIds },
            date: { gte: startOfDay(start), lte: startOfDay(end) },
            status: "OPEN",
          },
          orderBy: [{ date: "asc" }, { startTime: "asc" }],
        });

        const openSlots = slots.filter((s) => s.bookedCount < s.capacity);
        availableSlots = openSlots.length;
        remainingCapacity = openSlots.reduce(
          (sum, s) => sum + Math.max(0, s.capacity - s.bookedCount),
          0
        );

        const next = openSlots[0];
        if (next) {
          nextSlotDate = formatDate(next.date);
          nextSlotStartTime = next.startTime;
        } else if (c.startDate > now) {
          nextSlotDate = formatDate(c.startDate);
        }
      } else if (c.startDate >= start && c.startDate <= end) {
        nextSlotDate = formatDate(c.startDate);
      }

      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        startDate: c.startDate,
        endDate: c.endDate,
        pricingType: c.pricingType,
        priceAmount: c.priceAmount,
        locationCount: locationIds.length,
        nextSlotDate,
        nextSlotStartTime,
        availableSlots,
        remainingCapacity,
        hasActivityInWindow: availableSlots > 0 || (c.startDate >= start && c.startDate <= end),
      };
    })
  );

  return results
    .filter((r) => r.hasActivityInWindow || r.locationCount > 0)
    .sort((a, b) => {
      if (!a.nextSlotDate) return 1;
      if (!b.nextSlotDate) return -1;
      return a.nextSlotDate.localeCompare(b.nextSlotDate);
    });
}

export async function searchCampaignLocator(input: {
  campaignId?: number;
  campaignSlug?: string;
  divisionId?: number;
  districtId?: number;
  district?: string;
  city?: string;
  area?: string;
  postalCode?: string;
  upazilaId?: number;
}) {
  const campaignId = await resolveCampaignId({
    campaignId: input.campaignId,
    campaignSlug: input.campaignSlug,
  });

  const geo = await resolveGeoFromSearch(input);
  const { start, end } = getWindowRange("this_month");
  const matches: Array<Record<string, unknown>> = [];

  const locationWhere: Prisma.CampaignLocationWhereInput = {
    campaignId,
    isActive: true,
  };

  const orFilters: Prisma.CampaignLocationWhereInput[] = [];

  if (geo.postalCode) {
    orFilters.push({ address: { contains: geo.postalCode, mode: "insensitive" } });
  }

  if (input.city?.trim()) {
    orFilters.push({
      OR: [
        { address: { contains: input.city.trim(), mode: "insensitive" } },
        { name: { contains: input.city.trim(), mode: "insensitive" } },
      ],
    });
  }

  if (input.area?.trim()) {
    orFilters.push({ address: { contains: input.area.trim(), mode: "insensitive" } });
  }

  if (input.district?.trim() && !geo.districtId) {
    orFilters.push({ address: { contains: input.district.trim(), mode: "insensitive" } });
  }

  const locations = await prisma.campaignLocation.findMany({
    where:
      orFilters.length > 0
        ? { ...locationWhere, OR: orFilters }
        : locationWhere,
    include: {
      campaign: { select: { id: true, name: true, slug: true } },
    },
  });

  const regionWhere: Prisma.CampaignRolloutRegionWhereInput = {
    campaignId,
    isActive: true,
    ...(geo.divisionId ? { divisionId: geo.divisionId } : {}),
    ...(geo.districtId
      ? { OR: [{ districtId: geo.districtId }, { districtId: null }] }
      : {}),
    ...(geo.upazilaId
      ? { OR: [{ upazilaId: geo.upazilaId }, { upazilaId: null }] }
      : {}),
  };

  const regions = await prisma.campaignRolloutRegion.findMany({
    where: regionWhere,
    include: {
      campaign: { select: { id: true, name: true, slug: true } },
      location: true,
    },
  });

  const seen = new Set<string>();

  for (const loc of locations) {
    const addr = parseAddressJson(loc.addressJson);
    if (geo.districtId && addr.district) {
      const d = await prisma.bdDistrict.findFirst({
        where: { id: geo.districtId, nameEn: { contains: addr.district, mode: "insensitive" } },
      });
      if (!d && addr.district) {
        /* still include if text search matched */
      }
    }

    const key = `loc-${loc.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const nextSlot = await findNextSlotForLocation(loc.id, start, end);
    const remainingCapacity = await countRemainingCapacity(loc.id, start, end);
    const locSlots = await prisma.campaignSlot.findMany({
      where: {
        locationId: loc.id,
        date: { gte: startOfDay(start), lte: startOfDay(end) },
        status: "OPEN",
      },
    });
    const slotCount = locSlots.filter((s) => s.bookedCount < s.capacity).length;

    let distanceKm: number | null = null;
    if (geo.refLat != null && geo.refLng != null && loc.latitude != null && loc.longitude != null) {
      distanceKm = Math.round(haversineKm(geo.refLat, geo.refLng, loc.latitude, loc.longitude) * 10) / 10;
    }

    matches.push({
      type: "location",
      campaignId: loc.campaign.id,
      campaignName: loc.campaign.name,
      campaignSlug: loc.campaign.slug,
      locationId: loc.id,
      locationName: loc.name,
      address: loc.address,
      city: addr.city || addr.upazila || input.city,
      district: addr.district || input.district,
      area: addr.area || input.area,
      latitude: loc.latitude,
      longitude: loc.longitude,
      distanceKm,
      nextSlotDate: nextSlot ? formatDate(nextSlot.date) : null,
      nextSlotStartTime: nextSlot?.startTime ?? null,
      availableSlots: slotCount,
      remainingCapacity,
    });
  }

  for (const region of regions) {
    const loc = region.location;
    const key = loc ? `loc-${loc.id}` : `reg-${region.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let nextSlotDate: string | null = null;
    let nextSlotStartTime: string | null = null;
    let availableSlots = 0;
    let remainingCapacity = 0;

    if (loc) {
      const nextSlot = await findNextSlotForLocation(loc.id, start, end);
      remainingCapacity = await countRemainingCapacity(loc.id, start, end);
      availableSlots = await prisma.campaignSlot.count({
        where: {
          locationId: loc.id,
          date: { gte: startOfDay(start), lte: startOfDay(end) },
          status: "OPEN",
        },
      });
      if (nextSlot && nextSlot.bookedCount < nextSlot.capacity) {
        nextSlotDate = formatDate(nextSlot.date);
        nextSlotStartTime = nextSlot.startTime;
      }
    } else if (region.startDate) {
      nextSlotDate = formatDate(region.startDate);
    }

    let distanceKm: number | null = null;
    if (geo.refLat != null && geo.refLng != null && loc?.latitude != null && loc?.longitude != null) {
      distanceKm = Math.round(haversineKm(geo.refLat, geo.refLng, loc.latitude, loc.longitude) * 10) / 10;
    }

    matches.push({
      type: "region",
      campaignId: region.campaign.id,
      campaignName: region.campaign.name,
      campaignSlug: region.campaign.slug,
      regionId: region.id,
      locationId: loc?.id,
      locationName: loc?.name ?? region.venueName,
      city: region.city,
      venueName: region.venueName,
      venueAddress: region.venueAddress,
      distanceKm,
      nextSlotDate,
      nextSlotStartTime,
      availableSlots,
      remainingCapacity: remainingCapacity || region.targetCapacity,
      targetCapacity: region.targetCapacity,
    });
  }

  matches.sort((a, b) => {
    const da = (a.distanceKm as number | null) ?? 99999;
    const db = (b.distanceKm as number | null) ?? 99999;
    return da - db;
  });

  if (matches.length > 0) {
    matches[0].isNearest = true;
  }

  let areaStatus = { active: false, canPreRegister: true, canBook: false, reason: "NO_MATCH" };
  if (geo.divisionId) {
    areaStatus = await checkAreaActive(
      campaignId,
      geo.divisionId,
      geo.districtId,
      geo.upazilaId
    );
  }

  return {
    campaignId,
    query: {
      divisionId: geo.divisionId,
      districtId: geo.districtId,
      upazilaId: geo.upazilaId,
      district: input.district,
      city: input.city,
      area: input.area,
      postalCode: geo.postalCode,
    },
    matches,
    matchCount: matches.length,
    areaStatus,
    showPreRegister: matches.length === 0 && areaStatus.canPreRegister,
    preRegisterGeo:
      geo.divisionId && geo.districtId && geo.upazilaId
        ? {
            divisionId: geo.divisionId,
            districtId: geo.districtId,
            upazilaId: geo.upazilaId,
          }
        : geo.divisionId && geo.districtId
          ? await (async () => {
              const u = geo.upazilaId
                ? geo.upazilaId
                : (
                    await prisma.bdUpazila.findFirst({
                      where: { districtId: geo.districtId },
                      orderBy: { nameEn: "asc" },
                    })
                  )?.id;
              return u
                ? {
                    divisionId: geo.divisionId!,
                    districtId: geo.districtId!,
                    upazilaId: u,
                  }
                : null;
            })()
          : null,
  };
}

export async function getDiscoverySchedule(input: {
  campaignId?: number;
  campaignSlug?: string;
  startDate?: string;
  endDate?: string;
  divisionId?: number;
  districtId?: number;
  upazilaId?: number;
}) {
  const campaignId = await resolveCampaignId({
    campaignId: input.campaignId,
    campaignSlug: input.campaignSlug,
  });

  const start = input.startDate ? startOfDay(new Date(input.startDate)) : startOfDay(new Date());
  const end = input.endDate
    ? startOfDay(new Date(input.endDate))
    : addDays(start, 30);

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      name: true,
      slug: true,
      startDate: true,
      endDate: true,
      pricingType: true,
    },
  });

  if (!campaign) throw new Error("Campaign not found");

  const locations = await prisma.campaignLocation.findMany({
    where: { campaignId, isActive: true },
    orderBy: { name: "asc" },
  });

  const filteredLocations = locations.filter((loc) => {
    const addr = parseAddressJson(loc.addressJson);
    if (input.districtId && addr.districtId && Number(addr.districtId) !== input.districtId) {
      return false;
    }
    if (input.divisionId && addr.divisionId && Number(addr.divisionId) !== input.divisionId) {
      return false;
    }
    return true;
  });

  const locationIds = filteredLocations.map((l) => l.id);

  const slots = await prisma.campaignSlot.findMany({
    where: {
      locationId: { in: locationIds },
      date: { gte: start, lte: end },
      status: { in: ["OPEN", "FULL"] },
    },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          address: true,
          latitude: true,
          longitude: true,
          addressJson: true,
        },
      },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  const events = slots.map((s) => {
    const addr = parseAddressJson(s.location.addressJson);
    return {
      slotId: s.id,
      locationId: s.locationId,
      locationName: s.location.name,
      date: formatDate(s.date),
      startTime: s.startTime,
      endTime: s.endTime,
      capacity: s.capacity,
      bookedCount: s.bookedCount,
      remainingCapacity: Math.max(0, s.capacity - s.bookedCount),
      status: s.status,
      available: s.status === "OPEN" && s.bookedCount < s.capacity,
      latitude: s.location.latitude,
      longitude: s.location.longitude,
      city: addr.city || addr.upazila,
      district: addr.district,
      division: addr.division,
    };
  });

  const byDate: Record<string, typeof events> = {};
  for (const e of events) {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  }

  const rolloutRegions = await prisma.campaignRolloutRegion.findMany({
    where: {
      campaignId,
      ...(input.divisionId ? { divisionId: input.divisionId } : {}),
      ...(input.districtId
        ? { OR: [{ districtId: input.districtId }, { districtId: null }] }
        : {}),
    },
    include: {
      phase: { select: { name: true, phaseCode: true, status: true } },
    },
  });

  const divisions = await prisma.bdDivision.findMany({
    orderBy: { nameEn: "asc" },
    select: { id: true, nameEn: true, code: true },
  });

  return {
    campaign,
    dateRange: { start: formatDate(start), end: formatDate(end) },
    locations: filteredLocations.map((l) => {
      const addr = parseAddressJson(l.addressJson);
      return {
        id: l.id,
        name: l.name,
        address: l.address,
        latitude: l.latitude,
        longitude: l.longitude,
        division: addr.division,
        district: addr.district,
        city: addr.city || addr.upazila,
        area: addr.area,
      };
    }),
    events,
    byDate,
    rolloutRegions: rolloutRegions.map((r) => ({
      id: r.id,
      city: r.city,
      venueName: r.venueName,
      isActive: r.isActive,
      phaseName: r.phase.name,
      phaseCode: r.phase.phaseCode,
      divisionId: r.divisionId,
      districtId: r.districtId,
      upazilaId: r.upazilaId,
    })),
    divisions,
    totals: {
      eventCount: events.length,
      openEvents: events.filter((e) => e.available).length,
      remainingCapacity: events.reduce((s, e) => s + e.remainingCapacity, 0),
    },
  };
}

export async function getPublicLiveStats(campaignId: number) {
  const [preRegAgg, vaccinatedCount, locationCount, slotCapacity] = await Promise.all([
    prisma.campaignPreRegistration.aggregate({
      where: { campaignId },
      _sum: { catCount: true },
      _count: true,
    }),
    prisma.campaignPet.count({
      where: {
        vaccinationStatus: "COMPLETED",
        booking: { campaignId },
      },
    }),
    prisma.campaignLocation.count({
      where: { campaignId, isActive: true },
    }),
    prisma.campaignSlot.aggregate({
      where: {
        location: { campaignId, isActive: true },
        status: "OPEN",
        date: { gte: startOfDay(new Date()) },
      },
      _sum: { capacity: true, bookedCount: true },
    }),
  ]);

  const capacity = slotCapacity._sum.capacity ?? 0;
  const booked = slotCapacity._sum.bookedCount ?? 0;

  const roadmap = await prisma.campaignPreRegistration.count({
    where: { campaignId, status: { in: ["WAITING", "NOTIFIED"] } },
  });

  return {
    preRegisteredCats: preRegAgg._sum.catCount ?? 0,
    preRegisteredOwners: preRegAgg._count,
    waitingListOwners: roadmap,
    vaccinatedCats: vaccinatedCount,
    campaignLocations: locationCount,
    participatingClinics: locationCount,
    remainingSlotCapacity: Math.max(0, capacity - booked),
    updatedAt: new Date().toISOString(),
  };
}

export async function listBdAreas(input: {
  districtId?: number;
  upazilaId?: number;
  q?: string;
}) {
  const where: Prisma.BdAreaWhereInput = {};
  if (input.districtId) where.districtId = input.districtId;
  if (input.upazilaId) where.upazilaId = input.upazilaId;
  if (input.q?.trim()) {
    where.nameEn = { contains: input.q.trim(), mode: "insensitive" };
  }

  return prisma.bdArea.findMany({
    where,
    orderBy: { nameEn: "asc" },
    take: 100,
    select: { id: true, nameEn: true, type: true, districtId: true, upazilaId: true },
  });
}
