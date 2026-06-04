/**
 * Campaign Service
 * Core campaign management operations
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { CampaignStatus, CampaignVisibility, Prisma } from "@prisma/client";
import {
  CreateCampaignInput,
  UpdateCampaignInput,
  CampaignStats,
  AuditLogInput,
} from "./campaign.types";
import { CampaignErrors } from "./campaign.errors";
import { generateSlug, startOfDay, endOfDay } from "./campaign.utils";
import { normalizeCampaignPricingFields } from "./campaignPricingPresentation.service";

// ============================================================================
// Campaign CRUD
// ============================================================================

/**
 * Create a new campaign
 */
export async function createCampaign(input: CreateCampaignInput, createdByUserId?: number) {
  // Validate date range
  if (input.endDate <= input.startDate) {
    throw CampaignErrors.INVALID_DATE_RANGE();
  }

  // Check slug uniqueness
  const existingSlug = await prisma.campaign.findUnique({
    where: { slug: input.slug },
  });
  if (existingSlug) {
    throw CampaignErrors.SLUG_EXISTS(input.slug);
  }

  const pricingFields = normalizeCampaignPricingFields({
    pricingType: input.pricingType ?? "FREE",
    priceAmount: input.priceAmount,
    vaccineCost: input.vaccineCost,
    serviceCharge: input.serviceCharge,
    packageFeatures: input.packageFeatures,
  });

  const campaign = await prisma.campaign.create({
    data: {
      name: input.name,
      slug: input.slug,
      description: input.description,
      startDate: input.startDate,
      endDate: input.endDate,
      bookingStartAt: input.bookingStartAt,
      bookingEndAt: input.bookingEndAt,
      countdownEnabled: input.countdownEnabled ?? false,
      pricingType: input.pricingType ?? "FREE",
      priceAmount: pricingFields.priceAmount,
      vaccineCost: pricingFields.vaccineCost,
      serviceCharge: pricingFields.serviceCharge,
      packageFeatures: (pricingFields.packageFeatures ?? []) as Prisma.InputJsonValue,
      maxPetsPerBooking: input.maxPetsPerBooking ?? 5,
      advanceBookingDays: input.advanceBookingDays ?? 30,
      minAdvanceHours: input.minAdvanceHours ?? 24,
      allowWalkIns: input.allowWalkIns ?? true,
      walkInQuotaPercent: input.walkInQuotaPercent ?? 20,
      targetVaccinations: input.targetVaccinations ?? 0,
      organizerId: input.organizerId,
      status: input.status ?? "DRAFT",
    },
  });

  // Create default config row
  await prisma.campaignConfig.create({
    data: {
      campaignId: campaign.id,
      version: 1,
      bookingEnabled: true,
      onlinePaymentEnabled: input.pricingType !== "FREE" && input.pricingType !== undefined,
      payAtVenueEnabled: false,
      walkInAllowed: input.allowWalkIns ?? true,
      maxCatsPerBooking: input.maxPetsPerBooking ?? 5,
    },
  });

  // Audit log
  await logCampaignAudit({
    campaignId: campaign.id,
    actorUserId: createdByUserId,
    action: "CAMPAIGN_CREATED",
    entityType: "Campaign",
    entityId: campaign.id,
    afterJson: campaign as unknown as Record<string, unknown>,
  });

  return campaign;
}

/**
 * Get campaign by ID
 */
export async function getCampaignById(id: number) {
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      locations: {
        where: { isActive: true },
        orderBy: { name: "asc" },
      },
      vaccineTypes: {
        where: { isActive: true },
        include: {
          vaccineType: true,
        },
      },
      includedVaccines: {
        orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      },
      organizer: {
        select: { id: true, name: true },
      },
      config: true,
      _count: {
        select: {
          bookings: true,
          staff: true,
        },
      },
    },
  });

  if (!campaign) {
    throw CampaignErrors.NOT_FOUND(id);
  }

  return campaign;
}

/**
 * Get campaign by slug (public)
 */
export async function getCampaignBySlug(slug: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    include: {
      locations: {
        where: { isActive: true },
        orderBy: { name: "asc" },
      },
      vaccineTypes: {
        where: { isActive: true },
        include: {
          vaccineType: {
            select: { id: true, name: true, description: true },
          },
        },
      },
      includedVaccines: {
        where: { isActive: true },
        orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      },
    },
  });

  if (!campaign) {
    throw CampaignErrors.NOT_FOUND(0);
  }

  return campaign;
}

