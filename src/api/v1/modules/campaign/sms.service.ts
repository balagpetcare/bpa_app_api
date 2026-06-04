/**
 * Campaign SMS Service
 * Integrates with existing BPA notification infrastructure
 * Uses BullMQ for queue-based SMS delivery
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { Prisma, CampaignSmsStatus } from "@prisma/client";
import {
  SendSmsInput,
  SmsTemplateCode,
} from "./campaign.types";
import { interpolateTemplate, normalizePhone, formatDate } from "./campaign.utils";
import { generateVerificationCode } from "./qr.service";

// Default SMS templates
const DEFAULT_TEMPLATES: Record<SmsTemplateCode, string> = {
  OTP: "Your BPA vaccination code: {{otp}}. Valid for 5 minutes. Do not share.",
  BOOKING_CONFIRMED: "BPA Vaccination: Booking confirmed! ID: {{bookingRef}}. Code: {{verificationCode}}. {{catCount}} cat(s) — {{areaName}} on {{date}} at {{location}}, {{time}}. {{claimUrl}}",
  BOOKING_ZONE_INTEREST:
    "BPA Vaccination: Interest registered! Ref {{bookingRef}}. Code {{verificationCode}}. Zone: {{zoneName}}, Area: {{bookingArea}}. {{catCount}} cat(s). We will SMS your venue, date & time before the campaign. {{claimUrl}}",
  VENUE_ASSIGNED:
    "BPA Vaccination: Your appointment is set! Ref {{bookingRef}}. {{catCount}} cat(s) — {{bookingArea}} on {{date}} at {{location}}, {{time}}. Code: {{verificationCode}}. {{claimUrl}}",
  REMINDER_24H: "BPA Vaccination Reminder: {{petName}} tomorrow at {{time}}. Location: {{location}}. Ref: {{bookingRef}}",
  REMINDER_2H: "BPA Vaccination: {{petName}} in 2 hours at {{location}}. Please arrive 10 min early. Ref: {{bookingRef}}",
  VACCINATION_COMPLETE: "BPA Vaccination Complete! {{petName}} vaccinated. Certificate: {{certUrl}} Valid for 1 year.",
  BOOKING_CANCELLED: "BPA Vaccination: Your booking ({{bookingRef}}) has been cancelled. Rebook at {{siteUrl}}",
  NO_SHOW: "BPA Vaccination: You missed your appointment ({{bookingRef}}). Please rebook at {{siteUrl}}",
  ANNOUNCEMENT: "{{message}}",
};

// ============================================================================
// Send SMS
// ============================================================================

/**
 * Send SMS using campaign templates
 * Integrates with existing BPA notification queue
 */
export async function sendCampaignSms(input: SendSmsInput): Promise<{
  success: boolean;
  logId?: number;
  error?: string;
}> {
  const normalizedPhone = normalizePhone(input.phone);

  // Get template (custom or default)
  let template = DEFAULT_TEMPLATES[input.templateCode];

  // Check for campaign-specific template
  const customTemplate = await prisma.campaignSmsTemplate.findFirst({
    where: {
      campaignId: input.campaignId,
      code: input.templateCode,
      isActive: true,
    },
  });

  if (customTemplate) {
    template = customTemplate.template;
  }

  if (!template) {
    return { success: false, error: `Template not found: ${input.templateCode}` };
  }

  // Interpolate variables
  const message = interpolateTemplate(template, input.variables);

  // Create SMS log entry
  const smsLog = await prisma.campaignSmsLog.create({
    data: {
      campaignId: input.campaignId,
      bookingId: input.bookingId,
      phone: normalizedPhone,
      templateCode: input.templateCode,
      message,
      status: "QUEUED",
    },
  });

  // Queue SMS for delivery
  try {
    await queueSmsDelivery(smsLog.id, normalizedPhone, message, {
      templateCode: input.templateCode,
      bookingId: input.bookingId,
    });
    return { success: true, logId: smsLog.id };
  } catch (error) {
    // Update log with error
    await prisma.campaignSmsLog.update({
      where: { id: smsLog.id },
      data: {
        status: "FAILED",
        errorMessage: (error as Error).message,
      },
    });
    return {
      success: false,
      logId: smsLog.id,
      error: (error as Error).message,
    };
  }
}

/**
 * Queue SMS for delivery using existing notification queue
 */
