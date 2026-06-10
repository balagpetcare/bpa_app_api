/**
 * Campaign Configuration Engine
 * Centralised CRUD for per-campaign settings.
 * Falls back to Campaign flat fields when no CampaignConfig row exists.
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { Prisma, type CampaignPaymentChannelMode } from "@prisma/client";
import { CampaignErrors } from "./campaign.errors";
import { logCampaignAudit } from "./campaign.service";
import {
  fetchVaccinationPaymentConfigBySlug,
  syncVaccinationPaymentConfigBySlug,
} from "../../../../shared/integrations/vaccination-api/vaccination-campaign-sync.service";

// ============================================================================
// Types
// ============================================================================

export interface CampaignConfigData {
  bookingEnabled: boolean;
  onlinePaymentEnabled: boolean;
  payAtVenueEnabled: boolean;
  paymentChannelMode: CampaignPaymentChannelMode;
  walkInAllowed: boolean;
  approvalRequired: boolean;
  slotRequired: boolean;
  autoCloseWhenFull: boolean;
  maxCapacity: number;
  maxCatsPerBooking: number;
  showRemainingSlots: boolean;
  lateBookingAllowed: boolean;
}

export type CampaignConfigUpdate = Partial<CampaignConfigData>;

const CONFIG_DEFAULTS: CampaignConfigData = {
  bookingEnabled: true,
  onlinePaymentEnabled: false,
  payAtVenueEnabled: false,
  paymentChannelMode: "SMS_ONLY",
  walkInAllowed: true,
  approvalRequired: false,
  slotRequired: true,
  autoCloseWhenFull: true,
  maxCapacity: 0,
  maxCatsPerBooking: 5,
  showRemainingSlots: true,
  lateBookingAllowed: false,
};

// ============================================================================
// Read
// ============================================================================

export async function getCampaignConfig(campaignId: number): Promise<CampaignConfigData & { version: number; campaignId: number }> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw CampaignErrors.NOT_FOUND(campaignId);

  const existing = await prisma.campaignConfig.findUnique({
    where: { campaignId },
  });

  let config: CampaignConfigData & { version: number; campaignId: number };

  if (existing) {
    config = {
      campaignId: existing.campaignId,
      version: existing.version,
      bookingEnabled: existing.bookingEnabled,
      onlinePaymentEnabled: existing.onlinePaymentEnabled,
      payAtVenueEnabled: existing.payAtVenueEnabled,
      paymentChannelMode: existing.paymentChannelMode,
      walkInAllowed: existing.walkInAllowed,
      approvalRequired: existing.approvalRequired,
      slotRequired: existing.slotRequired,
      autoCloseWhenFull: existing.autoCloseWhenFull,
      maxCapacity: existing.maxCapacity,
      maxCatsPerBooking: existing.maxCatsPerBooking,
      showRemainingSlots: existing.showRemainingSlots,
      lateBookingAllowed: existing.lateBookingAllowed,
    };
  } else {
    config = {
      campaignId,
      version: 0,
      ...CONFIG_DEFAULTS,
      maxCatsPerBooking: campaign.maxPetsPerBooking,
      walkInAllowed: campaign.allowWalkIns,
      onlinePaymentEnabled: campaign.pricingType !== "FREE",
    };
  }

  const remote = await fetchVaccinationPaymentConfigBySlug(campaign.slug);
  if (remote) {
    config.paymentChannelMode = remote.paymentChannelMode;
    config.onlinePaymentEnabled = remote.onlinePaymentEnabled;
  }

  return config;
}

/**
 * Lightweight read used by booking / checkout hot path.
 * Returns the config row or null (caller uses Campaign flat fields as fallback).
 */
export async function getCampaignConfigOrNull(campaignId: number) {
  return prisma.campaignConfig.findUnique({ where: { campaignId } });
}

// ============================================================================
// Create / Update
// ============================================================================

