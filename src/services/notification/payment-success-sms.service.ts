/**
 * Idempotent post-payment booking confirmation SMS.
 * Triggered from backend fulfillment only — never from frontend pages.
 */

import prisma from "../../infrastructure/db/prismaClient";
import { CampaignCheckoutStatus, CampaignPaymentStatus, Prisma } from "@prisma/client";
import { formatDate, interpolateTemplate, normalizePhone } from "../../api/v1/modules/campaign/campaign.utils";
import { logCampaignAudit } from "../../api/v1/modules/campaign/campaign.service";
import { formatCampaignTimeLabel } from "../../api/v1/modules/campaign/slot.schedule";
import { sendSMS } from "../../shared/services/sms/sms.service";

const LOG_PREFIX = "[PAYMENT_SUCCESS_SMS]";

const PAYMENT_SUCCESS_MESSAGE_TEMPLATE = `Bangladesh Pet Association

Your vaccination booking is confirmed.

Booking Ref: {{bookingRef}}
Campaign: {{campaignName}}
Pet: {{petName}}
Date: {{appointmentDate}}

Thank you.`;

const ZONE_INTEREST_MESSAGE_TEMPLATE = `Bangladesh Pet Association

Your vaccination interest is registered.

Booking Ref: {{bookingRef}}
Campaign: {{campaignName}}
Pet: {{petName}}
Area: {{bookingArea}}

We will SMS your venue, date, and time before the campaign.

Thank you.`;

export type PaymentSuccessSmsResult =
  | { status: "sent"; bookingId: number; smsReference?: string }
  | { status: "skipped_duplicate"; bookingId: number; smsReference?: string | null }
  | { status: "skipped_not_eligible"; bookingId: number; reason: string }
  | { status: "failed"; bookingId: number; error: string };

type BookingWithRelations = Prisma.CampaignBookingGetPayload<{
  include: {
    campaign: true;
    location: true;
    slot: true;
    pets: true;
    checkoutSession: true;
  };
}>;

function formatPetNames(pets: Array<{ name: string }>, petCount: number): string {
  const names = pets.map((p) => p.name.trim()).filter(Boolean);
  if (names.length === 0) {
    return petCount === 1 ? "Your pet" : `${petCount} pets`;
  }
  if (names.length === 1) return names[0];
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;
}

function formatAppointmentDate(booking: BookingWithRelations): string {
  const dateLabel = formatDate(booking.bookingDate);
  if (booking.bookingMode === "ZONE_INTEREST" && booking.status === "PENDING_ASSIGNMENT") {
    return "To be assigned via SMS";
  }
  if (booking.slot?.startTime && booking.slot?.endTime) {
    const start = formatCampaignTimeLabel(booking.slot.startTime);
    const end = formatCampaignTimeLabel(booking.slot.endTime);
    const session = booking.slot.sessionName?.trim();
    return session ? `${dateLabel} · ${session} · ${start}–${end}` : `${dateLabel} · ${start}–${end}`;
  }
  if (booking.location?.name) {
    return `${dateLabel} · ${booking.location.name}`;
  }
  return dateLabel;
}

function isZoneInterestPending(booking: BookingWithRelations): boolean {
  return booking.bookingMode === "ZONE_INTEREST" && booking.status === "PENDING_ASSIGNMENT";
}

function buildMessage(booking: BookingWithRelations): string {
  const variables = {
    bookingRef: booking.bookingRef,
    campaignName: booking.campaign.name,
    petName: formatPetNames(booking.pets, booking.petCount),
    appointmentDate: formatAppointmentDate(booking),
    bookingArea: booking.bookingArea || booking.coverageZoneName || "Your area",
  };

  const template = isZoneInterestPending(booking)
    ? ZONE_INTEREST_MESSAGE_TEMPLATE
    : PAYMENT_SUCCESS_MESSAGE_TEMPLATE;

  return interpolateTemplate(template, variables);
}

function isPaidAndFulfilled(booking: BookingWithRelations): { ok: true } | { ok: false; reason: string } {
  const paidStatuses: CampaignPaymentStatus[] = ["COMPLETED", "NOT_REQUIRED"];
  if (!paidStatuses.includes(booking.paymentStatus)) {
    return { ok: false, reason: `payment_status_${booking.paymentStatus}` };
  }

  if (booking.checkoutSessionId) {
    if (!booking.checkoutSession) {
      return { ok: false, reason: "checkout_session_missing" };
    }
    if (booking.checkoutSession.status !== CampaignCheckoutStatus.FULFILLED) {
      return { ok: false, reason: `checkout_status_${booking.checkoutSession.status}` };
    }
  }

  return { ok: true };
}

async function loadBooking(bookingId: number): Promise<BookingWithRelations | null> {
  return prisma.campaignBooking.findUnique({
    where: { id: bookingId },
    include: {
      campaign: true,
      location: true,
      slot: true,
      pets: true,
      checkoutSession: true,
    },
  });
}

/**
 * Send payment-success SMS exactly once per booking when paid + checkout fulfilled.
 * Safe under callback retries, webhook retries, and status polling (no frontend trigger).
 */
