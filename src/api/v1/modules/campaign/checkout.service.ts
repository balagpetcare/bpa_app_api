/**
 * Simplified booking checkout — payment-first flow.
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { Prisma } from "@prisma/client";
import {
  AreaErrors,
  CheckoutErrors,
  ValidationErrors,
} from "./campaign.errors";
import {
  generateBookingRef,
  generateQrToken,
  isValidBdPhone,
  normalizePhone,
  startOfDay,
} from "./campaign.utils";
import { validateCampaignForBooking, logCampaignAudit } from "./campaign.service";
import { resolveCampaignId, checkAreaActive } from "./rollout.service";
import { getCampaignConfigOrNull } from "./config.service";
import { resolveAssignment, resolveAssignmentByLocation } from "./assignment.service";
import { LocationErrors } from "./campaign.errors";
import { computeCampaignPriceBreakdown } from "./campaignPricing.service";
import { validateCampaignCoupon } from "./campaignCoupon.service";
import { parseCheckoutSessionIdFromOrderNotes } from "./campaign.paymentGuards";
import { createCheckoutPaymentIntent } from "./payment.service";
import { sendBookingConfirmation } from "./sms.service";
import { generateVerificationCode } from "./qr.service";
import { resolveCityCorporationName } from "./bookingLocationDisplay.util";
import { assertMinimumPetCount } from "./petCount.util";
import type { BookingDetails } from "./campaign.types";
import { mapBookingRecordToDetails } from "./booking.service";
import { resolveCoverageForCampaignLocationId } from "./coverageLocation.service";
import {
  isZoneInterestAddress,
  resolveZoneInterestCoverage,
  type ZoneInterestCoverage,
} from "./zoneInterest.service";
import { resolveDhakaCorporationCoverage } from "./dhakaBooking.service";
import { sendZoneInterestConfirmation } from "./sms.service";
import { issueTicketsForBooking } from "./ticket.service";
import { getActivePaymentProvider } from "../../providers/paymentProvider.config";

const CHECKOUT_TTL_MINUTES = 30;
const CHECKOUT_RATE_WINDOW_MS = 60 * 60 * 1000;
const CHECKOUT_RATE_MAX = 3;

const checkoutAttempts = new Map<string, { count: number; resetAt: number }>();

/** Checkout session stores a legacy method label; gateway uses PAYMENT_PROVIDER via unified API. */
function defaultCheckoutPaymentMethod(): CheckoutInitInput["paymentMethod"] {
  const provider = getActivePaymentProvider();
  if (provider === "bkash") return "BKASH";
  if (provider === "nagad") return "NAGAD";
  if (provider === "eps") return "SSLCOMMERZ";
  return "SSLCOMMERZ";
}

export type CheckoutInitInput = {
  campaignSlug?: string;
  campaignId?: number;
  phone: string;
  alternatePhone?: string;
  locationId?: number;
  campaignLocationId?: number;
  coverageZoneId?: number;
  cityCorporationCode?: string;
  bdAreaId?: number;
  bookingArea?: string;
  slotId?: number;
  area?: {
    divisionId: number;
    districtId: number;
    upazilaId?: number;
    division?: string;
    district?: string;
    upazila?: string;
  };
  fullAddress?: string;
  catCount: number;
  couponCode?: string;
  paymentMethod?: "BKASH" | "NAGAD" | "CARD" | "SSLCOMMERZ";
  returnUrl?: string;
  cancelUrl?: string;
};

export type CheckoutInitResult = {
  checkoutId: string;
  amount: number;
  currency: string;
  requiresPayment: boolean;
  paymentUrl?: string;
  expiresAt: Date;
  bookingRef?: string;
  verificationCode?: string;
  booking?: BookingDetails;
};

function assertCheckoutRateLimit(phone: string) {
  const key = normalizePhone(phone);
  const now = Date.now();
  const entry = checkoutAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    checkoutAttempts.set(key, { count: 1, resetAt: now + CHECKOUT_RATE_WINDOW_MS });
    return;
  }
  entry.count += 1;
  if (entry.count > CHECKOUT_RATE_MAX) {
    throw CheckoutErrors.RATE_LIMIT();
  }
}

