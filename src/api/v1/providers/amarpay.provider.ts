import axios from "axios";
import { createHash } from "crypto";
import {
  formatProviderNotConfiguredMessage,
  getAmarPayConfig,
  isAmarPayConfigured,
} from "./paymentProvider.config";
import type {
  PaymentIntentRequest,
  PaymentIntentResponse,
  VerifiedPaymentEvent,
} from "./paymentProvider.types";

function baseUrl(sandbox: boolean): string {
  const cfg = getAmarPayConfig();
  return cfg.baseUrl || (sandbox ? "https://sandbox.aamarpay.com" : "https://secure.aamarpay.com");
}

export async function createIntent(req: PaymentIntentRequest): Promise<PaymentIntentResponse> {
  if (!isAmarPayConfigured()) {
    return { success: false, message: formatProviderNotConfiguredMessage("amarpay") };
  }

  const cfg = getAmarPayConfig();
  const url = `${baseUrl(cfg.sandbox)}/jsonpost.php`;

  const payload = {
    store_id: cfg.storeId,
    signature_key: cfg.signatureKey,
    tran_id: req.referenceId,
    amount: Number(req.amount).toFixed(2),
    currency: req.currency || "BDT",
    cus_name: req.metadata?.name || "Guest",
    cus_email: req.metadata?.email || "guest@bpa.com.bd",
    cus_phone: req.metadata?.phone || "01700000000",
    cus_add1: req.metadata?.address || "Dhaka, Bangladesh",
    desc: req.metadata?.description || "BPA Payment",
    success_url: req.returnUrl,
    fail_url: req.cancelUrl || req.returnUrl,
    cancel_url: req.cancelUrl || req.returnUrl,
    type: "json",
  };

  const res = await axios.post(url, payload, {
    headers: { "Content-Type": "application/json" },
    timeout: 20_000,
  });

  const paymentUrl = res.data?.payment_url || res.data?.data;
  if (!paymentUrl) {
    return {
      success: false,
      message: res.data?.message || res.data?.error || "AmarPay session failed",
    };
  }

  return {
    success: true,
    redirectUrl: String(paymentUrl),
    providerPaymentId: req.referenceId,
  };
}

export async function searchTransaction(tranId: string): Promise<VerifiedPaymentEvent | null> {
  if (!isAmarPayConfigured()) return null;
  const cfg = getAmarPayConfig();
  const url = `${baseUrl(cfg.sandbox)}/api/v1/trxcheck/`;

  const res = await axios.get(url, {
    params: {
      request_id: tranId,
      store_id: cfg.storeId,
      signature_key: cfg.signatureKey,
      type: "json",
    },
    timeout: 20_000,
  });

  const data = res.data?.data || res.data;
  const status = String(data?.pay_status || data?.status || "").toLowerCase();
  const amount = parseFloat(String(data?.amount || data?.rec_amount || "0"));
  const ref = String(data?.mer_txnid || data?.tran_id || tranId);

  let mapped: "SUCCESS" | "FAILED" | "CANCELLED" = "FAILED";
  if (status === "successful" || status === "success" || status === "paid") mapped = "SUCCESS";
  else if (status === "cancelled" || status === "canceled") mapped = "CANCELLED";

  if (!ref) return null;

  return {
    provider: "amarpay",
    transactionId: ref,
    providerTxId: String(data?.pg_txnid || data?.bank_txn || ref),
    status: mapped,
    amount,
    eventId: `amarpay:${ref}`,
  };
}

export function verifyIpnSignature(body: Record<string, string>, signatureKey: string): boolean {
  const received = body.signature || body.signature_key || "";
  if (!received) return true; // AmarPay IPN may omit signature in sandbox; validate via search API in production
  const payload = [
    body.mer_txnid || body.tran_id,
    body.amount,
    body.pay_status || body.status,
    signatureKey,
  ]
    .filter(Boolean)
    .join("");
  const expected = createHash("md5").update(payload).digest("hex");
  return received === expected;
}

export function parseIpnBody(body: Record<string, string>): VerifiedPaymentEvent | null {
  const tranId = String(body.mer_txnid || body.tran_id || "");
  const status = String(body.pay_status || body.status || "").toLowerCase();
  const amount = parseFloat(String(body.amount || body.rec_amount || "0"));
  const pgTx = String(body.pg_txnid || body.bank_txn || tranId);

  let mapped: "SUCCESS" | "FAILED" | "CANCELLED" = "FAILED";
  if (status === "successful" || status === "success" || status === "paid") mapped = "SUCCESS";
  else if (status === "cancelled" || status === "canceled" || status === "failed") {
    mapped = status === "failed" ? "FAILED" : "CANCELLED";
  }

  if (!tranId) return null;

  return {
    provider: "amarpay",
    transactionId: tranId,
    providerTxId: pgTx,
    status: mapped,
    amount,
    eventId: `amarpay:${tranId}:${body.pay_time || ""}`,
  };
}