async function queueSmsDelivery(
  logId: number,
  phone: string,
  message: string,
  meta?: { templateCode?: string; bookingId?: number }
): Promise<void> {
  try {
    const { enqueueCampaignSmsMessage } = require("./campaign.smsQueue") as {
      enqueueCampaignSmsMessage: (
        p: string,
        m: string,
        meta?: { template?: string; campaignSmsLogId?: number; bookingId?: number }
      ) => Promise<boolean>;
    };

    const enqueued = await enqueueCampaignSmsMessage(phone, message, {
      template: meta?.templateCode || "CAMPAIGN_SMS",
      campaignSmsLogId: logId,
      bookingId: meta?.bookingId,
    });

    if (enqueued) {
      await prisma.campaignSmsLog.update({
        where: { id: logId },
        data: { status: "SENDING" },
      });
      return;
    }

    console.warn("[CampaignSms] Queue unavailable, attempting direct send");
    await sendSmsDirect(logId, phone, message);
  } catch (error) {
    console.warn("[CampaignSms] Queue error, attempting direct send", (error as Error)?.message);
    await sendSmsDirect(logId, phone, message);
  }
}

/**
 * Direct SMS sending (fallback when queue not available)
 */
async function sendSmsDirect(
  logId: number,
  phone: string,
  message: string
): Promise<void> {
  try {
    const { sendSms } = require("../../services/sms.service") as {
      sendSms: (
        p: string,
        m: string,
        c?: { campaignSmsLogId?: number }
      ) => Promise<{ success: boolean; messageId?: string; error?: string; provider?: string }>;
    };
    const result = await sendSms(phone, message, { campaignSmsLogId: logId });

    await prisma.campaignSmsLog.update({
      where: { id: logId },
      data: {
        status: result.success ? "SENT" : "FAILED",
        sentAt: result.success ? new Date() : null,
        externalId: result.messageId,
        provider: result.provider,
        errorMessage: result.error,
      },
    });

    if (result.success) {
      const { recordSmsCostOnLog } = require("./smsCostMonitoring.service") as {
        recordSmsCostOnLog: (id: number, d: { provider: string; message: string }) => Promise<void>;
      };
      await recordSmsCostOnLog(logId, { provider: result.provider ?? "unknown", message }).catch(() => undefined);
    }
  } catch (error) {
    if (process.env.NODE_ENV !== "production" && process.env.SMS_ALLOW_DEV_FAKE_SENT === "true") {
      console.log(`[DEV] SMS to ${phone}: ${message}`);
      await prisma.campaignSmsLog.update({
        where: { id: logId },
        data: {
          status: "SENT",
          sentAt: new Date(),
          externalId: `dev-${Date.now()}`,
          provider: "mock",
        },
      });
    } else {
      throw error;
    }
  }
}

// ============================================================================
// Booking Notification Helpers
// ============================================================================

/**
 * Send booking confirmation SMS
 */
export async function sendBookingConfirmation(bookingId: number): Promise<void> {
  const booking = await prisma.campaignBooking.findUnique({
    where: { id: bookingId },
    include: {
      campaign: true,
      location: true,
      slot: true,
      pets: true,
    },
  });

  if (!booking) return;

  if (booking.bookingMode === "ZONE_INTEREST" && !booking.locationId) {
    return sendZoneInterestConfirmation(bookingId);
  }

  if (!booking.location || !booking.slot) return;

  const petNames = booking.pets.map((p) => p.name).join(", ");
  const address = booking.ownerAddressJson as {
    district?: string;
    upazila?: string;
    fullAddress?: string;
  } | null;
  const areaName = [address?.upazila, address?.district].filter(Boolean).join(", ") || booking.location.name;
  const siteUrl = process.env.CAMPAIGN_LANDING_URL || process.env.CAMPAIGN_BASE_URL || "https://vaccine.bpa.org.bd";
  const verificationCode = generateVerificationCode(booking.qrToken);

  await sendCampaignSms({
    phone: booking.ownerPhone,
    templateCode: "BOOKING_CONFIRMED",
    campaignId: booking.campaignId,
    bookingId: booking.id,
    variables: {
      bookingRef: booking.bookingRef,
      verificationCode,
      catCount: String(booking.petCount),
      areaName,
      petName: petNames,
      date: formatDate(booking.bookingDate),
      location: booking.location.name,
      time: booking.slot.startTime,
      ownerName: booking.ownerName,
      claimUrl: `${siteUrl}/booking`,
    },
  });
}

