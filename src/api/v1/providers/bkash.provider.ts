import axios from "axios";
import {
  formatProviderNotConfiguredMessage,
  getBkashConfig,
  isBkashConfigured,
} from "./paymentProvider.config";
import type {
  PaymentIntentRequest,
  PaymentIntentResponse,
  PaymentRefundRequest,
  PaymentRefundResponse,
  VerifiedPaymentEvent,
} from "./paymentProvider.types";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  const cfg = getBkashConfig();
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const res = await axios.post(
    `${cfg.baseUrl}/tokenized/checkout/token/grant`,
    {
      app_key: cfg.appKey,
      app_secret: cfg.appSecret,
    },
    {
      headers: {
        "Content-Type": "application/json",
        username: cfg.username,
        password: cfg.password,
      },
      timeout: 15_000,
    }
  );

  const token = res.data?.id_token;
  if (!token) throw new Error("bKash token grant failed");
  const expiresIn = Number(res.data?.expires_in || 3600) * 1000;
  cachedToken = { token, expiresAt: Date.now() + expiresIn };
  return token;
}

export async function createIntent(req: PaymentIntentRequest): Promise<PaymentIntentResponse> {
  if (!isBkashConfigured()) {
    return { success: false, message: formatProviderNotConfiguredMessage("bkash") };
  }

  const cfg = getBkashConfig();
  const token = await getToken();

  const res = await axios.post(
    `${cfg.baseUrl}/tokenized/checkout/create`,
    {
      mode: "0011",
      payerReference: req.metadata?.phone || req.referenceId,
      callbackURL: cfg.callbackUrl,
      amount: String(req.amount),
      currency: req.currency || "BDT",
      intent: "sale",
      merchantInvoiceNumber: req.referenceId,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
        "X-APP-Key": cfg.appKey,
      },
      timeout: 20_000,
    }
  );

  const paymentID = res.data?.paymentID;
  const bkashURL = res.data?.bkashURL;
  if (!paymentID || !bkashURL) {
    return { success: false, message: res.data?.statusMessage || "bKash create payment failed" };
  }

  return {
    success: true,
    redirectUrl: bkashURL,
    providerPaymentId: paymentID,
  };
}

export async function executePayment(paymentId: string): Promise<VerifiedPaymentEvent | null> {
  if (!isBkashConfigured()) return null;
  const cfg = getBkashConfig();
  const token = await getToken();

  const res = await axios.post(
    `${cfg.baseUrl}/tokenized/checkout/execute`,
    { paymentID: paymentId },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
        "X-APP-Key": cfg.appKey,
      },
      timeout: 20_000,
    }
  );

  const statusCode = res.data?.statusCode;
  const trxId = res.data?.trxID || paymentId;
  const amount = parseFloat(res.data?.amount || "0");

  return {
    provider: "bkash",
    transactionId: res.data?.merchantInvoiceNumber || "",
    providerTxId: trxId,
    status: statusCode === "0000" ? "SUCCESS" : "FAILED",
    amount,
    eventId: `bkash:${trxId}`,
  };
}

export async function refund(req: PaymentRefundRequest): Promise<PaymentRefundResponse> {
  if (!isBkashConfigured()) {
    return { success: false, message: formatProviderNotConfiguredMessage("bkash") };
  }
  const cfg = getBkashConfig();
  const token = await getToken();

  const res = await axios.post(
    `${cfg.baseUrl}/tokenized/checkout/payment/refund`,
    {
      paymentID: req.providerTxId,
      amount: String(req.amount),
      trxID: req.providerTxId,
      sku: "campaign-refund",
      reason: req.reason || "Refund",
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
        "X-APP-Key": cfg.appKey,
      },
      timeout: 20_000,
    }
  );

  if (res.data?.statusCode === "0000") {
    return { success: true, refundId: res.data?.refundTrxID };
  }
  return { success: false, message: res.data?.statusMessage || "bKash refund failed" };
}

export function isConfigured(): boolean {
  return isBkashConfigured();
}
