/**
 * Campaign Payment Service
 * Integrates with existing BPA payment infrastructure
 * Supports: bKash, Nagad, SSLCommerz
 *
 * Reuses existing Order and OrderPayment models for payment tracking
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { Prisma, PaymentMethod } from "@prisma/client";
import { PaymentErrors } from "./campaign.errors";
import { logCampaignAudit } from "./campaign.service";
import { generateIdempotencyKey } from "./campaign.utils";
import {
  buildCampaignOrderNotes,
  buildCheckoutOrderNotes,
  parseCampaignBookingIdFromOrderNotes,
  parseCheckoutSessionIdFromOrderNotes,
  parseCouponCodeFromOrderNotes,
  parseIdempotencyKeyFromOrderNotes,
} from "./campaign.paymentGuards";
import { sendPaymentFailureSms } from "./sms.service";
import { dispatchPaymentSuccessSms } from "../../../../services/notification/payment-success-sms.service";
import { computeCampaignPriceBreakdown, amountsMatch } from "./campaignPricing.service";
import { validateCampaignCoupon } from "./campaignCoupon.service";
import {
  getActivePaymentProvider,
  getPaymentTimeoutMinutes,
  mapProviderToPaymentMethod,
} from "../../providers/paymentProvider.config";
import { createUnifiedPayment } from "../../payments/paymentOrchestrator.service";
import { getPaymentStrategy } from "../../payments/paymentProvider.registry";

// ============================================================================
// Types
// ============================================================================

export interface CreatePaymentIntentInput {
  bookingId: number;
  method: "BKASH" | "NAGAD" | "CARD" | "SSLCOMMERZ";
  returnUrl: string;
  cancelUrl?: string;
  /** Server-validated coupon; must match landing pricing */
  couponCode?: string;
}

export interface PaymentIntentResult {
  success: boolean;
  paymentUrl?: string;
  transactionId?: string;
  orderId?: number;
  error?: string;
}

export interface WebhookPayload {
  provider: string;
  transactionId: string;
  status: "SUCCESS" | "FAILED" | "CANCELLED";
  amount?: number;
  metadata?: Record<string, unknown>;
}

export interface ProcessRefundInput {
  bookingId: number;
  amount?: number;
  reason: string;
}

// ============================================================================
// Campaign payment branch (Order.branchId anchor)
// ============================================================================

/**
 * Resolves the branch used as `orders.branchId` for campaign checkout.
 * Not an EPS concern — missing branch triggers "Campaign payment setup not configured".
 */
export async function resolveCampaignPaymentBranch(campaign: { organizerId: number | null }) {
  const overrideRaw = process.env.CAMPAIGN_PAYMENT_BRANCH_ID?.trim();
  if (overrideRaw) {
    const overrideId = Number(overrideRaw);
    if (Number.isFinite(overrideId) && overrideId > 0) {
      const branch = await prisma.branch.findFirst({
        where: { id: overrideId, status: "ACTIVE" },
      });
      if (branch) return branch;
    }
  }

  if (campaign.organizerId) {
    const orgBranch = await prisma.branch.findFirst({
      where: { orgId: campaign.organizerId, status: "ACTIVE" },
      orderBy: { id: "asc" },
    });
    if (orgBranch) return orgBranch;
  }

  return prisma.branch.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { id: "asc" },
  });
}

const CAMPAIGN_PAYMENT_BRANCH_ERROR =
  "Campaign payment setup not configured: no ACTIVE branch found for campaign orders (seed a branch or set CAMPAIGN_PAYMENT_BRANCH_ID)";

// ============================================================================
// Payment Intent Creation
// ============================================================================

/**
 * Create payment intent for a booking
 * Uses idempotency key to prevent duplicate payments
 */
