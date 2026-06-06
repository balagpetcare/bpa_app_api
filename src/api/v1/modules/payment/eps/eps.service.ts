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
import { normalizeCallbackRecord } from "./eps.utils";

const GATEWAY = "eps";

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
}> {
  const record = normalizeCallbackRecord(input.query, input.body);
  const merchantTransactionId =
    record.merchantTransactionId || record.MerchantTransactionId || "";
  const epsTransactionId =
    record.epsTransactionId || record.EPSTransactionId || record.EpsTransactionId;
  const customerOrderId = record.CustomerOrderId || record.customerOrderId || "";

  if (!merchantTransactionId && !epsTransactionId) {
    return { success: false, error: "Missing transaction identifiers" };
  }

  const verified = await verifyEpsTransaction({
    merchantTransactionId: merchantTransactionId || undefined,
    epsTransactionId: epsTransactionId || undefined,
    customerOrderId: customerOrderId || undefined,
  });

  const event = verified || parseEpsCallbackQuery(record);
  if (!event) {
    return { success: false, error: "Webhook verification failed" };
  }

  await upsertPaymentTransaction({
    transactionId: event.transactionId,
    gateway: GATEWAY,
    amount: event.amount,
    status: mapWebhookStatusToTransactionStatus(event.status),
    rawResponse: event.rawResponse ?? record,
  });

  return dispatchPaymentWebhook(toVerifiedPaymentEvent(event));
}

export async function handleEpsCallback(
  kind: "success" | "fail" | "cancel",
  query: Record<string, string>
): Promise<{
  success: boolean;
  redirectPath: string;
  bookingRef?: string;
  checkoutId?: string;
}> {
  const record = normalizeCallbackRecord(query);
  const result = await handleEpsWebhook({ query: record });

  const merchantTxn =
    record.merchantTransactionId || record.MerchantTransactionId || "";
  const checkoutId = record.ValueB || record.checkoutId || "";
  const bookingRef = record.CustomerOrderId || record.ref || "";

  const basePath =
    kind === "success"
      ? bookingRef
        ? `/book/payment/success?ref=${encodeURIComponent(bookingRef)}`
        : checkoutId
          ? `/book/success?checkoutId=${encodeURIComponent(checkoutId)}`
          : "/book/success"
      : kind === "cancel"
        ? checkoutId
          ? `/book/payment/failed?checkoutId=${encodeURIComponent(checkoutId)}&reason=cancelled`
          : "/book/payment/failed?reason=cancelled"
        : checkoutId
          ? `/book/payment/failed?checkoutId=${encodeURIComponent(checkoutId)}`
          : "/book/payment/failed";

  return {
    success: result.success,
    redirectPath: basePath,
    bookingRef: bookingRef || undefined,
    checkoutId: checkoutId || undefined,
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