export async function getCampaignCountdownBySlug(slug: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    select: {
      name: true,
      bookingStartAt: true,
      bookingEndAt: true,
      countdownEnabled: true,
      status: true,
      visibility: true,
    },
  });

  if (!campaign || campaign.visibility !== "PUBLIC") {
    throw CampaignErrors.NOT_FOUND(0);
  }

  return {
    campaignName: campaign.name,
    bookingStartAt: campaign.bookingStartAt,
    bookingEndAt: campaign.bookingEndAt,
    countdownEnabled: campaign.countdownEnabled,
    status: campaign.status,
  };
}

/**
 * List campaigns with filters
 */
export async function listCampaigns(params: {
  status?: CampaignStatus;
  visibility?: CampaignVisibility;
  organizerId?: number;
  page?: number;
  pageSize?: number;
}) {
  const { status, visibility, organizerId, page = 1, pageSize = 20 } = params;

  const where: Prisma.CampaignWhereInput = {};
  if (status) where.status = status;
  if (visibility) where.visibility = visibility;
  if (organizerId) where.organizerId = organizerId;

  const [items, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: {
          select: { bookings: true, locations: true },
        },
      },
    }),
    prisma.campaign.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Get active public campaigns
 */
export async function getPublicCampaigns() {
  const now = new Date();
  
  return prisma.campaign.findMany({
    where: {
      status: "ACTIVE",
      visibility: "PUBLIC",
      startDate: { lte: now },
      endDate: { gte: now },
    },
    orderBy: { startDate: "asc" },
    include: {
      locations: {
        where: { isActive: true },
        select: { id: true, name: true, address: true },
      },
      vaccineTypes: {
        where: { isActive: true },
        include: {
          vaccineType: {
            select: { id: true, name: true },
          },
        },
      },
      includedVaccines: {
        where: { isActive: true },
        orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      },
    },
  });
}

/**
 * Update campaign
 */
export async function updateCampaign(
  id: number,
  input: UpdateCampaignInput,
  updatedByUserId?: number
) {
  const existing = await prisma.campaign.findUnique({ where: { id } });
  if (!existing) {
    throw CampaignErrors.NOT_FOUND(id);
  }

  // Validate date range if updating dates
  if (input.startDate || input.endDate) {
    const newStart = input.startDate ?? existing.startDate;
    const newEnd = input.endDate ?? existing.endDate;
    if (newEnd <= newStart) {
      throw CampaignErrors.INVALID_DATE_RANGE();
    }
  }

  if (input.bookingStartAt || input.bookingEndAt) {
    const newBookingStart = input.bookingStartAt ?? existing.bookingStartAt;
    const newBookingEnd = input.bookingEndAt ?? existing.bookingEndAt;
    if (newBookingStart && newBookingEnd && newBookingEnd <= newBookingStart) {
      throw CampaignErrors.INVALID_DATE_RANGE();
    }
  }

  const pricingPatch =
    input.priceAmount !== undefined ||
    input.vaccineCost !== undefined ||
    input.serviceCharge !== undefined ||
    input.packageFeatures !== undefined ||
    input.pricingType !== undefined
      ? normalizeCampaignPricingFields({
          pricingType: input.pricingType ?? existing.pricingType,
          priceAmount:
            input.priceAmount !== undefined
              ? input.priceAmount
              : existing.priceAmount != null
                ? Number(existing.priceAmount)
                : null,
          vaccineCost:
            input.vaccineCost !== undefined
              ? input.vaccineCost
              : existing.vaccineCost != null
                ? Number(existing.vaccineCost)
                : null,
          serviceCharge:
            input.serviceCharge !== undefined
              ? input.serviceCharge
              : existing.serviceCharge != null
                ? Number(existing.serviceCharge)
                : null,
          packageFeatures:
            input.packageFeatures ??
            (Array.isArray(existing.packageFeatures)
              ? (existing.packageFeatures as string[])
              : []),
        })
      : null;

  const { vaccineCost: _vc, serviceCharge: _sc, packageFeatures: _pf, ...restInput } = input;

  const updated = await prisma.campaign.update({
    where: { id },
    data: {
      ...restInput,
      ...(pricingPatch
        ? {
            priceAmount: pricingPatch.priceAmount,
            vaccineCost: pricingPatch.vaccineCost,
            serviceCharge: pricingPatch.serviceCharge,
            ...(pricingPatch.packageFeatures
              ? { packageFeatures: pricingPatch.packageFeatures as Prisma.InputJsonValue }
              : {}),
          }
        : {}),
      publishedAt: input.status === "ACTIVE" && !existing.publishedAt ? new Date() : undefined,
    },
  });

  // Audit log
  await logCampaignAudit({
    campaignId: id,
    actorUserId: updatedByUserId,
    action: "CAMPAIGN_UPDATED",
    entityType: "Campaign",
    entityId: id,
    beforeJson: existing as unknown as Record<string, unknown>,
    afterJson: updated as unknown as Record<string, unknown>,
  });

  return updated;
}