/** Reserve a booking row before EPS redirect — paymentStatus=PENDING until gateway confirms. */
async function createPendingBookingForCheckout(
  sessionId: string,
  input: {
    campaignId: number;
    ownerPhone: string;
    alternatePhone?: string | null;
    catCount: number;
    addressJson: Prisma.InputJsonValue;
    zoneInterest?: ZoneInterestCoverage | null;
  }
): Promise<number> {
  assertMinimumPetCount(input.catCount);

  let bookingRef = generateBookingRef();
  for (let i = 0; i < 10; i++) {
    const exists = await prisma.campaignBooking.findUnique({ where: { bookingRef } });
    if (!exists) break;
    bookingRef = generateBookingRef();
  }

  const address = input.addressJson as Record<string, unknown>;
  const isZoneInterest = input.zoneInterest != null || address.bookingMode === "ZONE_INTEREST";
  const existingUser = await prisma.userAuth.findFirst({
    where: { phone: input.ownerPhone },
    include: { user: true },
  });

  const booking = await prisma.campaignBooking.create({
    data: {
      bookingRef,
      qrToken: generateQrToken(),
      campaignId: input.campaignId,
      checkoutSessionId: sessionId,
      ownerUserId: existingUser?.user.id,
      ownerPhone: input.ownerPhone,
      ownerAlternatePhone: input.alternatePhone,
      ownerName: "Guest",
      ownerAddressJson: input.addressJson,
      bookingDate: startOfDay(new Date()),
      petCount: input.catCount,
      status: isZoneInterest ? "PENDING_ASSIGNMENT" : "DRAFT",
      paymentStatus: "PENDING",
      bookingMode: isZoneInterest ? "ZONE_INTEREST" : "VENUE",
      coverageZoneId: input.zoneInterest?.coverageZoneId ?? null,
      coverageZoneName: input.zoneInterest?.coverageZoneName ?? null,
      bdAreaId: input.zoneInterest?.bdAreaId ?? null,
      bookingArea: input.zoneInterest?.bookingArea ?? null,
      linkSource: existingUser ? "EXISTING_USER" : "EXPRESS_CHECKOUT",
      linkedAt: existingUser ? new Date() : null,
      metadataJson: { pendingPayment: true } as Prisma.InputJsonValue,
    },
  });

  await prisma.campaignCheckoutSession.update({
    where: { id: sessionId },
    data: { bookingId: booking.id },
  });

  return booking.id;
}

function buildAddressJson(
  input: CheckoutInitInput,
  location?: { id: number; name: string; address?: string | null },
  coverage?: {
    coverageZoneId?: number | null;
    coverageZoneName?: string | null;
    bdAreaId?: number | null;
    bookingArea?: string | null;
    bookingMode?: "VENUE" | "ZONE_INTEREST";
  }
) {
  const locId = input.locationId ?? input.campaignLocationId;
  const fullAddress =
    (input.fullAddress?.trim() || location?.address?.trim() || "").slice(0, 500) ||
    (location ? `${location.name}` : "");

  if (coverage?.bookingMode === "ZONE_INTEREST") {
    const corpCode = input.cityCorporationCode?.trim().toUpperCase();
    return {
      bookingMode: "ZONE_INTEREST",
      alternatePhone: input.alternatePhone ? normalizePhone(input.alternatePhone) : undefined,
      coverageZoneId: coverage.coverageZoneId ?? undefined,
      coverageZoneName: coverage.coverageZoneName ?? undefined,
      bdAreaId: coverage.bdAreaId ?? input.bdAreaId ?? undefined,
      bookingArea: (coverage.bookingArea ?? input.bookingArea)?.slice(0, 200) || undefined,
      cityCorporationCode: corpCode || undefined,
      cityCorporationName: corpCode ? resolveCityCorporationName(corpCode) : undefined,
      paymentMethod: input.paymentMethod ?? defaultCheckoutPaymentMethod(),
    };
  }

  return {
    fullAddress,
    alternatePhone: input.alternatePhone ? normalizePhone(input.alternatePhone) : undefined,
    bookingMode: "VENUE" as const,
    ...(locId
      ? {
          campaignLocationId: locId,
          locationId: locId,
          locationName: location?.name,
          locationAddress: location?.address ?? undefined,
          slotId: input.slotId ?? undefined,
          coverageZoneId: coverage?.coverageZoneId ?? input.coverageZoneId ?? undefined,
          coverageZoneName: coverage?.coverageZoneName ?? undefined,
          bdAreaId: coverage?.bdAreaId ?? input.bdAreaId ?? undefined,
          bookingArea: (coverage?.bookingArea ?? input.bookingArea)?.slice(0, 200) || undefined,
        }
      : {}),
    ...(input.area
      ? {
          divisionId: input.area.divisionId,
          districtId: input.area.districtId,
          upazilaId: input.area.upazilaId ?? null,
          division: input.area.division ?? "",
          district: input.area.district ?? "",
          upazila: input.area.upazila ?? "",
        }
      : {}),
  };
}

