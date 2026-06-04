/**
 * Booking claim — phone + booking ref + verification code (no OTP).
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { ClaimErrors } from "./campaign.errors";
import { normalizePhone, isValidBdPhone } from "./campaign.utils";
import { generateVerificationCode } from "./qr.service";
import { mapBookingRecordToDetails } from "./booking.service";
import type { BookingDetails } from "./campaign.types";

const CLAIM_RATE_WINDOW_MS = 15 * 60 * 1000;
const CLAIM_RATE_MAX = 5;

const claimAttempts = new Map<string, { count: number; resetAt: number }>();

function assertClaimRateLimit(key: string) {
  const now = Date.now();
  const entry = claimAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    claimAttempts.set(key, { count: 1, resetAt: now + CLAIM_RATE_WINDOW_MS });
    return;
  }
  entry.count += 1;
  if (entry.count > CLAIM_RATE_MAX) {
    throw ClaimErrors.RATE_LIMIT();
  }
}

function normalizeVerificationCode(code: string): string {
  return code.replace(/-/g, "").toUpperCase();
}

export type ClaimBookingInput = {
  phone: string;
  bookingRef: string;
  verificationCode: string;
};

export type ClaimBookingResult = BookingDetails & {
  verificationCode: string;
};

export async function claimBooking(input: ClaimBookingInput): Promise<ClaimBookingResult> {
  if (!isValidBdPhone(input.phone)) {
    throw ClaimErrors.INVALID();
  }

  const phone = normalizePhone(input.phone);
  const ref = input.bookingRef.trim().toUpperCase();
  assertClaimRateLimit(`${phone}:${ref}`);

  const booking = await prisma.campaignBooking.findUnique({
    where: { bookingRef: ref },
    include: {
      slot: true,
      location: true,
      pets: true,
    },
  });

  if (!booking) {
    throw ClaimErrors.INVALID();
  }

  if (normalizePhone(booking.ownerPhone) !== phone) {
    throw ClaimErrors.INVALID();
  }

  const expected = normalizeVerificationCode(generateVerificationCode(booking.qrToken));
  const provided = normalizeVerificationCode(input.verificationCode);

  if (expected !== provided) {
    await prisma.campaignAuditLog.create({
      data: {
        campaignId: booking.campaignId,
        action: "CLAIM_FAILED",
        entityType: "CampaignBooking",
        entityId: booking.id,
        afterJson: { bookingRef: ref },
      },
    });
    throw ClaimErrors.INVALID();
  }

  const details = mapBookingRecordToDetails(booking);
  const verificationCode = generateVerificationCode(booking.qrToken);

  return {
    ...details,
    verificationCode,
  };
}
