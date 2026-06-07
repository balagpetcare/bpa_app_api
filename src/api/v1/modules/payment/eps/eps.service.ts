import type { VerifiedPaymentEvent } from "../../../providers/paymentProvider.types";
import {
  buildPaymentEventKey,
  isPaymentEventReplay,
  markPaymentEventProcessed,
} from "../../../providers/paymentReplay.guard";
import type { WebhookPayload } from "../../campaign/payment.service";
import {
  createPaymentTransaction,
  findPaymentTransactionByGatewayTx,
  mapWebhookStatusToTransactionStatus,
  updatePaymentTransaction,
  upsertPaymentTransaction,
} from "../paymentTransaction.service";
import { getEpsModuleConfig, isEpsModuleConfigured } from "./eps.config";
import {
  initializeEpsPayment,
  parseEpsCallbackQuery,
  verifyEpsTransaction,
} from "./eps.gateway";
import type { EpsInitiateInput, EpsInitiateResult } from "./eps.types";
import type { EpsVerifiedEvent } from "./eps.types";
import {
  logEpsRedirect,
  resolveEpsRedirectContext,
} from "./eps.redirectResolver";
import { buildEpsLandingRedirectPath } from "./eps.redirectPaths";
import { normalizeCallbackRecord } from "./eps.utils";
import prisma from "../../../../../infrastructure/db/prismaClient";

const GATEWAY = "eps";

function logEpsCallback(
  phase: string,
  details: Record<string, unknown>
): void {
  console.info(`[EPS callback] ${phase}`, details);
}

async function enrichCallbackEventFromOrder(event: EpsVerifiedEvent): Promise<EpsVerifiedEvent> {
  if (event.amount > 0) return event;

  const order = await prisma.order.findFirst({
    where: {
      OR: [
        { orderNumber: event.transactionId },
        { notes: { contains: event.transactionId } },
      ],
    },
    orderBy: { id: "desc" },
  });

  if (!order) return event;

  const amount = Number(order.totalAmount);
  if (!Number.isFinite(amount) || amount <= 0) return event;

  return {
    ...event,
    amount,
    rawResponse: {
      ...(event.rawResponse ?? {}),
      orderAmountEnriched: true,
      orderId: order.id,
    },
  };
}

function toVerifiedPaymentEvent(event: {
  provider: "eps";
  transactionId: string;
  providerTxId: string;
  status: "SUCCESS" | "FAILED" | "CANCELLED";
  amount: number;
  eventId: string;
  rawResponse?: Record<string, unknown>;
}): VerifiedPaymentEvent {
  return {
    provider: event.provider,
    transactionId: event.transactionId,
    providerTxId: event.providerTxId,
    status: event.status,
    amount: event.amount,
    eventId: event.eventId,
    rawResponse: event.rawResponse,
  };
}

export async function initiateEpsPayment(input: EpsInitiateInput): Promise<EpsInitiateResult> {
  if (!isEpsModuleConfigured()) {
    return { success: false, message: "EPS payment gateway is not configured" };
  }

  const merchantTransactionId =
    input.metadata?.merchantTransactionId?.trim() || input.referenceId;

  const existing = await findPaymentTransactionByGatewayTx(
    GATEWAY,
    merchantTransactionId
  );
  if (existing?.status === "SUCCESS") {
    return {
      success: false,
      message: "Payment already completed for this transaction",
      transactionId: existing.transactionId,
      paymentTransactionId: existing.id,
    };
  }

  const paymentTxId = existing
    ? existing.id
    : await createPaymentTransaction({
        bookingId: input.bookingId,
        transactionId: merchantTransactionId,
        gateway: GATEWAY,
        amount: input.amount,
        status: "PENDING",
      });

  const result = await initializeEpsPayment({
    amount: input.amount,
    currency: "BDT",
    referenceId: input.referenceId,
    returnUrl: input.returnUrl || getEpsModuleConfig().successUrl,
    cancelUrl: input.cancelUrl,
    metadata: {
      ...input.metadata,
      merchantTransactionId,
    },
  });

  if (!result.success) {
    await updatePaymentTransaction(paymentTxId, {
      status: "FAILED",
      rawResponse: { message: result.message },
    });
    return { success: false, message: result.message, paymentTransactionId: paymentTxId };
  }

  await updatePaymentTransaction(paymentTxId, {
    rawResponse: {
      redirectUrl: result.redirectUrl,
      providerPaymentId: result.providerPaymentId,
    },
  });

  return {
    success: true,
    paymentUrl: result.redirectUrl,
    transactionId: result.providerPaymentId || merchantTransactionId,
    merchantTransactionId,
    paymentTransactionId: paymentTxId,
  };
}