export async function createPaymentIntent(
  input: CreatePaymentIntentInput
): Promise<PaymentIntentResult> {
  const booking = await prisma.campaignBooking.findUnique({
    where: { id: input.bookingId },
    include: {
      campaign: true,
      pets: true,
    },
  });

  if (!booking) {
    return { success: false, error: "Booking not found" };
  }

  if (booking.paymentStatus === "COMPLETED") {
    throw PaymentErrors.ALREADY_PAID();
  }

  const campaign = booking.campaign;
  if (campaign.pricingType === "FREE") {
    return { success: false, error: "No payment required for free campaign" };
  }

  if (input.couponCode) {
    const couponCheck = validateCampaignCoupon(input.couponCode);
    if (couponCheck.ok === false) {
      return { success: false, error: couponCheck.error };
    }
  }

  const pricing = resolveCampaignBookingPaymentAmount(
    Number(campaign.priceAmount ?? 0),
    booking.petCount,
    input.couponCode
  );
  const amount = pricing.total;
  if (amount <= 0) {
    return { success: false, error: "Invalid payment amount" };
  }

  await expireStalePendingPayments(booking.id);

  const idempotencyKey = generateIdempotencyKey("campaign_payment", booking.id, booking.bookingRef);
  const orderNotesMarker = `campaign_booking:${booking.id}`;

  const existingOrder = await prisma.order.findFirst({
    where: {
      notes: { contains: orderNotesMarker },
      status: { notIn: ["CANCELLED"] },
    },
    orderBy: { id: "desc" },
  });

  if (existingOrder) {
    const storedKey = parseIdempotencyKeyFromOrderNotes(existingOrder.notes);
    if (storedKey && storedKey !== idempotencyKey) {
      console.warn("[CampaignPayment] Idempotency key mismatch for booking", booking.id);
    }

    const storedCoupon = parseCouponCodeFromOrderNotes(existingOrder.notes);
    const effectiveCoupon = input.couponCode || storedCoupon;
    const expectedBreakdown = resolveCampaignBookingPaymentAmount(
      Number(campaign.priceAmount ?? 0),
      booking.petCount,
      effectiveCoupon
    );
    const expectedTotal = expectedBreakdown.total;

    if (
      existingOrder.paymentStatus === "PENDING" &&
      !amountsMatch(Number(existingOrder.totalAmount), expectedTotal)
    ) {
      await prisma.order.update({
        where: { id: existingOrder.id },
        data: {
          totalAmount: expectedTotal,
          notes: buildCampaignOrderNotes(booking.id, idempotencyKey, {
            couponCode: effectiveCoupon,
            discount: expectedBreakdown.discount > 0 ? expectedBreakdown.discount : undefined,
          }),
        },
      });
      existingOrder.totalAmount = expectedTotal as unknown as typeof existingOrder.totalAmount;
    }

    if (booking.paymentStatus === "FAILED") {
      await prisma.campaignBooking.update({
        where: { id: booking.id },
        data: { paymentStatus: "PENDING" },
      });
      await prisma.order.update({
        where: { id: existingOrder.id },
        data: { paymentStatus: "PENDING", status: "PENDING" },
      });
    }

    if (existingOrder.paymentStatus === "COMPLETED") {
      await prisma.campaignBooking.update({
        where: { id: booking.id },
        data: {
          paymentStatus: "COMPLETED",
          paymentOrderId: existingOrder.id,
          paidAmount: existingOrder.totalAmount,
          status: booking.status === "DRAFT" ? "CONFIRMED" : booking.status,
        },
      });
      return {
        success: true,
        transactionId: existingOrder.orderNumber,
        orderId: existingOrder.id,
      };
    }

    const paymentResult = await initiateProviderPayment({
      orderId: existingOrder.id,
      orderNumber: existingOrder.orderNumber,
      amount: expectedTotal,
      currency: campaign.currency || "BDT",
      method: input.method,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
      customerPhone: booking.ownerPhone,
      customerName: booking.ownerName,
      description: `${campaign.name} - ${booking.petCount} pet(s)`,
    });

    return {
      success: paymentResult.success,
      paymentUrl: paymentResult.redirectUrl,
      orderId: existingOrder.id,
      transactionId: existingOrder.orderNumber,
      error: paymentResult.error,
    };
  }

  const defaultBranch = await resolveCampaignPaymentBranch(campaign);

  if (!defaultBranch) {
    return { success: false, error: CAMPAIGN_PAYMENT_BRANCH_ERROR };
  }

  const order = await prisma.$transaction(async (tx) => {
    const freshBooking = await tx.campaignBooking.findUnique({ where: { id: booking.id } });
    if (!freshBooking) throw new Error("Booking not found");
    if (freshBooking.paymentStatus === "COMPLETED") {
      throw PaymentErrors.ALREADY_PAID();
    }

    const duplicate = await tx.order.findFirst({
      where: {
        notes: { contains: orderNotesMarker },
        status: { notIn: ["CANCELLED"] },
      },
    });
    if (duplicate) return duplicate;

    const created = await tx.order.create({
      data: {
        orderNumber: `CAMP-${booking.bookingRef}`,
        branchId: defaultBranch.id,
        customerId: booking.ownerUserId,
        status: "PENDING",
        totalAmount: amount,
        paymentStatus: "PENDING",
        paymentMethod: mapPaymentMethod(input.method),
        notes: buildCampaignOrderNotes(booking.id, idempotencyKey, {
          couponCode: pricing.couponCode,
          discount: pricing.discount > 0 ? pricing.discount : undefined,
        }),
        orderSource: "ONLINE",
      },
    });

    await tx.campaignBooking.update({
      where: { id: booking.id },
      data: {
        paymentOrderId: created.id,
        paymentStatus: "PENDING",
      },
    });

    return created;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5000,
    timeout: 10000,
  });

  const paymentResult = await initiateProviderPayment({
    orderId: order.id,
    orderNumber: order.orderNumber,
    amount,
    currency: campaign.currency || "BDT",
    method: input.method,
    returnUrl: input.returnUrl,
    cancelUrl: input.cancelUrl,
    customerPhone: booking.ownerPhone,
    customerName: booking.ownerName,
    description: `${campaign.name} - ${booking.petCount} pet(s)`,
  });

  await logCampaignAudit({
    campaignId: booking.campaignId,
    action: "PAYMENT_INITIATED",
    entityType: "CampaignBooking",
    entityId: booking.id,
    afterJson: {
      orderId: order.id,
      amount,
      method: input.method,
      idempotencyKey,
    },
  });

  return {
    success: paymentResult.success,
    paymentUrl: paymentResult.redirectUrl,
    transactionId: order.orderNumber,
    orderId: order.id,
    error: paymentResult.error,
  };
}