/**
 * Activate campaign
 */
export async function activateCampaign(id: number, userId?: number) {
  const campaign = await getCampaignById(id);
  
  const now = new Date();
  if (campaign.endDate < now) {
    throw CampaignErrors.ALREADY_ENDED();
  }

  return updateCampaign(id, { status: "ACTIVE" }, userId);
}

/**
 * Pause campaign
 */
export async function pauseCampaign(id: number, userId?: number) {
  return updateCampaign(id, { status: "PAUSED" }, userId);
}

/**
 * Complete campaign
 */
export async function completeCampaign(id: number, userId?: number) {
  return updateCampaign(id, { status: "COMPLETED" }, userId);
}

/**
 * Cancel campaign
 */
export async function cancelCampaign(id: number, userId?: number) {
  return updateCampaign(id, { status: "CANCELLED" }, userId);
}

// ============================================================================
// Campaign Stats
// ============================================================================

/**
 * Get campaign statistics
 */
export async function getCampaignStats(campaignId: number): Promise<CampaignStats> {
  const campaign = await getCampaignById(campaignId);

  const [
    totalBookings,
    statusCounts,
    locationStats,
    dailyStats,
    vaccinationCount,
  ] = await Promise.all([
    // Total bookings
    prisma.campaignBooking.count({
      where: { campaignId },
    }),
    
    // Bookings by status
    prisma.campaignBooking.groupBy({
      by: ["status"],
      where: { campaignId },
      _count: true,
    }),
    
    // By location
    prisma.campaignBooking.groupBy({
      by: ["locationId"],
      where: { campaignId },
      _count: true,
    }),
    
    // By day
    prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
      SELECT DATE("bookingDate") as date, COUNT(*) as count
      FROM campaign_bookings
      WHERE "campaignId" = ${campaignId}
      GROUP BY DATE("bookingDate")
      ORDER BY date
    `,
    
    // Total vaccinations
    prisma.campaignPet.count({
      where: {
        booking: { campaignId },
        vaccinationStatus: "COMPLETED",
      },
    }),
  ]);

  // Get location names
  const locations = await prisma.campaignLocation.findMany({
    where: { campaignId },
    select: { id: true, name: true },
  });
  const locationMap = new Map(locations.map((l) => [l.id, l.name]));

  // Calculate completion rate
  const completedBookings = statusCounts.find((s) => s.status === "COMPLETED")?._count ?? 0;
  const completionRate = totalBookings > 0 ? (completedBookings / totalBookings) * 100 : 0;

  // Calculate show rate
  const checkedIn = statusCounts
    .filter((s) => ["CHECKED_IN", "IN_PROGRESS", "COMPLETED"].includes(s.status))
    .reduce((sum, s) => sum + s._count, 0);
  const scheduled = statusCounts
    .filter((s) => !["CANCELLED", "DRAFT"].includes(s.status))
    .reduce((sum, s) => sum + s._count, 0);
  const showRate = scheduled > 0 ? (checkedIn / scheduled) * 100 : 0;

  return {
    totalBookings,
    totalVaccinations: vaccinationCount,
    completionRate: Math.round(completionRate * 100) / 100,
    showRate: Math.round(showRate * 100) / 100,
    byLocation: locationStats.map((ls) => ({
      locationId: ls.locationId,
      locationName: locationMap.get(ls.locationId) ?? "Unknown",
      bookings: ls._count,
      vaccinations: 0, // TODO: Add per-location vaccination count
    })),
    byDay: dailyStats.map((ds) => ({
      date: ds.date.toISOString().split("T")[0],
      bookings: Number(ds.count),
      vaccinations: 0, // TODO: Add per-day vaccination count
    })),
  };
}

/**
 * Get daily summary for a campaign
 */
export async function getDailySummary(campaignId: number, date: Date) {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const [bookings, vaccinations, statusCounts] = await Promise.all([
    // Bookings created today
    prisma.campaignBooking.count({
      where: {
        campaignId,
        createdAt: { gte: dayStart, lte: dayEnd },
      },
    }),
    
    // Vaccinations today
    prisma.campaignPet.count({
      where: {
        booking: { campaignId, bookingDate: date },
        vaccinationStatus: "COMPLETED",
      },
    }),
    
    // Status breakdown
    prisma.campaignBooking.groupBy({
      by: ["status"],
      where: {
        campaignId,
        bookingDate: date,
      },
      _count: true,
    }),
  ]);

  const statusMap = new Map(statusCounts.map((s) => [s.status, s._count]));

  return {
    date: date.toISOString().split("T")[0],
    bookings: {
      total: statusCounts.reduce((sum, s) => sum + s._count, 0),
      new: bookings,
      cancelled: statusMap.get("CANCELLED") ?? 0,
      walkIns: 0, // TODO: Count walk-ins
    },
    attendance: {
      scheduled: (statusMap.get("CONFIRMED") ?? 0) + (statusMap.get("CHECKED_IN") ?? 0) + 
                 (statusMap.get("IN_PROGRESS") ?? 0) + (statusMap.get("COMPLETED") ?? 0) +
                 (statusMap.get("NO_SHOW") ?? 0),
      checkedIn: (statusMap.get("CHECKED_IN") ?? 0) + (statusMap.get("IN_PROGRESS") ?? 0) + 
                 (statusMap.get("COMPLETED") ?? 0),
      completed: statusMap.get("COMPLETED") ?? 0,
      noShow: statusMap.get("NO_SHOW") ?? 0,
      showRate: 0, // Calculate below
    },
    vaccinations: {
      total: vaccinations,
      byType: [], // TODO: Add by-type breakdown
    },
    queue: {
      avgWaitMinutes: 0, // TODO: Calculate from check-in times
      maxWaitMinutes: 0,
    },
  };
}

// ============================================================================
// Audit Logging
// ============================================================================

/**
 * Log campaign audit event
 */
export async function logCampaignAudit(input: AuditLogInput) {
  return prisma.campaignAuditLog.create({
    data: {
      campaignId: input.campaignId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      actorIp: input.actorIp,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeJson: input.beforeJson as Prisma.InputJsonValue,
      afterJson: input.afterJson as Prisma.InputJsonValue,
      metadataJson: input.metadataJson as Prisma.InputJsonValue,
    },
  });
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Check if campaign is active and accepting bookings
 */
export async function validateCampaignForBooking(campaignId: number) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) {
    throw CampaignErrors.NOT_FOUND(campaignId);
  }

  if (campaign.status !== "ACTIVE") {
    throw CampaignErrors.NOT_ACTIVE();
  }

  const now = new Date();
  if (campaign.endDate < now) {
    throw CampaignErrors.ALREADY_ENDED();
  }

  if (campaign.startDate > now) {
    throw CampaignErrors.NOT_STARTED();
  }

  if (campaign.bookingStartAt && campaign.bookingStartAt > now) {
    throw CampaignErrors.BOOKING_NOT_OPEN();
  }

  if (campaign.bookingEndAt && campaign.bookingEndAt <= now) {
    throw CampaignErrors.BOOKING_CLOSED();
  }

  return campaign;
}

export default {
  createCampaign,
  getCampaignById,
  getCampaignBySlug,
  getCampaignCountdownBySlug,
  listCampaigns,
  getPublicCampaigns,
  updateCampaign,
  activateCampaign,
  pauseCampaign,
  completeCampaign,
  cancelCampaign,
  getCampaignStats,
  getDailySummary,
  logCampaignAudit,
  validateCampaignForBooking,
};