export async function validateEpsPayment(input: {
  merchantTransactionId?: string;
  epsTransactionId?: string;
  bookingId?: number;
}): Promise<{
  success: boolean;
  verified: boolean;
  status?: string;
  amount?: number;
  duplicate?: boolean;
  bookingId?: number;
  error?: string;
}> {
  const event = await verifyEpsTransaction({
    merchantTransactionId: input.merchantTransactionId,
    epsTransactionId: input.epsTransactionId,
  });

  if (!event) {
    return { success: false, verified: false, error: "EPS verification failed" };
  }

  const txnId = event.transactionId;
  const { id, duplicate } = await upsertPaymentTransaction({
    bookingId: input.bookingId,
    transactionId: txnId,
    gateway: GATEWAY,
    amount: event.amount,
    status: mapWebhookStatusToTransactionStatus(event.status),
    rawResponse: event.rawResponse,
  });

  if (duplicate && event.status === "SUCCESS") {
    const row = await findPaymentTransactionByGatewayTx(GATEWAY, txnId);
    if (row?.status === "SUCCESS") {
      return {
        success: true,
        verified: true,
        status: event.status,
        amount: event.amount,
        duplicate: true,
        bookingId: row.bookingId ?? undefined,
      };
    }
  }

  await updatePaymentTransaction(id, {
    status: mapWebhookStatusToTransactionStatus(event.status),
    bookingId: input.bookingId,
    rawResponse: event.rawResponse,
  });

  return {
    success: event.status === "SUCCESS",
    verified: true,
    status: event.status,
    amount: event.amount,
    duplicate,
    bookingId: input.bookingId,
  };
}

async function dispatchPaymentWebhook(event: VerifiedPaymentEvent) {
  const eventKey = buildPaymentEventKey(event.provider, event.eventId);
  if (await isPaymentEventReplay(eventKey)) {
    return { success: true, duplicate: true, replay: true };
  }

  const payload: WebhookPayload = {
    provider: event.provider,
    transactionId: event.transactionId,
    status: event.status,
    amount: event.amount,
    metadata: {
      providerTxId: event.providerTxId,
      eventId: event.eventId,
      ...(typeof event.rawResponse?.CustomerOrderId === "string"
        ? { customerOrderId: event.rawResponse.CustomerOrderId }
        : {}),
    },
  };

  const { processPaymentWebhook } = require("../../campaign/payment.service") as {
    processPaymentWebhook: (p: WebhookPayload) => Promise<{
      success: boolean;
      bookingId?: number;
      duplicate?: boolean;
    }>;
  };

  const result = await processPaymentWebhook(payload);
  if (result.success) {
    await markPaymentEventProcessed(eventKey);
    if (result.bookingId) {
      await upsertPaymentTransaction({
        bookingId: result.bookingId,
        transactionId: event.transactionId,
        gateway: GATEWAY,
        amount: event.amount,
        status: mapWebhookStatusToTransactionStatus(event.status),
        rawResponse: { event },
      });
    }
  }

  return result;
}

export async function handleEpsWebhook(input: {
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}): Promise<{
  success: boolean;
  duplicate?: boolean;
  bookingId?: number;
  error?: string;
  verifySource?: "api" | "callback_fallback";
}> {
  const record = normalizeCallbackRecord(input.query, input.body);
  const merchantTransactionId =
    record.merchantTransactionId || record.MerchantTransactionId || "";
  const epsTransactionId =
    record.epsTransactionId || record.EPSTransactionId || record.EpsTransactionId;
  const customerOrderId = record.CustomerOrderId || record.customerOrderId || "";

  if (!merchantTransactionId && !epsTransactionId) {
    logEpsCallback("reject", { reason: "missing_transaction_ids", record });
    return { success: false, error: "Missing transaction identifiers" };
  }

  logEpsCallback("verify_start", {
    merchantTransactionId,
    epsTransactionId,
    status: record.Status || record.status,
  });

  const verified = await verifyEpsTransaction({
    merchantTransactionId: merchantTransactionId || undefined,
    epsTransactionId: epsTransactionId || undefined,
    customerOrderId: customerOrderId || undefined,
  });

  let verifySource: "api" | "callback_fallback" = verified ? "api" : "callback_fallback";
  let event = verified || parseEpsCallbackQuery(record);

  if (!event) {
    logEpsCallback("reject", {
      reason: "verification_failed",
      merchantTransactionId,
      epsTransactionId,
    });
    return { success: false, error: "Webhook verification failed" };
  }

  if (!verified) {
    logEpsCallback("verify_fallback", {
      merchantTransactionId,
      epsTransactionId,
      transactionId: event.transactionId,
      status: event.status,
    });
  }

  event = await enrichCallbackEventFromOrder(event);

  await upsertPaymentTransaction({
    transactionId: event.transactionId,
    gateway: GATEWAY,
    amount: event.amount,
    status: mapWebhookStatusToTransactionStatus(event.status),
    rawResponse: { ...(event.rawResponse ?? record), verifySource },
  });

  const result = await dispatchPaymentWebhook(toVerifiedPaymentEvent(event));

  logEpsCallback("webhook_done", {
    merchantTransactionId,
    transactionId: event.transactionId,
    success: result.success,
    duplicate: result.duplicate,
    bookingId: result.bookingId,
    verifySource,
  });

  return { ...result, verifySource };
}

