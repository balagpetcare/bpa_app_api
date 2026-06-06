import type { VerifiedPaymentEvent } from "../providers/paymentProvider.types";
import {
  formatProviderNotConfiguredMessage,
  getActivePaymentProvider,
  isProviderConfigured,
  getPaymentWebhookSecret,
} from "../providers/paymentProvider.config";
import {
  buildPaymentEventKey,
  isPaymentEventReplay,
  markPaymentEventProcessed,
} from "../providers/paymentReplay.guard";
import type { WebhookPayload } from "../modules/campaign/payment.service";
import { getActivePaymentStrategy } from "./paymentProvider.registry";
import {
  logPaymentTransaction,
  updatePaymentTransactionLog,
} from "./paymentTransaction.service";
import { createPaymentTransaction } from "../modules/payment/paymentTransaction.service";
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  VerifyPaymentInput,
  VerifyPaymentResult,
  WebhookHandleInput,
  WebhookHandleResult,
} from "./payment.types";

function assertWebhookSecret(headers?: Record<string, string | string[] | undefined>): boolean {
  const secret = getPaymentWebhookSecret();
  if (!secret) return true;

  const provided =
    headers?.["x-payment-webhook-secret"] ||
    headers?.["x-campaign-payment-secret"] ||
    headers?.["x-payment-secret"];

  if (Array.isArray(provided)) return provided[0] === secret;
  return provided === secret;
}

async function dispatchVerifiedEvent(event: VerifiedPaymentEvent): Promise<WebhookHandleResult> {
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

  const { processPaymentWebhook } = require("../modules/campaign/payment.service") as {
    processPaymentWebhook: (p: WebhookPayload) => Promise<{
      success: boolean;
      bookingId?: number;
      duplicate?: boolean;
    }>;
  };

  const result = await processPaymentWebhook(payload);
  if (result.success) {
    await markPaymentEventProcessed(eventKey);
  }

  return {
    success: result.success,
    duplicate: result.duplicate,
    bookingId: result.bookingId,
  };
}

export async function createUnifiedPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
  const provider = getActivePaymentProvider();
  if (!isProviderConfigured(provider)) {
    const message = formatProviderNotConfiguredMessage(provider);
    return {
      success: false,
      message,
      provider,
    };
  }

  const strategy = getActivePaymentStrategy();

  const logId = await logPaymentTransaction({
    orderId: input.orderId,
    provider,
    referenceId: input.referenceId,
    phase: "CREATE",
    status: "PENDING",
    amount: input.amount,
    idempotencyKey: input.idempotencyKey,
    requestJson: {
      amount: input.amount,
      currency: input.currency,
      referenceId: input.referenceId,
    },
  });

  try {
    const result = await strategy.createPayment(input);

    if (result.success) {
      await updatePaymentTransactionLog(logId, {
        status: "SUCCESS",
        providerTxId: result.providerPaymentId,
        responseJson: {
          redirectUrl: result.redirectUrl,
          providerPaymentId: result.providerPaymentId,
          merchantTransactionId: result.metadata?.merchantTransactionId,
          customerOrderId: result.metadata?.customerOrderId ?? input.referenceId,
        },
      });
      if (provider === "eps" && result.providerPaymentId) {
        const txnId = await createPaymentTransaction({
          transactionId: result.providerPaymentId,
          gateway: "eps",
          amount: input.amount,
          status: "PENDING",
          rawResponse: {
            redirectUrl: result.redirectUrl,
            referenceId: input.referenceId,
          },
        }).catch(() => 0);
        return {
          ...result,
          provider,
          logId,
          paymentTransactionId: txnId || undefined,
        };
      }
      return {
        ...result,
        provider,
        logId,
      };
    }

    await updatePaymentTransactionLog(logId, {
      status: "FAILED",
      errorMessage: result.message || "Payment creation failed",
    });
    return {
      ...result,
      provider,
      logId,
    };
  } catch (error) {
    const message = (error as Error).message || "Payment creation failed";
    await updatePaymentTransactionLog(logId, {
      status: "FAILED",
      errorMessage: message,
    });
    return {
      success: false,
      message,
      provider,
      logId,
    };
  }
}