export async function initCheckout(input: CheckoutInitInput): Promise<CheckoutInitResult> {
  if (!isValidBdPhone(input.phone)) {
    throw ValidationErrors.INVALID_PHONE();
  }
  if (input.alternatePhone && !isValidBdPhone(input.alternatePhone)) {
    throw ValidationErrors.INVALID_INPUT("Invalid alternate phone number");
  }

  const ownerPhone = normalizePhone(input.phone);
  assertCheckoutRateLimit(ownerPhone);

  const campaignId = await resolveCampaignId({
    campaignId: input.campaignId,
    campaignSlug: input.campaignSlug,
  });
  const campaign = await validateCampaignForBooking(campaignId);

  // Check campaign config booking / payment rules
  const configRow = await getCampaignConfigOrNull(campaignId);
  if (configRow) {
    if (!configRow.bookingEnabled) {
      throw ValidationErrors.INVALID_INPUT("Booking is currently disabled for this campaign");
    }
    if (campaign.pricingType !== "FREE" && !configRow.onlinePaymentEnabled && !configRow.payAtVenueEnabled) {
      throw ValidationErrors.INVALID_INPUT("No payment method available — booking disabled");
    }
  }

  const maxCats = configRow?.maxCatsPerBooking ?? campaign.maxPetsPerBooking;
  assertMinimumPetCount(input.catCount);
  if (input.catCount > maxCats) {
    throw ValidationErrors.INVALID_INPUT(
      `Cat count must be between 1 and ${maxCats}`
    );
  }

  const locationId = input.locationId ?? input.campaignLocationId;

  let assignment: Awaited<ReturnType<typeof resolveAssignmentByLocation>> | undefined;
  let locationRecord: { id: number; name: string; address: string | null } | undefined;
  let coverageZoneId: number | null = input.coverageZoneId ?? null;
  let bookingArea: string | null = input.bookingArea?.trim() || null;
  let zoneInterest: ZoneInterestCoverage | null = null;

  if (locationId) {
    const loc = await prisma.campaignLocation.findFirst({
      where: { id: locationId, campaignId, isActive: true },
      select: { id: true, name: true, address: true },
    });
    if (!loc) {
      throw LocationErrors.NOT_FOUND(locationId);
    }
    locationRecord = loc;

    const resolved = await resolveCoverageForCampaignLocationId(locationId, campaignId);
    if (!coverageZoneId && resolved.coverageZoneId) coverageZoneId = resolved.coverageZoneId;
    if (!bookingArea && resolved.bookingArea) bookingArea = resolved.bookingArea;

    assignment = await resolveAssignmentByLocation({
      campaignId,
      locationId,
      slotId: input.slotId,
      minAdvanceHours: campaign.minAdvanceHours,
      advanceBookingDays: campaign.advanceBookingDays,
    });
  } else if (input.area) {
    const areaCheck = await checkAreaActive(
      campaignId,
      input.area.divisionId,
      input.area.districtId,
      input.area.upazilaId
    );
    if (!areaCheck.canBook) {
      throw AreaErrors.NOT_OPEN();
    }

    assignment = await resolveAssignment({
      campaignId,
      divisionId: input.area.divisionId,
      districtId: input.area.districtId,
      upazilaId: input.area.upazilaId,
      minAdvanceHours: campaign.minAdvanceHours,
      advanceBookingDays: campaign.advanceBookingDays,
    });
  } else if (input.cityCorporationCode && input.bdAreaId) {
    zoneInterest = await resolveDhakaCorporationCoverage({
      cityCorporationCode: input.cityCorporationCode,
      bdAreaId: input.bdAreaId,
    });
    coverageZoneId = zoneInterest.coverageZoneId;
    bookingArea = zoneInterest.bookingArea;
  } else if (input.coverageZoneId) {
    zoneInterest = await resolveZoneInterestCoverage({
      coverageZoneId: input.coverageZoneId,
      bdAreaId: input.bdAreaId,
      bookingArea: input.bookingArea,
    });
    coverageZoneId = zoneInterest.coverageZoneId;
    bookingArea = zoneInterest.bookingArea;
  } else {
    throw ValidationErrors.INVALID_INPUT("Select city corporation and area");
  }

  const region = assignment?.rolloutRegionId
    ? await prisma.campaignRolloutRegion.findUnique({
        where: { id: assignment.rolloutRegionId },
      })
    : null;

  if (region && region.targetCapacity > 0) {
    const remaining = region.targetCapacity - region.bookedCount;
    if (input.catCount > remaining) {
      throw AreaErrors.FULL();
    }
  }

  if (input.couponCode) {
    const couponCheck = validateCampaignCoupon(input.couponCode);
    if (couponCheck.ok === false) {
      throw ValidationErrors.INVALID_INPUT(couponCheck.error);
    }
  }

  const unitPrice = campaign.pricingType === "FREE" ? 0 : Number(campaign.priceAmount ?? 0);
  const pricing = computeCampaignPriceBreakdown({
    unitPrice,
    petCount: input.catCount,
    couponCode: input.couponCode,
  });

  const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MINUTES * 60 * 1000);
  const addressJson = buildAddressJson(
    input,
    locationRecord,
    zoneInterest
      ? {
          bookingMode: "ZONE_INTEREST",
          coverageZoneId: zoneInterest.coverageZoneId,
          coverageZoneName: zoneInterest.coverageZoneName,
          bdAreaId: zoneInterest.bdAreaId,
          bookingArea: zoneInterest.bookingArea,
        }
      : {
          bookingMode: "VENUE",
          coverageZoneId,
          bookingArea,
        }
  );

  const session = await prisma.campaignCheckoutSession.create({
    data: {
      campaignId,
      rolloutRegionId: assignment?.rolloutRegionId ?? null,
      ownerPhone,
      alternatePhone: input.alternatePhone ? normalizePhone(input.alternatePhone) : null,
      addressJson: addressJson as Prisma.InputJsonValue,
      catCount: input.catCount,
      couponCode: pricing.couponCode,
      paymentMethod: input.paymentMethod ?? defaultCheckoutPaymentMethod(),
      amount: pricing.total,
      status: "PENDING",
      expiresAt,
    },
  });

  if (pricing.total <= 0 || campaign.pricingType === "FREE") {
    await logCampaignAudit({
      campaignId,
      action: "CHECKOUT_INITIATED",
      entityType: "CampaignCheckoutSession",
      entityId: 0,
      afterJson: { checkoutSessionId: session.id, phone: ownerPhone, catCount: input.catCount },
    });
    return {
      checkoutId: session.id,
      amount: 0,
      currency: campaign.currency || "BDT",
      requiresPayment: false,
      expiresAt,
    };
  }

  const pendingBookingId = await createPendingBookingForCheckout(session.id, {
    campaignId,
    ownerPhone,
    alternatePhone: input.alternatePhone ? normalizePhone(input.alternatePhone) : null,
    catCount: input.catCount,
    addressJson: addressJson as Prisma.InputJsonValue,
    zoneInterest,
  });

  await logCampaignAudit({
    campaignId,
    action: "CHECKOUT_INITIATED",
    entityType: "CampaignCheckoutSession",
    entityId: 0,
    afterJson: {
      checkoutSessionId: session.id,
      phone: ownerPhone,
      catCount: input.catCount,
      pendingBookingId,
      paymentStatus: "PENDING",
    },
  });

  const landingBase = (process.env.CAMPAIGN_LANDING_URL || "").replace(/\/+$/, "");
  const returnBase = input.returnUrl ?? (landingBase ? `${landingBase}/book/success` : "/book/success");
  const returnUrl = `${returnBase}${returnBase.includes("?") ? "&" : "?"}checkoutId=${encodeURIComponent(session.id)}`;
  const cancelBase = input.cancelUrl ?? (landingBase ? `${landingBase}/book/payment/failed` : "/book/payment/failed");
  const cancelUrl = `${cancelBase}${cancelBase.includes("?") ? "&" : "?"}checkoutId=${encodeURIComponent(session.id)}`;

  const payment = await createCheckoutPaymentIntent({
    checkoutSessionId: session.id,
    method: input.paymentMethod ?? defaultCheckoutPaymentMethod(),
    amount: pricing.total,
    returnUrl,
    cancelUrl,
    customerPhone: ownerPhone,
    customerName: "Guest",
    campaignName: campaign.name,
    petCount: input.catCount,
    couponCode: pricing.couponCode ?? undefined,
    discount: pricing.discount > 0 ? pricing.discount : undefined,
  });

  if (!payment.success) {
    await prisma.campaignCheckoutSession.update({
      where: { id: session.id },
      data: { status: "FAILED" },
    });
    throw ValidationErrors.INVALID_INPUT(payment.error || "Payment could not be started");
  }

  return {
    checkoutId: session.id,
    amount: pricing.total,
    currency: campaign.currency || "BDT",
    requiresPayment: true,
    paymentUrl: payment.paymentUrl,
    expiresAt,
  };
}