export interface CreateCheckoutPaymentInput {
  checkoutSessionId: string;
  method: "BKASH" | "NAGAD" | "CARD" | "SSLCOMMERZ";
  amount: number;
  returnUrl: string;
  cancelUrl?: string;
  customerPhone: string;
  customerName: string;
  campaignName: string;
  petCount: number;
  couponCode?: string;
  discount?: number;
}

/**
 * Create payment intent for express checkout (no booking row yet).
 */
export async function createCheckoutPaymentIntent(
  input: CreateCheckoutPaymentInput
): Promise<PaymentIntentResult> {
  const session = await prisma.campaignCheckoutSession.findUnique({
    where: { id: input.checkoutSessionId },
    include: { campaign: true },
  });

  if (!session) {
    return { success: false, error: "Checkout session not found" };
  }

  if (session.status !== "PENDING") {
    return { success: false, error: "Checkout session is no longer valid" };
  }

  const campaign = session.campaign;
  const amount = input.amount;
  if (amount <= 0) {
    return { success: false, error: "Invalid payment amount" };
  }

  const idempotencyKey = generateIdempotencyKey(
    "campaign_checkout",
    session.id,
    session.ownerPhone
  );
  const orderNotesMarker = `campaign_checkout:${session.id}`;

  const existingOrder = await prisma.order.findFirst({
    where: {
      notes: { contains: orderNotesMarker },
      status: { notIn: ["CANCELLED"] },
    },
    orderBy: { id: "desc" },
  });

  if (existingOrder?.paymentStatus === "COMPLETED") {
    return {
      success: true,
      transactionId: existingOrder.orderNumber,
      orderId: existingOrder.id,
    };
  }

  const defaultBranch = await resolveCampaignPaymentBranch(campaign);

  if (!defaultBranch) {
    return { success: false, error: CAMPAIGN_PAYMENT_BRANCH_ERROR };
  }

  let order = existingOrder;

  if (!order) {
    order = await prisma.order.create({
      data: {
        orderNumber: `CKO-${session.id.slice(-8).toUpperCase()}`,
        branchId: defaultBranch.id,
        status: "PENDING",
        totalAmount: amount,
        paymentStatus: "PENDING",
        paymentMethod: mapPaymentMethod(input.method),
        notes: buildCheckoutOrderNotes(session.id, idempotencyKey, {
          couponCode: input.couponCode,
          discount: input.discount,
        }),
        orderSource: "ONLINE",
      },
    });

    await prisma.campaignCheckoutSession.update({
      where: { id: session.id },
      data: { orderId: order.id },
    });
  }

  const paymentResult = await initiateProviderPayment({
    orderId: order.id,
    orderNumber: order.orderNumber,
    amount,
    currency: campaign.currency || "BDT",
    method: input.method,
    returnUrl: input.returnUrl,
    cancelUrl: input.cancelUrl,
    customerPhone: input.customerPhone,
    customerName: input.customerName,
    description: `${input.campaignName} - ${input.petCount} cat(s)`,
    checkoutSessionId: input.checkoutSessionId,
  });

  await logCampaignAudit({
    campaignId: campaign.id,
    action: "CHECKOUT_PAYMENT_INITIATED",
    entityType: "CampaignCheckoutSession",
    entityId: 0,
    afterJson: { checkoutSessionId: session.id, orderId: order.id, amount },
  });

  return {
    success: paymentResult.success,
    paymentUrl: paymentResult.redirectUrl,
    transactionId: order.orderNumber,
    orderId: order.id,
    error: paymentResult.error,
  };
}