export async function sendZoneInterestConfirmation(bookingId: number): Promise<void> {
  const booking = await prisma.campaignBooking.findUnique({
    where: { id: bookingId },
    include: { campaign: true, pets: true },
  });
  if (!booking) return;

  const siteUrl = process.env.CAMPAIGN_LANDING_URL || process.env.CAMPAIGN_BASE_URL || "https://vaccine.bpa.org.bd";
  const verificationCode = generateVerificationCode(booking.qrToken);
  const zoneName = booking.coverageZoneName ?? "Your zone";
  const bookingArea = booking.bookingArea ?? zoneName;

  await sendCampaignSms({
    phone: booking.ownerPhone,
    templateCode: "BOOKING_ZONE_INTEREST",
    campaignId: booking.campaignId,
    bookingId: booking.id,
    variables: {
      bookingRef: booking.bookingRef,
      verificationCode,
      catCount: String(booking.petCount),
      zoneName,
      bookingArea,
      claimUrl: `${siteUrl}/booking`,
      ownerName: booking.ownerName,
    },
  });
}

export async function sendVenueAssignmentSms(bookingId: number): Promise<void> {
  const booking = await prisma.campaignBooking.findUnique({
    where: { id: bookingId },
    include: { campaign: true, location: true, slot: true, pets: true },
  });
  if (!booking?.location || !booking.slot) return;

  const siteUrl = process.env.CAMPAIGN_LANDING_URL || process.env.CAMPAIGN_BASE_URL || "https://vaccine.bpa.org.bd";
  const verificationCode = generateVerificationCode(booking.qrToken);
  const bookingArea =
    booking.bookingArea ?? booking.coverageZoneName ?? booking.location.name;

  await sendCampaignSms({
    phone: booking.ownerPhone,
    templateCode: "VENUE_ASSIGNED",
    campaignId: booking.campaignId,
    bookingId: booking.id,
    variables: {
      bookingRef: booking.bookingRef,
      verificationCode,
      catCount: String(booking.petCount),
      bookingArea,
      date: formatDate(booking.bookingDate),
      location: booking.location.name,
      time: booking.slot.startTime,
      claimUrl: `${siteUrl}/booking`,
      ownerName: booking.ownerName,
    },
  });
}

/**
 * Send vaccination completion SMS with certificate link
 */
export async function sendVaccinationComplete(
  bookingId: number,
  certificateUrl: string
): Promise<void> {
  const booking = await prisma.campaignBooking.findUnique({
    where: { id: bookingId },
    include: {
      campaign: true,
      pets: {
        where: { vaccinationStatus: "COMPLETED" },
      },
    },
  });

  if (!booking) return;

  const petNames = booking.pets.map((p) => p.name).join(", ");

  await sendCampaignSms({
    phone: booking.ownerPhone,
    templateCode: "VACCINATION_COMPLETE",
    campaignId: booking.campaignId,
    bookingId: booking.id,
    variables: {
      petName: petNames,
      certUrl: certificateUrl,
      ownerName: booking.ownerName,
    },
  });
}

/**
 * Send cancellation SMS
 */
export async function sendBookingCancelled(bookingId: number): Promise<void> {
  const booking = await prisma.campaignBooking.findUnique({
    where: { id: bookingId },
    include: { campaign: true },
  });

  if (!booking) return;

  const siteUrl = process.env.CAMPAIGN_BASE_URL || "https://vaccine.bpa.org.bd";

  await sendCampaignSms({
    phone: booking.ownerPhone,
    templateCode: "BOOKING_CANCELLED",
    campaignId: booking.campaignId,
    bookingId: booking.id,
    variables: {
      bookingRef: booking.bookingRef,
      siteUrl,
      ownerName: booking.ownerName,
    },
  });
}

/**
 * Send no-show notification
 */
export async function sendNoShowNotification(bookingId: number): Promise<void> {
  const booking = await prisma.campaignBooking.findUnique({
    where: { id: bookingId },
    include: { campaign: true },
  });

  if (!booking) return;

  const siteUrl = process.env.CAMPAIGN_BASE_URL || "https://vaccine.bpa.org.bd";

  await sendCampaignSms({
    phone: booking.ownerPhone,
    templateCode: "NO_SHOW",
    campaignId: booking.campaignId,
    bookingId: booking.id,
    variables: {
      bookingRef: booking.bookingRef,
      siteUrl,
      ownerName: booking.ownerName,
    },
  });
}

// ============================================================================
// Reminder Scheduling
// ============================================================================

/**
 * Schedule reminder SMS for bookings
 * This should be called by a scheduled job
 */