export async function confirmFreeCheckout(checkoutId: string): Promise<CheckoutInitResult> {
  const session = await getValidCheckoutSession(checkoutId);
  const campaign = await prisma.campaign.findUnique({ where: { id: session.campaignId } });
  if (!campaign || campaign.pricingType !== "FREE") {
    if (Number(session.amount) > 0) {
      throw ValidationErrors.INVALID_INPUT("Payment required for this booking");
    }
  }

  const booking = await fulfillCheckoutSession(session.id);
  const verificationCode = generateVerificationCode(booking.qrToken);

  return {
    checkoutId: session.id,
    amount: 0,
    currency: campaign?.currency || "BDT",
    requiresPayment: false,
    expiresAt: session.expiresAt,
    bookingRef: booking.bookingRef,
    verificationCode,
    booking,
  };
}

export async function getCheckoutStatus(checkoutId: string) {
  const session = await prisma.campaignCheckoutSession.findUnique({
    where: { id: checkoutId },
  });

  if (!session) throw CheckoutErrors.NOT_FOUND();

  let bookingRecord = null;
  if (session.status === "FULFILLED" || session.bookingId) {
    bookingRecord = await prisma.campaignBooking.findFirst({
      where: {
        OR: [{ checkoutSessionId: checkoutId }, ...(session.bookingId ? [{ id: session.bookingId }] : [])],
      },
      include: {
        slot: true,
        location: true,
        pets: true,
      },
    });
  }

  let booking: BookingDetails | undefined;
  let verificationCode: string | undefined;

  if (bookingRecord) {
    booking = mapBookingRecordToDetails(bookingRecord);
    verificationCode = generateVerificationCode(bookingRecord.qrToken);
  }

  return {
    checkoutId: session.id,
    status: session.status,
    amount: Number(session.amount),
    expiresAt: session.expiresAt,
    bookingRef: bookingRecord?.bookingRef,
    verificationCode,
    booking,
  };
}

