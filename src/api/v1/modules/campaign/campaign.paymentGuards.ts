import type { CampaignPaymentStatus, CampaignBookingStatus } from "@prisma/client";

const CHECK_IN_ELIGIBLE: CampaignBookingStatus[] = ["CONFIRMED", "CHECKED_IN", "IN_PROGRESS"];

export function isCampaignPaymentCleared(paymentStatus: CampaignPaymentStatus): boolean {
  return paymentStatus === "NOT_REQUIRED" || paymentStatus === "COMPLETED";
}

export function getBookingCheckInBlockReason(input: {
  status: CampaignBookingStatus;
  paymentStatus: CampaignPaymentStatus;
}): string | null {
  if (input.status === "CANCELLED") return "Booking was cancelled";
  if (input.status === "DRAFT") return "Payment required before check-in";
  if (input.paymentStatus === "PENDING") return "Payment required before check-in";
  if (input.paymentStatus === "FAILED") return "Payment failed — rebook or retry payment";
  if (!CHECK_IN_ELIGIBLE.includes(input.status) && input.status !== "COMPLETED") {
    return `Invalid booking status: ${input.status}`;
  }
  return null;
}

export function getVaccinationPaymentBlockReason(paymentStatus: CampaignPaymentStatus): string | null {
  if (!isCampaignPaymentCleared(paymentStatus)) {
    return "Payment must be completed before vaccination";
  }
  return null;
}

export function parseCampaignBookingIdFromOrderNotes(notes?: string | null): number | null {
  if (!notes) return null;
  const match = notes.match(/campaign_booking:(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

export function parseCheckoutSessionIdFromOrderNotes(notes?: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(/campaign_checkout:([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

export function buildCheckoutOrderNotes(
  checkoutSessionId: string,
  idempotencyKey: string,
  extras?: { couponCode?: string | null; discount?: number }
): string {
  let notes = `campaign_checkout:${checkoutSessionId}|idempotency:${idempotencyKey}`;
  if (extras?.couponCode) notes += `|coupon:${extras.couponCode.toUpperCase()}`;
  if (extras?.discount != null && extras.discount > 0) {
    notes += `|discount:${extras.discount}`;
  }
  return notes;
}

export function parseIdempotencyKeyFromOrderNotes(notes?: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(/idempotency:([a-f0-9]+)/i);
  return match ? match[1] : null;
}

export function parseCouponCodeFromOrderNotes(notes?: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(/coupon:([A-Z0-9_-]+)/i);
  return match ? match[1].toUpperCase() : null;
}

export function parseDiscountFromOrderNotes(notes?: string | null): number | null {
  if (!notes) return null;
  const match = notes.match(/discount:(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : null;
}

export function buildCampaignOrderNotes(
  bookingId: number,
  idempotencyKey: string,
  extras?: { couponCode?: string | null; discount?: number }
): string {
  let notes = `campaign_booking:${bookingId}|idempotency:${idempotencyKey}`;
  if (extras?.couponCode) notes += `|coupon:${extras.couponCode.toUpperCase()}`;
  if (extras?.discount != null && extras.discount > 0) {
    notes += `|discount:${extras.discount}`;
  }
  return notes;
}