export async function scheduleReminders(campaignId: number): Promise<number> {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const tomorrowEnd = new Date(tomorrow);
  tomorrowEnd.setHours(23, 59, 59, 999);

  // Find confirmed bookings for tomorrow
  const bookings = await prisma.campaignBooking.findMany({
    where: {
      campaignId,
      status: "CONFIRMED",
      bookingDate: {
        gte: tomorrow,
        lte: tomorrowEnd,
      },
    },
    include: {
      location: true,
      slot: true,
      pets: true,
      smsLogs: {
        where: { templateCode: "REMINDER_24H" },
      },
    },
  });

  let sentCount = 0;

  for (const booking of bookings) {
    // Skip if already sent 24h reminder
    if (booking.smsLogs.length > 0) continue;

    const petNames = booking.pets.map((p) => p.name).join(", ");

    await sendCampaignSms({
      phone: booking.ownerPhone,
      templateCode: "REMINDER_24H",
      campaignId: booking.campaignId,
      bookingId: booking.id,
      variables: {
        petName: petNames,
        time: booking.slot.startTime,
        location: booking.location.name,
        bookingRef: booking.bookingRef,
        date: formatDate(booking.bookingDate),
      },
    });

    sentCount++;
  }

  return sentCount;
}

/**
 * Send 2-hour reminders
 * Should be called every hour by a scheduled job
 */
export async function send2HourReminders(campaignId: number): Promise<number> {
  const now = new Date();
  const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  // Find bookings with slot starting in ~2 hours
  const bookings = await prisma.campaignBooking.findMany({
    where: {
      campaignId,
      status: "CONFIRMED",
      bookingDate: {
        gte: new Date(now.setHours(0, 0, 0, 0)),
        lte: new Date(now.setHours(23, 59, 59, 999)),
      },
    },
    include: {
      location: true,
      slot: true,
      pets: true,
      smsLogs: {
        where: { templateCode: "REMINDER_2H" },
      },
    },
  });

  let sentCount = 0;
  const currentHour = new Date().getHours();
  const currentMinute = new Date().getMinutes();

  for (const booking of bookings) {
    // Skip if already sent 2h reminder
    if (booking.smsLogs.length > 0) continue;

    // Check if slot starts in ~2 hours
    const [slotHour] = booking.slot.startTime.split(":").map(Number);
    const hourDiff = slotHour - currentHour;

    // Send if slot is 2-3 hours away
    if (hourDiff >= 2 && hourDiff <= 3) {
      const petNames = booking.pets.map((p) => p.name).join(", ");

      await sendCampaignSms({
        phone: booking.ownerPhone,
        templateCode: "REMINDER_2H",
        campaignId: booking.campaignId,
        bookingId: booking.id,
        variables: {
          petName: petNames,
          location: booking.location.name,
          bookingRef: booking.bookingRef,
        },
      });

      sentCount++;
    }
  }

  return sentCount;
}

// ============================================================================
// Template Management
// ============================================================================

/**
 * Create or update campaign SMS template
 */
export async function upsertSmsTemplate(
  campaignId: number,
  code: SmsTemplateCode,
  template: string
): Promise<void> {
  await prisma.campaignSmsTemplate.upsert({
    where: {
      campaignId_code: {
        campaignId,
        code,
      },
    },
    create: {
      campaignId,
      code,
      template,
    },
    update: {
      template,
      isActive: true,
    },
  });
}

/**
 * Get campaign SMS templates
 */
export async function getCampaignTemplates(campaignId: number) {
  const customTemplates = await prisma.campaignSmsTemplate.findMany({
    where: { campaignId },
  });

  const templates: Record<string, { template: string; isCustom: boolean }> = {};

  // Add defaults
  for (const [code, template] of Object.entries(DEFAULT_TEMPLATES)) {
    templates[code] = { template, isCustom: false };
  }

  // Override with custom
  for (const t of customTemplates) {
    templates[t.code] = { template: t.template, isCustom: true };
  }

  return templates;
}

// ============================================================================
// SMS Delivery Callback
// ============================================================================

/**
 * Handle SMS delivery status callback from provider
 */
export async function handleDeliveryCallback(
  externalId: string,
  status: "DELIVERED" | "FAILED",
  errorMessage?: string
): Promise<void> {
  await prisma.campaignSmsLog.updateMany({
    where: { externalId },
    data: {
      status: status === "DELIVERED" ? "DELIVERED" : "FAILED",
      deliveredAt: status === "DELIVERED" ? new Date() : null,
      errorMessage,
    },
  });
}

export default {
  sendCampaignSms,
  sendBookingConfirmation,
  sendVaccinationComplete,
  sendBookingCancelled,
  sendNoShowNotification,
  scheduleReminders,
  send2HourReminders,
  upsertSmsTemplate,
  getCampaignTemplates,
  handleDeliveryCallback,
};
