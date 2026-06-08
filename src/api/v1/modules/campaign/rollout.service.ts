/**
 * National campaign rollout engine — phased geography + pre-registration.
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { CampaignRolloutPhaseCode, CampaignRolloutPhaseStatus } from "@prisma/client";
import { normalizePhone, isValidBdPhone } from "./campaign.utils";
import { CampaignErrors } from "./campaign.errors";

const PHASE_2_DIVISION_NAMES = [
  "Chattogram",
  "Chittagong",
  "Rajshahi",
  "Khulna",
  "Sylhet",
  "Barishal",
  "Barisal",
  "Rangpur",
  "Mymensingh",
];

export async function resolveCampaignId(input: {
  campaignId?: number;
  campaignSlug?: string;
}): Promise<number> {
  if (input.campaignId) return input.campaignId;
  if (input.campaignSlug) {
    const c = await prisma.campaign.findUnique({ where: { slug: input.campaignSlug } });
    if (!c) throw CampaignErrors.SLUG_NOT_FOUND(input.campaignSlug);
    return c.id;
  }
  const active = await prisma.campaign.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { id: "desc" },
  });
  if (!active) throw CampaignErrors.NO_ACTIVE();
  return active.id;
}

export async function ensureDefaultRolloutPhases(campaignId: number) {
  const existing = await prisma.campaignRolloutPhase.count({ where: { campaignId } });
  if (existing > 0) return;

  const dhakaDivision = await prisma.bdDivision.findFirst({
    where: { OR: [{ nameEn: { contains: "Dhaka", mode: "insensitive" } }, { code: "DHK" }] },
  });

  const phase1 = await prisma.campaignRolloutPhase.create({
    data: {
      campaignId,
      phaseCode: "PHASE_1",
      name: "Phase 1 — Dhaka",
      description: "Greater Dhaka pilot and scale-up",
      status: "ACTIVE",
      sortOrder: 1,
      nationwideGoalPets: 2500,
    },
  });

  if (dhakaDivision) {
    await prisma.campaignRolloutRegion.create({
      data: {
        phaseId: phase1.id,
        campaignId,
        divisionId: dhakaDivision.id,
        city: "Dhaka",
        targetCapacity: 2500,
        isActive: true,
      },
    });
  }

  const phase2 = await prisma.campaignRolloutPhase.create({
    data: {
      campaignId,
      phaseCode: "PHASE_2",
      name: "Phase 2 — Divisional cities",
      description: "Chattogram, Rajshahi, Khulna, Sylhet, Barishal, Rangpur, Mymensingh",
      status: "PLANNED",
      sortOrder: 2,
      nationwideGoalPets: 5000,
    },
  });

  for (const divName of PHASE_2_DIVISION_NAMES) {
    const div = await prisma.bdDivision.findFirst({
      where: { nameEn: { contains: divName, mode: "insensitive" } },
    });
    if (div) {
      await prisma.campaignRolloutRegion.create({
        data: {
          phaseId: phase2.id,
          campaignId,
          divisionId: div.id,
          city: div.nameEn,
          targetCapacity: 500,
          isActive: false,
        },
      });
    }
  }

  await prisma.campaignRolloutPhase.createMany({
    data: [
      {
        campaignId,
        phaseCode: "PHASE_3",
        name: "Phase 3 — District expansion",
        description: "District-level clinic network expansion",
        status: "PLANNED",
        sortOrder: 3,
        nationwideGoalPets: 8000,
      },
      {
        campaignId,
        phaseCode: "PHASE_4",
        name: "Phase 4 — Nationwide coverage",
        description: "All divisions, districts, and upazilas",
        status: "PLANNED",
        sortOrder: 4,
        nationwideGoalPets: 10000,
      },
    ],
  });
}

export async function getPublicRoadmap(campaignId: number) {
  await ensureDefaultRolloutPhases(campaignId);

  const phases = await prisma.campaignRolloutPhase.findMany({
    where: { campaignId },
    orderBy: { sortOrder: "asc" },
    include: {
      regions: {
        include: {
          location: { select: { id: true, name: true, address: true } },
        },
      },
    },
  });

  const current = phases.find((p) => p.status === "ACTIVE") ?? phases[0] ?? null;
  const upcoming = phases.filter((p) => p.status === "PLANNED");
  const phase4 = phases.find((p) => p.phaseCode === "PHASE_4");
  const nationwideGoal = phase4?.nationwideGoalPets ?? 10000;

  const activeRegions = await prisma.campaignRolloutRegion.count({
    where: { campaignId, isActive: true },
  });

  const preRegCount = await prisma.campaignPreRegistration.count({
    where: { campaignId, status: { in: ["WAITING", "NOTIFIED"] } },
  });

  return {
    currentPhase: current ? serializePhase(current) : null,
    upcomingPhases: upcoming.map(serializePhase),
    nationwideGoal: {
      targetPets: nationwideGoal,
      label: "Nationwide vaccination goal 2026",
      activeRegions,
      preRegisteredOwners: preRegCount,
    },
    phases: phases.map(serializePhase),
  };
}

function serializePhase(phase: {
  id: number;
  phaseCode: string;
  name: string;
  description: string | null;
  status: string;
  sortOrder: number;
  nationwideGoalPets: number;
  startDate: Date | null;
  endDate: Date | null;
  regions?: Array<{
    id: number;
    city: string | null;
    venueName: string | null;
    isActive: boolean;
    targetCapacity: number;
    divisionId: number | null;
    districtId: number | null;
    upazilaId: number | null;
  }>;
}) {
  return {
    id: phase.id,
    phaseCode: phase.phaseCode,
    name: phase.name,
    description: phase.description,
    status: phase.status,
    sortOrder: phase.sortOrder,
    nationwideGoalPets: phase.nationwideGoalPets,
    startDate: phase.startDate,
    endDate: phase.endDate,
    regions: (phase.regions ?? []).map((r) => ({
      id: r.id,
      city: r.city,
      venueName: r.venueName,
      isActive: r.isActive,
      targetCapacity: r.targetCapacity,
      divisionId: r.divisionId,
      districtId: r.districtId,
      upazilaId: r.upazilaId,
    })),
  };
}

export async function checkAreaActive(
  campaignId: number,
  divisionId: number,
  districtId?: number,
  upazilaId?: number
) {
  const regions = await prisma.campaignRolloutRegion.findMany({
    where: {
      campaignId,
      isActive: true,
      divisionId,
      ...(districtId ? { OR: [{ districtId }, { districtId: null }] } : {}),
    },
  });

  if (regions.length === 0) {
    return { active: false, reason: "NO_ACTIVE_REGION", canBook: false, canPreRegister: true };
  }

  if (upazilaId) {
    const upazilaMatch = regions.some(
      (r) => r.upazilaId === upazilaId || r.upazilaId === null
    );
    const districtMatch = regions.some(
      (r) => r.districtId === districtId || r.districtId === null
    );
    if (!upazilaMatch && !districtMatch) {
      return { active: false, reason: "UPAZILA_NOT_OPEN", canBook: false, canPreRegister: true };
    }
  }

  return { active: true, reason: "OPEN", canBook: true, canPreRegister: false };
}

export async function createPreRegistration(input: {
  campaignId: number;
  divisionId: number;
  districtId: number;
  upazilaId: number;
  phone: string;
  catCount: number;
}) {
  if (!isValidBdPhone(input.phone)) {
    throw new Error("Invalid phone number");
  }
  const phone = normalizePhone(input.phone);

  const area = await checkAreaActive(
    input.campaignId,
    input.divisionId,
    input.districtId,
    input.upazilaId
  );
  if (area.canBook) {
    throw new Error("Booking is already open for this area — use the booking wizard");
  }

  const existing = await prisma.campaignPreRegistration.findFirst({
    where: {
      campaignId: input.campaignId,
      phone,
      districtId: input.districtId,
      upazilaId: input.upazilaId,
      status: { in: ["WAITING", "NOTIFIED"] },
    },
  });
  if (existing) {
    return { id: existing.id, duplicate: true, status: existing.status };
  }

  const region = await prisma.campaignRolloutRegion.findFirst({
    where: {
      campaignId: input.campaignId,
      divisionId: input.divisionId,
      OR: [{ districtId: input.districtId }, { districtId: null }],
    },
    orderBy: { isActive: "desc" },
  });

  const row = await prisma.campaignPreRegistration.create({
    data: {
      campaignId: input.campaignId,
      regionId: region?.id,
      divisionId: input.divisionId,
      districtId: input.districtId,
      upazilaId: input.upazilaId,
      phone,
      catCount: input.catCount,
      status: "WAITING",
    },
  });

  return { id: row.id, duplicate: false, status: row.status };
}

export async function listBookableAreas(campaignId: number) {
  const regions = await prisma.campaignRolloutRegion.findMany({
    where: { campaignId, isActive: true },
    orderBy: [{ divisionId: "asc" }, { districtId: "asc" }],
    include: {
      location: { select: { id: true, name: true } },
    },
  });

  const divisionIds = [...new Set(regions.map((r) => r.divisionId).filter(Boolean))] as number[];
  const districtIds = [...new Set(regions.map((r) => r.districtId).filter(Boolean))] as number[];
  const upazilaIds = [...new Set(regions.map((r) => r.upazilaId).filter(Boolean))] as number[];

  const [divisions, districts, upazilas] = await Promise.all([
    divisionIds.length
      ? prisma.bdDivision.findMany({ where: { id: { in: divisionIds } } })
      : [],
    districtIds.length
      ? prisma.bdDistrict.findMany({ where: { id: { in: districtIds } } })
      : [],
    upazilaIds.length
      ? prisma.bdUpazila.findMany({ where: { id: { in: upazilaIds } } })
      : [],
  ]);

  const divMap = new Map<number, string>(divisions.map((d) => [d.id, d.nameEn] as [number, string]));
  const distMap = new Map<number, string>(districts.map((d) => [d.id, d.nameEn] as [number, string]));
  const upaMap = new Map<number, string>(upazilas.map((u) => [u.id, u.nameEn] as [number, string]));

  return regions.map((r) => ({
    id: r.id,
    divisionId: r.divisionId,
    districtId: r.districtId,
    upazilaId: r.upazilaId,
    division: r.divisionId ? divMap.get(r.divisionId) : null,
    district: r.districtId ? distMap.get(r.districtId) : r.city,
    upazila: r.upazilaId ? upaMap.get(r.upazilaId) : null,
    city: r.city,
    venueName: r.venueName,
    targetCapacity: r.targetCapacity,
    bookedCount: r.bookedCount,
    remainingCapacity: Math.max(0, r.targetCapacity - r.bookedCount),
    utilizationPct:
      r.targetCapacity > 0 ? Math.round((r.bookedCount / r.targetCapacity) * 100) : 0,
    location: r.location,
    isActive: r.isActive,
  }));
}

export async function getRolloutRegionStats(regionId: number) {
  const region = await prisma.campaignRolloutRegion.findUnique({
    where: { id: regionId },
    include: {
      _count: { select: { bookings: true, checkoutSessions: true } },
    },
  });
  if (!region) throw new Error("Region not found");

  const utilizationPct =
    region.targetCapacity > 0
      ? Math.round((region.bookedCount / region.targetCapacity) * 100)
      : 0;

  return {
    id: region.id,
    targetCapacity: region.targetCapacity,
    bookedCount: region.bookedCount,
    remainingCapacity: Math.max(0, region.targetCapacity - region.bookedCount),
    utilizationPct,
    bookingCount: region._count.bookings,
    checkoutSessionCount: region._count.checkoutSessions,
    isActive: region.isActive,
  };
}

export async function listBdDivisions() {
  return prisma.bdDivision.findMany({ orderBy: { nameEn: "asc" } });
}

export async function listBdDistricts(divisionId: number) {
  return prisma.bdDistrict.findMany({
    where: { divisionId },
    orderBy: { nameEn: "asc" },
  });
}

export async function listBdUpazilas(districtId: number) {
  return prisma.bdUpazila.findMany({
    where: { districtId },
    orderBy: { nameEn: "asc" },
  });
}

// --- Admin ---

export async function createRolloutPhase(data: {
  campaignId: number;
  phaseCode: CampaignRolloutPhaseCode;
  name: string;
  description?: string;
  status?: CampaignRolloutPhaseStatus;
  sortOrder?: number;
  nationwideGoalPets?: number;
  startDate?: Date;
  endDate?: Date;
}) {
  return prisma.campaignRolloutPhase.create({ data });
}

export async function updateRolloutPhase(
  id: number,
  data: Partial<{
    name: string;
    description: string;
    status: CampaignRolloutPhaseStatus;
    sortOrder: number;
    nationwideGoalPets: number;
    startDate: Date | null;
    endDate: Date | null;
  }>
) {
  return prisma.campaignRolloutPhase.update({ where: { id }, data });
}

export async function createRolloutRegion(data: {
  phaseId: number;
  campaignId: number;
  divisionId?: number | null;
  districtId?: number | null;
  upazilaId?: number | null;
  city?: string;
  venueName?: string;
  venueAddress?: string;
  locationId?: number | null;
  startDate?: Date;
  endDate?: Date;
  targetCapacity: number;
  isActive?: boolean;
}) {
  return prisma.campaignRolloutRegion.create({ data });
}

export async function updateRolloutRegion(
  id: number,
  data: Partial<{
    divisionId: number | null;
    districtId: number | null;
    upazilaId: number | null;
    city: string;
    venueName: string;
    venueAddress: string;
    locationId: number | null;
    startDate: Date | null;
    endDate: Date | null;
    targetCapacity: number;
    isActive: boolean;
  }>
) {
  return prisma.campaignRolloutRegion.update({ where: { id }, data });
}

export async function listRolloutPhases(campaignId: number) {
  await ensureDefaultRolloutPhases(campaignId);
  return prisma.campaignRolloutPhase.findMany({
    where: { campaignId },
    orderBy: { sortOrder: "asc" },
    include: { regions: true },
  });
}

export async function getPreBookingDashboard(campaignId: number) {
  const rows = await prisma.campaignPreRegistration.findMany({
    where: { campaignId },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const byStatus = await prisma.campaignPreRegistration.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: true,
    _sum: { catCount: true },
  });
  return { rows, byStatus };
}

export async function getAreaDemandDashboard(campaignId: number) {
  const regions = await prisma.campaignRolloutRegion.findMany({
    where: { campaignId },
    include: {
      phase: { select: { name: true, phaseCode: true, status: true } },
      _count: { select: { preRegistrations: true } },
    },
  });

  const preByDistrict = await prisma.campaignPreRegistration.groupBy({
    by: ["districtId"],
    where: { campaignId, status: { in: ["WAITING", "NOTIFIED"] } },
    _count: true,
    _sum: { catCount: true },
  });

  return { regions, preByDistrict };
}

export async function getWaitingListDashboard(campaignId: number) {
  return prisma.campaignPreRegistration.findMany({
    where: { campaignId, status: "WAITING" },
    orderBy: { createdAt: "asc" },
    take: 1000,
  });
}

export async function getRolloutDemandReports(campaignId: number) {
  const byDistrict = await prisma.campaignPreRegistration.groupBy({
    by: ["districtId"],
    where: { campaignId },
    _count: true,
    _sum: { catCount: true },
  });

  const districtIds = byDistrict.map((d) => d.districtId).filter((id): id is number => id != null);
  const districts = await prisma.bdDistrict.findMany({
    where: { id: { in: districtIds } },
    include: { division: true },
  });
  const districtMap = new Map(districts.map((d) => [d.id, d]));

  const mostRequestedDistricts = byDistrict
    .map((row) => ({
      districtId: row.districtId,
      districtName: row.districtId ? districtMap.get(row.districtId)?.nameEn : "Unknown",
      divisionName: row.districtId ? districtMap.get(row.districtId)?.division?.nameEn : null,
      registrations: row._count,
      estimatedCats: row._sum.catCount ?? 0,
    }))
    .sort((a, b) => b.estimatedCats - a.estimatedCats);

  const byUpazila = await prisma.campaignPreRegistration.groupBy({
    by: ["upazilaId"],
    where: { campaignId },
    _count: true,
    _sum: { catCount: true },
  });

  const upazilaIds = byUpazila.map((u) => u.upazilaId).filter((id): id is number => id != null);
  const upazilas = await prisma.bdUpazila.findMany({ where: { id: { in: upazilaIds } } });
  const upazilaMap = new Map(upazilas.map((u) => [u.id, u]));

  const mostRequestedCities = byUpazila
    .map((row) => ({
      upazilaId: row.upazilaId,
      cityName: row.upazilaId ? upazilaMap.get(row.upazilaId)?.nameEn : "Unknown",
      registrations: row._count,
      estimatedCats: row._sum.catCount ?? 0,
    }))
    .sort((a, b) => b.estimatedCats - a.estimatedCats);

  const totals = await prisma.campaignPreRegistration.aggregate({
    where: { campaignId },
    _sum: { catCount: true },
    _count: true,
  });

  return {
    mostRequestedDistricts,
    mostRequestedCities,
    estimatedVaccineDemand: totals._sum.catCount ?? 0,
    totalPreRegistrations: totals._count,
  };
}

export async function notifyPreRegisteredUsers(input: {
  campaignId: number;
  regionId?: number;
  phaseId?: number;
}) {
  const where: Record<string, unknown> = {
    campaignId: input.campaignId,
    status: "WAITING",
  };
  if (input.regionId) where.regionId = input.regionId;

  const waiting = await prisma.campaignPreRegistration.findMany({ where });

  if (waiting.length === 0) {
    return { notified: 0 };
  }

  const now = new Date();
  await prisma.campaignPreRegistration.updateMany({
    where: { id: { in: waiting.map((w) => w.id) } },
    data: { status: "NOTIFIED", notifiedAt: now },
  });

  // SMS enqueue hook — integrate campaign SMS templates when region opens
  for (const row of waiting) {
    try {
      const { enqueueCampaignSmsMessage } = require("./campaign.smsQueue") as {
        enqueueCampaignSmsMessage: (p: string, m: string, meta?: object) => Promise<boolean>;
      };
      const msg = `BPA Vaccination: booking is now open for your area. Visit the campaign site to book (${row.catCount} cat(s) pre-registered).`;
      await enqueueCampaignSmsMessage(row.phone, msg, { template: "CAMPAIGN_PREREG_OPEN" });
    } catch {
      /* queue optional */
    }
  }

  return { notified: waiting.length };
}