export async function upsertCampaignConfig(
  campaignId: number,
  data: CampaignConfigUpdate,
  changedByUserId?: number,
  changeReason?: string,
) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw CampaignErrors.NOT_FOUND(campaignId);

  const existing = await prisma.campaignConfig.findUnique({ where: { campaignId } });
  const nextVersion = (existing?.version ?? 0) + 1;

  const merged: CampaignConfigData = {
    ...(existing
      ? {
          bookingEnabled: existing.bookingEnabled,
          onlinePaymentEnabled: existing.onlinePaymentEnabled,
          payAtVenueEnabled: existing.payAtVenueEnabled,
          paymentChannelMode: existing.paymentChannelMode,
          walkInAllowed: existing.walkInAllowed,
          approvalRequired: existing.approvalRequired,
          slotRequired: existing.slotRequired,
          autoCloseWhenFull: existing.autoCloseWhenFull,
          maxCapacity: existing.maxCapacity,
          maxCatsPerBooking: existing.maxCatsPerBooking,
          showRemainingSlots: existing.showRemainingSlots,
          lateBookingAllowed: existing.lateBookingAllowed,
        }
      : CONFIG_DEFAULTS),
    ...stripUndefined(data),
  };

  const config = await prisma.campaignConfig.upsert({
    where: { campaignId },
    create: {
      campaignId,
      version: nextVersion,
      ...merged,
    },
    update: {
      version: nextVersion,
      ...merged,
    },
  });

  await prisma.campaignConfigHistory.create({
    data: {
      campaignId,
      version: nextVersion,
      changedBy: changedByUserId,
      changeReason,
      configJson: merged as unknown as Prisma.InputJsonValue,
    },
  });

  await logCampaignAudit({
    campaignId,
    actorUserId: changedByUserId,
    action: "CONFIG_UPDATED",
    entityType: "CampaignConfig",
    entityId: config.id,
    beforeJson: existing as unknown as Record<string, unknown> | undefined,
    afterJson: merged as unknown as Record<string, unknown>,
  });

  const paymentFieldsChanged =
    data.onlinePaymentEnabled !== undefined || data.paymentChannelMode !== undefined;
  if (paymentFieldsChanged) {
    await syncVaccinationPaymentConfigBySlug(campaign.slug, {
      onlinePaymentEnabled: merged.onlinePaymentEnabled,
      paymentChannelMode: merged.paymentChannelMode,
    });
  }

  return config;
}

// ============================================================================
// History
// ============================================================================

export async function getConfigHistory(campaignId: number) {
  return prisma.campaignConfigHistory.findMany({
    where: { campaignId },
    orderBy: { version: "desc" },
    take: 50,
  });
}

export async function getConfigVersion(campaignId: number, version: number) {
  return prisma.campaignConfigHistory.findFirst({
    where: { campaignId, version },
  });
}

// ============================================================================
// Validation helpers consumed by booking / checkout
// ============================================================================

export function validateBookingAgainstConfig(
  config: CampaignConfigData,
  petCount: number,
  isWalkIn: boolean,
  isPaidCampaign = false,
) {
  const errors: string[] = [];

  if (!config.bookingEnabled && !isWalkIn) {
    errors.push("Booking is currently disabled for this campaign");
  }

  if (isWalkIn && !config.walkInAllowed) {
    errors.push("Walk-in registrations are not allowed for this campaign");
  }

  if (petCount > config.maxCatsPerBooking) {
    errors.push(`Maximum ${config.maxCatsPerBooking} cats allowed per booking`);
  }

  if (isPaidCampaign && !config.onlinePaymentEnabled && !config.payAtVenueEnabled && !isWalkIn) {
    errors.push("No payment method available — booking disabled");
  }

  return { valid: errors.length === 0, errors };
}

export function validateCapacity(
  config: CampaignConfigData,
  currentBookedCount: number,
  requestedPets: number,
) {
  if (config.maxCapacity <= 0) return { valid: true, remaining: Infinity };

  const remaining = config.maxCapacity - currentBookedCount;
  if (config.autoCloseWhenFull && requestedPets > remaining) {
    return { valid: false, remaining };
  }
  return { valid: true, remaining };
}

// ============================================================================
// Helpers
// ============================================================================

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value;
  }
  return result as Partial<T>;
}