export async function dispatchPaymentSuccessSms(bookingId: number): Promise<PaymentSuccessSmsResult> {
  const booking = await loadBooking(bookingId);
  if (!booking) {
    return { status: "failed", bookingId, error: "booking_not_found" };
  }

  if (booking.smsSentAt) {
    console.info(LOG_PREFIX, {
      event: "skipped_duplicate",
      bookingId,
      checkoutId: booking.checkoutSessionId ?? undefined,
      phone: booking.ownerPhone,
      smsReference: booking.smsReference,
    });
    return {
      status: "skipped_duplicate",
      bookingId,
      smsReference: booking.smsReference,
    };
  }

  const eligibility = isPaidAndFulfilled(booking);
  if (eligibility.ok === false) {
    console.info(LOG_PREFIX, {
      event: "skipped_not_eligible",
      bookingId,
      checkoutId: booking.checkoutSessionId ?? undefined,
      phone: booking.ownerPhone,
      reason: eligibility.reason,
    });
    return { status: "skipped_not_eligible", bookingId, reason: eligibility.reason };
  }

  const claim = await prisma.campaignBooking.updateMany({
    where: { id: bookingId, smsSentAt: null },
    data: { smsSentAt: new Date() },
  });

  if (claim.count === 0) {
    const refreshed = await prisma.campaignBooking.findUnique({
      where: { id: bookingId },
      select: { smsReference: true },
    });
    console.info(LOG_PREFIX, {
      event: "skipped_duplicate_claim",
      bookingId,
      checkoutId: booking.checkoutSessionId ?? undefined,
      phone: booking.ownerPhone,
      smsReference: refreshed?.smsReference,
    });
    return {
      status: "skipped_duplicate",
      bookingId,
      smsReference: refreshed?.smsReference ?? null,
    };
  }

  const phone = normalizePhone(booking.ownerPhone);
  const message = buildMessage(booking);
  const templateCode = isZoneInterestPending(booking) ? "BOOKING_ZONE_INTEREST" : "PAYMENT_SUCCESS_SMS";

  try {
    const smsLog = await prisma.campaignSmsLog.create({
      data: {
        campaignId: booking.campaignId,
        bookingId: booking.id,
        phone,
        templateCode,
        message,
        status: "QUEUED",
      },
    });

    const gatewayResult = await sendSMS({
      phone,
      message,
      template: templateCode,
      meta: { campaignSmsLogId: smsLog.id, bookingId: booking.id },
    });

    await prisma.campaignSmsLog.update({
      where: { id: smsLog.id },
      data: {
        status: gatewayResult.success
          ? gatewayResult.queued
            ? "SENDING"
            : "SENT"
          : "FAILED",
        sentAt: gatewayResult.success && !gatewayResult.queued ? new Date() : null,
        externalId: gatewayResult.messageId,
        provider: gatewayResult.provider,
        errorMessage: gatewayResult.error,
      },
    });

    const sendResult = {
      success: gatewayResult.success,
      logId: smsLog.id,
      error: gatewayResult.error,
    };

    const smsReference =
      sendResult.logId != null ? `campaign_sms_log:${sendResult.logId}` : undefined;

    await prisma.campaignBooking.update({
      where: { id: bookingId },
      data: {
        smsReference: smsReference ?? (sendResult.success ? "queued" : "failed"),
      },
    });

    console.info(LOG_PREFIX, {
      event: sendResult.success ? "sent" : "send_failed",
      bookingId,
      checkoutId: booking.checkoutSessionId ?? undefined,
      phone,
      providerResponse: {
        success: sendResult.success,
        logId: sendResult.logId,
        error: sendResult.error,
      },
    });

    await logCampaignAudit({
      campaignId: booking.campaignId,
      action: sendResult.success ? "PAYMENT_SUCCESS_SMS_SENT" : "PAYMENT_SUCCESS_SMS_FAILED",
      entityType: "CampaignBooking",
      entityId: bookingId,
      afterJson: {
        checkoutSessionId: booking.checkoutSessionId,
        phone,
        smsReference,
        templateCode,
        success: sendResult.success,
        error: sendResult.error,
      },
    });

    if (!sendResult.success) {
      return {
        status: "failed",
        bookingId,
        error: sendResult.error || "sms_send_failed",
      };
    }

    return { status: "sent", bookingId, smsReference };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "sms_dispatch_error";
    await prisma.campaignBooking.update({
      where: { id: bookingId },
      data: { smsReference: `error:${errorMessage.slice(0, 48)}` },
    });

    console.error(LOG_PREFIX, {
      event: "exception",
      bookingId,
      checkoutId: booking.checkoutSessionId ?? undefined,
      phone,
      providerResponse: { error: errorMessage },
    });

    await logCampaignAudit({
      campaignId: booking.campaignId,
      action: "PAYMENT_SUCCESS_SMS_FAILED",
      entityType: "CampaignBooking",
      entityId: bookingId,
      afterJson: {
        checkoutSessionId: booking.checkoutSessionId,
        phone,
        error: errorMessage,
      },
    }).catch(() => undefined);

    return { status: "failed", bookingId, error: errorMessage };
  }
}

/** @internal */
export const __paymentSuccessSmsTestUtils = {
  buildMessage,
  formatAppointmentDate,
  formatPetNames,
  isPaidAndFulfilled,
  PAYMENT_SUCCESS_MESSAGE_TEMPLATE,
};