// ============================================================================
// Payment Provider Integration
// ============================================================================

interface ProviderPaymentInput {
  orderId: number;
  orderNumber: string;
  amount: number;
  currency: string;
  method: string;
  returnUrl: string;
  cancelUrl?: string;
  customerPhone: string;
  customerName: string;
  description: string;
  checkoutSessionId?: string;
}

async function initiateProviderPayment(
  input: ProviderPaymentInput
): Promise<{ success: boolean; redirectUrl?: string; error?: string }> {
  try {
    const result = await createUnifiedPayment({
      amount: input.amount,
      currency: input.currency,
      referenceId: input.orderNumber,
      orderId: input.orderId,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
      metadata: {
        orderId: String(input.orderId),
        phone: input.customerPhone,
        name: input.customerName,
        description: input.description,
        ...(input.checkoutSessionId
          ? { checkoutSessionId: input.checkoutSessionId }
          : {}),
      },
    });

    return {
      success: result.success,
      redirectUrl: result.redirectUrl,
      error: result.message,
    };
  } catch (error) {
    console.error("Payment initiation error:", error);
    return {
      success: false,
      error: (error as Error).message || "Payment initiation failed",
    };
  }
}

// ============================================================================
// Webhook Processing (Idempotent)
// ============================================================================

/**
 * Process payment webhook from provider
 * Idempotent: Safe to call multiple times with same data
 */