export async function verifyUnifiedPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
  const strategy = getActivePaymentStrategy();
  const provider = strategy.code;

  const logId = await logPaymentTransaction({
    provider,
    referenceId: input.referenceId,
    providerTxId: input.providerTxId,
    phase: "VERIFY",
    status: "PENDING",
    requestJson: {
      referenceId: input.referenceId,
      providerTxId: input.providerTxId,
    },
  });

  try {
    const event = await strategy.verifyPayment(input);
    if (!event) {
      await updatePaymentTransactionLog(logId, {
        status: "FAILED",
        errorMessage: "Verification returned no event",
      });
      return {
        success: false,
        provider,
        error: "Payment could not be verified",
        logId,
      };
    }

    await updatePaymentTransactionLog(logId, {
      status: event.status === "SUCCESS" ? "SUCCESS" : "FAILED",
      providerTxId: event.providerTxId,
      eventId: event.eventId,
      responseJson: event as unknown as Record<string, unknown>,
    });

    if (event.status === "SUCCESS" || event.status === "FAILED" || event.status === "CANCELLED") {
      await dispatchVerifiedEvent(event);
    }

    return {
      success: event.status === "SUCCESS",
      provider,
      event,
      logId,
    };
  } catch (error) {
    const message = (error as Error).message || "Verification failed";
    await updatePaymentTransactionLog(logId, {
      status: "FAILED",
      errorMessage: message,
    });
    return {
      success: false,
      provider,
      error: message,
      logId,
    };
  }
}

export async function handleUnifiedWebhook(input: WebhookHandleInput): Promise<WebhookHandleResult> {
  if (!assertWebhookSecret(input.headers)) {
    return { success: false, error: "Invalid webhook secret" };
  }

  const strategy = getActivePaymentStrategy();
  const provider = strategy.code;

  const logId = await logPaymentTransaction({
    provider,
    referenceId:
      String(input.query?.merchantInvoiceNumber || input.query?.merchantInvoice || "") ||
      String((input.body?.tran_id as string) || (input.body?.mer_txnid as string) || "unknown"),
    phase: "WEBHOOK",
    status: "PENDING",
    requestJson: {
      query: input.query,
      bodyKeys: input.body ? Object.keys(input.body) : [],
    },
  });

  try {
    const event = await strategy.handleWebhook(input);
    if (!event) {
      await updatePaymentTransactionLog(logId, {
        status: "FAILED",
        errorMessage: "Webhook validation failed or empty event",
      });
      return { success: false, error: "Invalid or unverified webhook payload" };
    }

    await updatePaymentTransactionLog(logId, {
      status: event.status === "SUCCESS" ? "SUCCESS" : "FAILED",
      referenceId: event.transactionId,
      providerTxId: event.providerTxId,
      eventId: event.eventId,
      amount: event.amount,
      responseJson: event as unknown as Record<string, unknown>,
    });

    if (provider === "eps") {
      const { upsertPaymentTransaction, mapWebhookStatusToTransactionStatus } =
        require("../modules/payment/paymentTransaction.service") as typeof import("../modules/payment/paymentTransaction.service");
      await upsertPaymentTransaction({
        transactionId: event.transactionId,
        gateway: "eps",
        amount: event.amount,
        status: mapWebhookStatusToTransactionStatus(event.status),
        rawResponse: event as unknown as Record<string, unknown>,
      }).catch(() => undefined);
    }

    const result = await dispatchVerifiedEvent(event);
    if (provider === "eps" && result.bookingId) {
      const { updatePaymentTransaction, findPaymentTransactionByGatewayTx } =
        require("../modules/payment/paymentTransaction.service") as typeof import("../modules/payment/paymentTransaction.service");
      const row = await findPaymentTransactionByGatewayTx("eps", event.transactionId);
      if (row) {
        await updatePaymentTransaction(row.id, { bookingId: result.bookingId }).catch(() => undefined);
      }
    }
    return { ...result };
  } catch (error) {
    const message = (error as Error).message || "Webhook processing failed";
    await updatePaymentTransactionLog(logId, {
      status: "FAILED",
      errorMessage: message,
    });
    return { success: false, error: message };
  }
}

export { dispatchVerifiedEvent };