async function getValidCheckoutSession(checkoutId: string) {
  const session = await prisma.campaignCheckoutSession.findUnique({
    where: { id: checkoutId },
  });
  if (!session) throw CheckoutErrors.NOT_FOUND();
  if (session.status === "FULFILLED") throw CheckoutErrors.ALREADY_FULFILLED();
  if (session.status === "EXPIRED" || session.expiresAt < new Date()) {
    if (session.status === "PENDING") {
      await prisma.campaignCheckoutSession.update({
        where: { id: checkoutId },
        data: { status: "EXPIRED" },
      });
    }
    throw CheckoutErrors.EXPIRED();
  }
  return session;
}

export async function fulfillCheckoutSession(checkoutSessionId: string): Promise<BookingDetails> {
  const details = await prisma.$transaction(async (tx) => {
    const session = await tx.campaignCheckoutSession.findUnique({
      where: { id: checkoutSessionId },
      include: { campaign: true },
    });
    if (!session) throw CheckoutErrors.NOT_FOUND();
    if (session.status === "FULFILLED") {
      const existing = await tx.campaignBooking.findFirst({
        where: { checkoutSessionId },
        include: { slot: true, location: true, pets: true },
      });
      if (existing) return mapBookingRecordToDetails(existing);
      throw CheckoutErrors.ALREADY_FULFILLED();
    }
    if (session.expiresAt < new Date() && session.status === "PENDING") {
      throw CheckoutErrors.EXPIRED();
    }

    assertMinimumPetCount(session.catCount);

    const address = session.addressJson as Record<string, unknown> & {
      locationId?: number;
      campaignLocationId?: number;
      slotId?: number;
      coverageZoneId?: number;
      coverageZoneName?: string;
      bdAreaId?: number;
      bookingArea?: string;
      bookingMode?: string;
      divisionId?: number;
      districtId?: number;
      upazilaId?: number | null;
      fullAddress?: string;
    };

    if (isZoneInterestAddress(address)) {
      const coverageZoneId =
        typeof address.coverageZoneId === "number" && address.coverageZoneId > 0
          ? address.coverageZoneId
          : null;
      const coverageZoneName =
        typeof address.coverageZoneName === "string"
          ? address.coverageZoneName.trim().slice(0, 200)
          : null;
      const bdAreaId =
        typeof address.bdAreaId === "number" && address.bdAreaId > 0
          ? address.bdAreaId
          : null;
      const bookingArea =
        typeof address.bookingArea === "string" && address.bookingArea.trim()
          ? address.bookingArea.trim().slice(0, 200)
          : null;

      if (!coverageZoneId) {
        throw ValidationErrors.INVALID_INPUT("Coverage zone missing on checkout session");
      }

      const ownerPhone = session.ownerPhone;
      const existingUser = await tx.userAuth.findFirst({
        where: { phone: ownerPhone },
        include: { user: true },
      });

      const isFree =
        session.campaign.pricingType === "FREE" || Number(session.amount) <= 0;
      const placeholderDate = startOfDay(session.campaign.startDate);

      const pendingBooking = session.bookingId
        ? await tx.campaignBooking.findUnique({
            where: { id: session.bookingId },
            include: { pets: true },
          })
        : null;

      let booking;
      if (pendingBooking && pendingBooking.paymentStatus === "PENDING") {
        booking = await tx.campaignBooking.update({
          where: { id: pendingBooking.id },
          data: {
            locationId: null,
            slotId: null,
            bookingMode: "ZONE_INTEREST",
            rolloutRegionId: null,
            coverageZoneId,
            coverageZoneName,
            bdAreaId,
            bookingArea,
            bookingDate: placeholderDate,
            status: "PENDING_ASSIGNMENT",
            paymentStatus: isFree ? "NOT_REQUIRED" : "COMPLETED",
            paidAmount: isFree ? null : session.amount,
            paymentOrderId: session.orderId,
            metadataJson: { bookingMode: "ZONE_INTEREST" } as Prisma.InputJsonValue,
          },
          include: { pets: true },
        });
      } else {
        let bookingRef = generateBookingRef();
        for (let i = 0; i < 10; i++) {
          const exists = await tx.campaignBooking.findUnique({ where: { bookingRef } });
          if (!exists) break;
          bookingRef = generateBookingRef();
        }

        booking = await tx.campaignBooking.create({
          data: {
            bookingRef,
            qrToken: generateQrToken(),
            campaignId: session.campaignId,
            locationId: null,
            slotId: null,
            bookingMode: "ZONE_INTEREST",
            rolloutRegionId: null,
            coverageZoneId,
            coverageZoneName,
            bdAreaId,
            bookingArea,
            checkoutSessionId: session.id,
            ownerUserId: existingUser?.user.id,
            ownerPhone,
            ownerAlternatePhone: session.alternatePhone,
            ownerName: "Guest",
            ownerAddressJson: session.addressJson as Prisma.InputJsonValue,
            bookingDate: placeholderDate,
            petCount: session.catCount,
            status: "PENDING_ASSIGNMENT",
            paymentStatus: isFree ? "NOT_REQUIRED" : "COMPLETED",
            paidAmount: isFree ? null : session.amount,
            paymentOrderId: session.orderId,
            linkSource: existingUser ? "EXISTING_USER" : "EXPRESS_CHECKOUT",
            linkedAt: existingUser ? new Date() : null,
            metadataJson: { bookingMode: "ZONE_INTEREST" } as Prisma.InputJsonValue,
          },
          include: { pets: true },
        });
      }

      if (booking.pets.length < session.catCount) {
        await Promise.all(
          Array.from({ length: session.catCount - booking.pets.length }, (_, i) =>
            tx.campaignPet.create({
              data: {
                bookingId: booking.id,
                name: `Cat ${booking.pets.length + i + 1}`,
                animalTypeId: 2,
                gender: "UNKNOWN",
              },
            })
          )
        );
      }

      await tx.campaignCheckoutSession.update({
        where: { id: session.id },
        data: { status: "FULFILLED", bookingId: booking.id },
      });

      const withPets = await tx.campaignBooking.findUnique({
        where: { id: booking.id },
        include: { pets: true },
      });

      const details = mapBookingRecordToDetails({
        ...withPets!,
        slot: null,
        location: null,
        pets: withPets!.pets,
      });

      return details;
    }

    const checkoutLocationId = address.campaignLocationId ?? address.locationId;

    const assignment = checkoutLocationId
      ? await resolveAssignmentByLocation({
          campaignId: session.campaignId,
          locationId: checkoutLocationId,
          slotId: address.slotId,
          minAdvanceHours: session.campaign.minAdvanceHours,
          advanceBookingDays: session.campaign.advanceBookingDays,
        })
      : await resolveAssignment({
          campaignId: session.campaignId,
          divisionId: address.divisionId!,
          districtId: address.districtId!,
          upazilaId: address.upazilaId ?? undefined,
          minAdvanceHours: session.campaign.minAdvanceHours,
          advanceBookingDays: session.campaign.advanceBookingDays,
        });

    const region = await tx.campaignRolloutRegion.findUnique({
      where: { id: assignment.rolloutRegionId },
    });
    if (region && region.targetCapacity > 0) {
      const remaining = region.targetCapacity - region.bookedCount;
      if (session.catCount > remaining) throw AreaErrors.FULL();
    }

    const slot = await tx.campaignSlot.findUnique({ where: { id: assignment.slotId } });
    if (!slot || slot.bookedCount >= slot.capacity) {
      throw AreaErrors.NO_AVAILABILITY();
    }

    const ownerPhone = session.ownerPhone;
    const existingUser = await tx.userAuth.findFirst({
      where: { phone: ownerPhone },
      include: { user: true },
    });

    const isFree = session.campaign.pricingType === "FREE" || Number(session.amount) <= 0;

    const pendingBooking = session.bookingId
      ? await tx.campaignBooking.findUnique({
          where: { id: session.bookingId },
          include: { pets: true },
        })
      : null;

    const coverageZoneId =
      typeof address.coverageZoneId === "number" && address.coverageZoneId > 0
        ? address.coverageZoneId
        : null;
    const coverageZoneName =
      typeof address.coverageZoneName === "string"
        ? address.coverageZoneName.trim().slice(0, 200)
        : null;
    const bdAreaId =
      typeof address.bdAreaId === "number" && address.bdAreaId > 0
        ? address.bdAreaId
        : null;
    const bookingArea =
      typeof address.bookingArea === "string" && address.bookingArea.trim()
        ? address.bookingArea.trim().slice(0, 200)
        : null;

    let booking;
    let bookingRef: string;
    if (pendingBooking && pendingBooking.paymentStatus === "PENDING") {
      bookingRef = pendingBooking.bookingRef;
      booking = await tx.campaignBooking.update({
        where: { id: pendingBooking.id },
        data: {
          locationId: assignment.locationId,
          slotId: assignment.slotId,
          bookingMode: "VENUE",
          rolloutRegionId: assignment.rolloutRegionId,
          coverageZoneId,
          coverageZoneName,
          bdAreaId,
          bookingArea,
          bookingDate: assignment.slotDate,
          status: "CONFIRMED",
          paymentStatus: isFree ? "NOT_REQUIRED" : "COMPLETED",
          paidAmount: isFree ? null : session.amount,
          paymentOrderId: session.orderId,
        },
      });
    } else {
      bookingRef = generateBookingRef();
      for (let i = 0; i < 10; i++) {
        const exists = await tx.campaignBooking.findUnique({ where: { bookingRef } });
        if (!exists) break;
        bookingRef = generateBookingRef();
      }

      booking = await tx.campaignBooking.create({
        data: {
          bookingRef,
          qrToken: generateQrToken(),
          campaignId: session.campaignId,
          locationId: assignment.locationId,
          slotId: assignment.slotId,
          bookingMode: "VENUE",
          rolloutRegionId: assignment.rolloutRegionId,
          coverageZoneId,
          coverageZoneName,
          bdAreaId,
          bookingArea,
          checkoutSessionId: session.id,
          ownerUserId: existingUser?.user.id,
          ownerPhone,
          ownerAlternatePhone: session.alternatePhone,
          ownerName: "Guest",
          ownerAddressJson: session.addressJson as Prisma.InputJsonValue,
          bookingDate: assignment.slotDate,
          petCount: session.catCount,
          status: "CONFIRMED",
          paymentStatus: isFree ? "NOT_REQUIRED" : "COMPLETED",
          paidAmount: isFree ? null : session.amount,
          paymentOrderId: session.orderId,
          linkSource: existingUser ? "EXISTING_USER" : "EXPRESS_CHECKOUT",
          linkedAt: existingUser ? new Date() : null,
        },
      });
    }

    const existingPetCount = pendingBooking?.pets?.length ?? 0;
    const pets = await Promise.all(
      Array.from({ length: session.catCount - existingPetCount }, (_, i) =>
        tx.campaignPet.create({
          data: {
            bookingId: booking.id,
            name: `Cat ${existingPetCount + i + 1}`,
            animalTypeId: 2,
            gender: "UNKNOWN",
          },
        })
      )
    );
    const allPets =
      existingPetCount > 0 && pendingBooking
        ? [...pendingBooking.pets, ...pets]
        : pets.length > 0
          ? pets
          : await tx.campaignPet.findMany({ where: { bookingId: booking.id } });

    await tx.campaignSlot.update({
      where: { id: assignment.slotId },
      data: {
        bookedCount: { increment: 1 },
        status: slot.bookedCount + 1 >= slot.capacity ? "FULL" : "OPEN",
      },
    });

    if (region) {
      await tx.campaignRolloutRegion.update({
        where: { id: region.id },
        data: { bookedCount: { increment: session.catCount } },
      });
    }

    await tx.campaignCheckoutSession.update({
      where: { id: session.id },
      data: { status: "FULFILLED", bookingId: booking.id },
    });

    await tx.campaignAuditLog.create({
      data: {
        campaignId: session.campaignId,
        action: "BOOKING_CREATED",
        entityType: "CampaignBooking",
        entityId: booking.id,
        afterJson: {
          bookingRef,
          checkoutSessionId: session.id,
          expressFlow: true,
        } as Prisma.InputJsonValue,
      },
    });

    const location = await tx.campaignLocation.findUniqueOrThrow({
      where: { id: assignment.locationId },
    });

    const fullBooking = {
      ...booking,
      slot: { ...slot, startTime: assignment.startTime, endTime: assignment.endTime },
      location,
      pets: allPets,
    };

    return mapBookingRecordToDetails(fullBooking);
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5000,
    timeout: 15000,
  });
  return finalizeFulfilledBooking(details);
}