async function findOrderForPaymentWebhook(payload: WebhookPayload) {
  const customerOrderId =
    typeof payload.metadata?.customerOrderId === "string"
      ? payload.metadata.customerOrderId
      : undefined;

  const order = await prisma.order.findFirst({
    where: {
      OR: [
        { orderNumber: payload.transactionId },
        { notes: { contains: payload.transactionId } },
        ...(customerOrderId ? [{ orderNumber: customerOrderId }] : []),
      ],
    },
  });

  if (order || payload.provider !== "eps") {
    return order;
  }

  const log = await prisma.paymentTransactionLog.findFirst({
    where: {
      provider: "eps",
      OR: [
        { referenceId: payload.transactionId },
        { providerTxId: payload.transactionId },
        ...(typeof payload.metadata?.providerTxId === "string"
          ? [{ providerTxId: payload.metadata.providerTxId }]
          : []),
      ],
      orderId: { not: null },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!log?.orderId) return null;
  return prisma.order.findUnique({ where: { id: log.orderId } });
}

export async function processPaymentWebhook(
  payload: WebhookPayload
): Promise<{ success: boolean; bookingId?: number; duplicate?: boolean }> {
  const order = await findOrderForPaymentWebhook(payload);

  if (!order) {
    console.warn("Webhook: Order not found for transaction", payload.transactionId);
    return { success: false };
  }

  const bookingId = parseCampaignBookingIdFromOrderNotes(order.notes);
  const checkoutSessionId = parseCheckoutSessionIdFromOrderNotes(order.notes);

  if (order.paymentStatus === "COMPLETED" && payload.status === "SUCCESS") {
    if (checkoutSessionId) {
      const { fulfillCheckoutFromOrder } = await import("./checkout.service");
      const fulfilledId = await fulfillCheckoutFromOrder(order.id);
      return { success: true, bookingId: fulfilledId ?? bookingId ?? undefined, duplicate: true };
    }
    return { success: true, bookingId: bookingId ?? undefined, duplicate: true };
  }

  if (
    payload.status === "SUCCESS" &&
    payload.amount != null &&
    payload.amount > 0 &&
    !amountsMatch(payload.amount, Number(order.totalAmount))
  ) {
    console.error(
      "[CampaignPayment] Amount mismatch",
      payload.transactionId,
      payload.amount,
      order.totalAmount
    );
    return { success: false };
  }

  let confirmedBookingId: number | undefined;
  let fulfilledViaCheckout = false;

  await prisma.$transaction(async (tx) => {
    const lockedOrder = await tx.order.findUnique({ where: { id: order.id } });
    if (!lockedOrder) return;

    if (lockedOrder.paymentStatus === "COMPLETED" && payload.status === "SUCCESS") {
      confirmedBookingId = bookingId ?? undefined;
      return;
    }

    if (payload.status === "SUCCESS") {
      await tx.order.update({
        where: { id: lockedOrder.id },
        data: {
          paymentStatus: "COMPLETED",
          status: "DELIVERED",
        },
      });

      const existingPayment = await tx.orderPayment.findFirst({
        where: {
          orderId: lockedOrder.id,
          reference: payload.transactionId,
        },
      });

      if (!existingPayment) {
        await tx.orderPayment.create({
          data: {
            orderId: lockedOrder.id,
            method: lockedOrder.paymentMethod ?? "ONLINE",
            amount: lockedOrder.totalAmount,
            reference: payload.transactionId,
            paymentStatus: "PAID",
          },
        });
      }

      if (bookingId) {
        const booking = await tx.campaignBooking.findUnique({ where: { id: bookingId } });
        if (booking && booking.paymentStatus !== "COMPLETED") {
          await tx.campaignBooking.update({
            where: { id: bookingId },
            data: {
              paymentStatus: "COMPLETED",
              paidAmount: lockedOrder.totalAmount,
              status: booking.status === "DRAFT" ? "CONFIRMED" : booking.status,
            },
          });
          confirmedBookingId = bookingId;
        } else if (booking) {
          confirmedBookingId = bookingId;
        }
      }
    } else if (payload.status === "FAILED" || payload.status === "CANCELLED") {
      await tx.order.update({
        where: { id: lockedOrder.id },
        data: {
          paymentStatus: "FAILED",
          status: "CANCELLED",
        },
      });

      if (bookingId) {
        await tx.campaignBooking.updateMany({
          where: {
            id: bookingId,
            paymentStatus: { notIn: ["COMPLETED", "REFUNDED"] },
          },
          data: { paymentStatus: "FAILED" },
        });
      }
      if (checkoutSessionId) {
        await tx.campaignCheckoutSession.updateMany({
          where: { id: checkoutSessionId, status: { in: ["PENDING", "PAID"] } },
          data: { status: "FAILED" },
        });
      }
    }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5000,
    timeout: 10000,
  });

  if (
    payload.status === "SUCCESS" &&
    checkoutSessionId &&
    !confirmedBookingId &&
    !bookingId
  ) {
    console.info("[CampaignPayment] fulfill_checkout_start", {
      orderId: order.id,
      checkoutSessionId,
      transactionId: payload.transactionId,
    });
    const { fulfillCheckoutFromOrder } = await import("./checkout.service");
    const fulfilledId = await fulfillCheckoutFromOrder(order.id);
    if (fulfilledId) {
      confirmedBookingId = fulfilledId;
      fulfilledViaCheckout = true;
      console.info("[CampaignPayment] fulfill_checkout_done", {
        orderId: order.id,
        bookingId: fulfilledId,
        checkoutSessionId,
      });
    }
  }

  if (confirmedBookingId && payload.status === "SUCCESS") {
    if (!fulfilledViaCheckout) {
      console.info("[CampaignPayment] payment_success_sms_dispatch", {
        bookingId: confirmedBookingId,
        source: "payment_webhook",
      });
      dispatchPaymentSuccessSms(confirmedBookingId).catch((err) =>
        console.warn("[CampaignPayment] payment_success_sms_failed:", err?.message)
      );
    } else {
      console.info("[CampaignPayment] payment_success_sms_skip_webhook", {
        bookingId: confirmedBookingId,
        source: "checkout_finalize",
      });
    }

    const booking = await prisma.campaignBooking.findUnique({ where: { id: confirmedBookingId } });
    if (booking) {
      await logCampaignAudit({
        campaignId: booking.campaignId,
        action: "PAYMENT_COMPLETED",
        entityType: "CampaignBooking",
        entityId: confirmedBookingId,
        afterJson: {
          transactionId: payload.transactionId,
          status: payload.status,
          amount: payload.amount,
        },
      });
    }
  } else if (bookingId && payload.status !== "SUCCESS") {
    sendPaymentFailureSms(bookingId).catch((err) =>
      console.warn("[Campaign] payment failure SMS failed:", err?.message)
    );
    const booking = await prisma.campaignBooking.findUnique({ where: { id: bookingId } });
    if (booking) {
      await logCampaignAudit({
        campaignId: booking.campaignId,
        action: "PAYMENT_FAILED",
        entityType: "CampaignBooking",
        entityId: bookingId,
        afterJson: {
          transactionId: payload.transactionId,
          status: payload.status,
          amount: payload.amount,
        },
      });
    }
  }

  return { success: true, bookingId: confirmedBookingId ?? bookingId ?? undefined };
}

// ============================================================================
// Refund Processing
// ============================================================================

export async function processRefund(
  input: ProcessRefundInput
): Promise<{ success: boolean; refundId?: string; error?: string }> {
  const booking = await prisma.campaignBooking.findUnique({
    where: { id: input.bookingId },
    include: {
      campaign: true,
    },
  });

  if (!booking) {
    return { success: false, error: "Booking not found" };
  }

  if (booking.paymentStatus !== "COMPLETED") {
    return { success: false, error: "No payment to refund" };
  }

  if (booking.refundStatus === "COMPLETED") {
    return { success: false, error: "Already refunded" };
  }

  const refundAmount = input.amount ?? Number(booking.paidAmount ?? 0);

  await prisma.campaignBooking.update({
    where: { id: booking.id },
    data: {
      refundStatus: "PROCESSING",
      refundAmount,
    },
  });

  try {
    if (!booking.paymentOrderId) {
      throw new Error("Original payment order not found");
    }

    const order = await prisma.order.findUnique({
      where: { id: booking.paymentOrderId },
      include: { orderPayments: true },
    });

    if (!order) {
      throw new Error("Original order not found");
    }

    const payment = order.orderPayments[0];
    if (payment?.reference) {
      const provider = paymentMethodToProviderCode(order.paymentMethod ?? "");
      const strategy = getPaymentStrategy(provider);
      if (strategy.refund) {
        await strategy.refund({
          providerTxId: payment.reference,
          amount: refundAmount,
          reason: input.reason,
        });
      }
    }

    await prisma.campaignBooking.update({
      where: { id: booking.id },
      data: {
        refundStatus: "COMPLETED",
        paymentStatus: "REFUNDED",
      },
    });

    await logCampaignAudit({
      campaignId: booking.campaignId,
      action: "REFUND_COMPLETED",
      entityType: "CampaignBooking",
      entityId: booking.id,
      afterJson: {
        refundAmount,
        reason: input.reason,
      },
    });

    return { success: true };
  } catch (error) {
    await prisma.campaignBooking.update({
      where: { id: booking.id },
      data: { refundStatus: "FAILED" },
    });

    return {
      success: false,
      error: (error as Error).message || "Refund processing failed",
    };
  }
}

// ============================================================================
// Payment Status
// ============================================================================

export async function getPaymentStatus(bookingId: number) {
  const booking = await prisma.campaignBooking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      bookingRef: true,
      petCount: true,
      paymentStatus: true,
      paidAmount: true,
      paymentOrderId: true,
      refundStatus: true,
      refundAmount: true,
      campaign: {
        select: {
          pricingType: true,
          priceAmount: true,
        },
      },
    },
  });

  if (!booking) {
    return null;
  }

  const unitPrice = Number(booking.campaign.priceAmount ?? 0);
  let couponCode: string | null = null;
  if (booking.paymentOrderId) {
    const order = await prisma.order.findUnique({
      where: { id: booking.paymentOrderId },
      select: { notes: true, totalAmount: true },
    });
    couponCode = parseCouponCodeFromOrderNotes(order?.notes);
  }

  const pricing = resolveCampaignBookingPaymentAmount(unitPrice, booking.petCount, couponCode);

  return {
    bookingRef: booking.bookingRef,
    status: booking.paymentStatus,
    required: booking.campaign.pricingType !== "FREE",
    unitPrice,
    petCount: booking.petCount,
    subtotal: pricing.subtotal,
    discount: pricing.discount,
    couponCode: pricing.couponCode,
    amount: pricing.total,
    paidAmount: booking.paidAmount ? Number(booking.paidAmount) : 0,
    refundStatus: booking.refundStatus,
    refundAmount: booking.refundAmount ? Number(booking.refundAmount) : 0,
  };
}

