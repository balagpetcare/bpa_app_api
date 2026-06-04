import axios from "axios";
import { createSign, createVerify } from "crypto";
import {
  formatProviderNotConfiguredMessage,
  getNagadConfig,
  isNagadConfigured,
} from "./paymentProvider.config";
import type {
  PaymentIntentRequest,
  PaymentIntentResponse,
  VerifiedPaymentEvent,
} from "./paymentProvider.types";

function signPayload(payload: object, privateKeyPem: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(JSON.stringify(payload));
  signer.end();
  return signer.sign(privateKeyPem, "base64");
}

function verifyPayload(payload: object, signature: string, publicKeyPem: string): boolean {
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(JSON.stringify(payload));
    verifier.end();
    return verifier.verify(publicKeyPem, signature, "base64");
  } catch {
    return false;
  }
}

function formatPrivateKey(raw: string): string {
  if (raw.includes("BEGIN")) return raw.replace(/\\n/g, "\n");
  return `-----BEGIN RSA PRIVATE KEY-----\n${raw.replace(/\\n/g, "\n")}\n-----END RSA PRIVATE KEY-----`;
}

function formatPublicKey(raw: string): string {
  if (raw.includes("BEGIN")) return raw.replace(/\\n/g, "\n");
  return `-----BEGIN PUBLIC KEY-----\n${raw.replace(/\\n/g, "\n")}\n-----END PUBLIC KEY-----`;
}

export async function createIntent(req: PaymentIntentRequest): Promise<PaymentIntentResponse> {
  if (!isNagadConfigured()) {
    return { success: false, message: formatProviderNotConfiguredMessage("nagad") };
  }

  const cfg = getNagadConfig();
  const privateKey = formatPrivateKey(cfg.privateKey);
  const orderId = req.referenceId;
  const dateTime = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const initSensitive = {
    merchantId: cfg.merchantId,
    datetime: dateTime,
    orderId,
    challenge: `camp-${orderId}-${Date.now()}`,
  };

  const initRes = await axios.post(
    `${cfg.baseUrl}/api/dfs/check-out/initialize/${cfg.merchantId}/${orderId}`,
    {
      dateTime,
      sensitiveData: Buffer.from(JSON.stringify(initSensitive)).toString("base64"),
      signature: signPayload(initSensitive, privateKey),
    },
    { timeout: 20_000 }
  );

  const challenge = initRes.data?.challenge;
  if (!challenge) {
    return { success: false, message: "Nagad initialize failed" };
  }

  const checkoutSensitive = {
    merchantId: cfg.merchantId,
    orderId,
    currencyCode: "050",
    amount: req.amount.toFixed(2),
    challenge,
  };

  const checkoutRes = await axios.post(
    `${cfg.baseUrl}/api/dfs/check-out/complete/${cfg.merchantId}/${orderId}`,
    {
      sensitiveData: Buffer.from(JSON.stringify(checkoutSensitive)).toString("base64"),
      signature: signPayload(checkoutSensitive, privateKey),
      merchantCallbackURL: cfg.callbackUrl,
    },
    { timeout: 20_000 }
  );

  const redirectUrl = checkoutRes.data?.callBackUrl;
  const paymentRef = checkoutRes.data?.paymentReferenceId;
  if (!redirectUrl) {
    return { success: false, message: "Nagad checkout failed" };
  }

  return {
    success: true,
    redirectUrl,
    providerPaymentId: paymentRef,
  };
}

export function verifyCallbackSignature(body: {
  sensitiveData?: string;
  signature?: string;
}): { ok: boolean; data?: Record<string, unknown> } {
  if (!isNagadConfigured() || !body.sensitiveData || !body.signature) {
    return { ok: false };
  }
  const cfg = getNagadConfig();
  const publicKey = formatPublicKey(cfg.publicKey);
  let decoded: Record<string, unknown>;
  try {
    decoded = JSON.parse(Buffer.from(body.sensitiveData, "base64").toString("utf8"));
  } catch {
    return { ok: false };
  }
  const ok = verifyPayload(decoded, body.signature, publicKey);
  return ok ? { ok: true, data: decoded } : { ok: false };
}

export function parseVerifiedCallback(data: Record<string, unknown>): VerifiedPaymentEvent | null {
  const orderId = String(data.merchantOrderId || data.orderId || "");
  const status = String(data.status || "").toUpperCase();
  const paymentRef = String(data.paymentRefId || data.issuerPaymentRef || orderId);
  const amount = parseFloat(String(data.amount || "0"));

  let mapped: "SUCCESS" | "FAILED" | "CANCELLED" = "FAILED";
  if (status === "SUCCESS" || status === "Success") mapped = "SUCCESS";
  else if (status === "CANCELLED" || status === "Cancelled") mapped = "CANCELLED";

  if (!orderId) return null;

  return {
    provider: "nagad",
    transactionId: orderId.startsWith("CAMP-") ? orderId : `CAMP-${orderId}`,
    providerTxId: paymentRef,
    status: mapped,
    amount,
    eventId: `nagad:${paymentRef}`,
  };
}

export function isConfigured(): boolean {
  return isNagadConfigured();
}