export async function handleEpsCallback(
  kind: "success" | "fail" | "cancel",
  query: Record<string, string>
): Promise<{
  success: boolean;
  redirectPath: string;
  bookingRef?: string;
  checkoutId?: string;
  error?: string;
  verifySource?: "api" | "callback_fallback";
}> {
  const record = normalizeCallbackRecord(query);
  const merchantTxn =
    record.merchantTransactionId || record.MerchantTransactionId || "";

  logEpsCallback("browser_callback", {
    kind,
    merchantTransactionId: merchantTxn,
    epsTransactionId: record.EPSTransactionId || record.epsTransactionId,
    status: record.Status || record.status,
  });

  const redirectCtx = merchantTxn ? await resolveEpsRedirectContext(merchantTxn) : {};

  const result = await handleEpsWebhook({ query: record });

  let checkoutId =
    record.ValueB || record.checkoutId || redirectCtx.checkoutId || "";
  let bookingRef = record.ref || redirectCtx.bookingRef || "";

  const customerOrderId = String(
    record.CustomerOrderId || record.customerOrderId || ""
  ).trim();
  if (!bookingRef && customerOrderId && /^CAMP-/i.test(customerOrderId)) {
    bookingRef = customerOrderId.replace(/^CAMP-/i, "");
  }

  if (kind === "success" && result.bookingId) {
    const booking = await prisma.campaignBooking.findUnique({
      where: { id: result.bookingId },
      select: { checkoutSessionId: true, bookingRef: true },
    });
    if (!checkoutId && booking?.checkoutSessionId) {
      checkoutId = booking.checkoutSessionId;
      logEpsCallback("redirect_from_fulfilled_booking", {
        bookingId: result.bookingId,
        checkoutId,
      });
    }
    if (!bookingRef && booking?.bookingRef) {
      bookingRef = booking.bookingRef;
    }
  }

  if (kind === "success" && !checkoutId && merchantTxn) {
    const postCtx = await resolveEpsRedirectContext(merchantTxn);
    checkoutId = postCtx.checkoutId || checkoutId;
    bookingRef = bookingRef || postCtx.bookingRef || "";
  }

  if (kind === "success" && !checkoutId && !bookingRef) {
    logEpsCallback("redirect_refs_missing", {
      merchantTransactionId: merchantTxn,
      webhookSuccess: result.success,
      orderId: redirectCtx.orderId,
      bookingId: result.bookingId,
    });
  }

  const redirectPath = buildEpsLandingRedirectPath(kind, record, {
    ...redirectCtx,
    checkoutId,
    bookingRef,
  });

  logEpsRedirect("callback_redirect", {
    kind,
    merchantTransactionId: merchantTxn,
    checkoutId: checkoutId || undefined,
    bookingRef: bookingRef || undefined,
    redirectPath,
    webhookSuccess: result.success,
    bookingId: result.bookingId,
  });

  return {
    success: result.success,
    redirectPath,
    bookingRef: bookingRef || undefined,
    checkoutId: checkoutId || undefined,
    error: result.error,
    verifySource: result.verifySource,
  };
}

export function getEpsCallbackUrls() {
  const cfg = getEpsModuleConfig();
  return {
    success: cfg.successUrl,
    fail: cfg.failUrl,
    cancel: cfg.cancelUrl,
    callback: cfg.callbackUrl,
    baseUrl: cfg.baseUrl,
    webhook: cfg.callbackUrl,
  };
}