// ============================================================================
// Pricing & timeout helpers
// ============================================================================

export function resolveCampaignBookingPaymentAmount(
  unitPrice: number,
  petCount: number,
  couponCode?: string | null
) {
  return computeCampaignPriceBreakdown({
    unitPrice,
    petCount,
    couponCode,
  });
}

async function expireStalePendingPayments(bookingId: number): Promise<void> {
  const timeoutMin = getPaymentTimeoutMinutes();
  const cutoff = new Date(Date.now() - timeoutMin * 60 * 1000);
  const marker = `campaign_booking:${bookingId}`;

  const stale = await prisma.order.findMany({
    where: {
      notes: { contains: marker },
      paymentStatus: "PENDING",
      status: "PENDING",
      createdAt: { lt: cutoff },
    },
  });

  for (const order of stale) {
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: "FAILED", status: "CANCELLED" },
      });
      await tx.campaignBooking.updateMany({
        where: {
          id: bookingId,
          paymentOrderId: order.id,
          paymentStatus: { notIn: ["COMPLETED", "REFUNDED"] },
        },
        data: { paymentStatus: "FAILED" },
      });
    });
  }
}

function mapPaymentMethod(_method?: string): PaymentMethod {
  return mapProviderToPaymentMethod(getActivePaymentProvider()) as PaymentMethod;
}

function paymentMethodToProviderCode(method: string) {
  switch (String(method).toUpperCase()) {
    case "BKASH":
      return "bkash" as const;
    case "NAGAD":
      return "nagad" as const;
    case "CARD":
      return "sslcommerz" as const;
    case "ONLINE":
      return "amarpay" as const;
    case "EPS":
      return "eps" as const;
    default:
      return getActivePaymentProvider();
  }
}

export default {
  createPaymentIntent,
  processPaymentWebhook,
  processRefund,
  getPaymentStatus,
};