async function finalizeFulfilledBooking(details: BookingDetails): Promise<BookingDetails> {
  await issueTicketsForBooking(details.id);
  const refreshed = await prisma.campaignBooking.findFirst({
    where: { id: details.id },
    include: { slot: true, location: true, pets: true },
  });
  const mapped = refreshed ? mapBookingRecordToDetails(refreshed) : details;

  console.info("[checkout] finalize_booking", {
    bookingId: mapped.id,
    bookingRef: mapped.bookingRef,
    bookingMode: mapped.bookingMode,
  });

  if (mapped.bookingMode === "ZONE_INTEREST" && mapped.pendingAssignment) {
    console.info("[checkout] sms_dispatch", {
      bookingId: mapped.id,
      template: "ZONE_INTEREST",
    });
    sendZoneInterestConfirmation(mapped.id).catch((err) =>
      console.error("[checkout] sms_dispatch_failed", { bookingId: mapped.id, err: err?.message })
    );
  } else {
    console.info("[checkout] sms_dispatch", {
      bookingId: mapped.id,
      template: "PAYMENT_SUCCESS",
    });
    sendBookingConfirmation(mapped.id).catch((err) =>
      console.warn("[checkout] sms_dispatch_failed", { bookingId: mapped.id, err: err?.message })
    );
  }
  return mapped;
}

export async function fulfillCheckoutFromOrder(orderId: number): Promise<number | undefined> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order?.notes) return undefined;

  const checkoutSessionId = parseCheckoutSessionIdFromOrderNotes(order.notes);
  if (!checkoutSessionId) return undefined;

  const session = await prisma.campaignCheckoutSession.findUnique({
    where: { id: checkoutSessionId },
  });
  if (!session) return undefined;
  if (session.status === "FULFILLED") {
    return session.bookingId ?? undefined;
  }

  await prisma.campaignCheckoutSession.update({
    where: { id: checkoutSessionId },
    data: { status: "PAID", orderId },
  });

  const booking = await fulfillCheckoutSession(checkoutSessionId);
  return booking.id;
}

export async function expireStaleCheckoutSessions() {
  const result = await prisma.campaignCheckoutSession.updateMany({
    where: {
      status: "PENDING",
      expiresAt: { lt: new Date() },
    },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

export async function listCheckoutSessions(campaignId: number, limit = 100) {
  return prisma.campaignCheckoutSession.findMany({
    where: { campaignId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      ownerPhone: true,
      catCount: true,
      amount: true,
      status: true,
      createdAt: true,
      expiresAt: true,
      bookingId: true,
    },
  });
}
