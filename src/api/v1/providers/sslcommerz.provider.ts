import axios from "axios";
import { createHash } from "crypto";
import {
  formatProviderNotConfiguredMessage,
  getSslCommerzConfig,
  isSslCommerzConfigured,
} from "./paymentProvider.config";
import type {
  PaymentIntentRequest,
  PaymentIntentResponse,
  VerifiedPaymentEvent,
} from "./paymentProvider.types";

export async function createIntent(req: PaymentIntentRequest): Promise<PaymentIntentResponse> {
  if (!isSslCommerzConfigured()) {
    return { success: false, message: formatProviderNotConfiguredMessage("sslcommerz") };
  }

  const cfg = getSslCommerzConfig();
  const params = new URLSearchParams({
    store_id: cfg.storeId,
    store_passwd: cfg.storePassword,
    total_amount: String(req.amount),
    currency: req.currency || "BDT",
    tran_id: req.referenceId,
    success_url: cfg.successUrl,
    fail_url: cfg.failUrl,
    cancel_url: req.cancelUrl || cfg.cancelUrl,
    ipn_url: cfg.ipnUrl,
    cus_name: req.metadata?.name || "Guest",
    cus_phone: req.metadata?.phone || "01700000000",
    cus_email: req.metadata?.email || "guest@bpa.com.bd",
    product_name: req.metadata?.description || "Vaccination Campaign",
    product_category: "Healthcare",
    product_profile: "general",
    shipping_method: "NO",
    value_a: req.metadata?.orderId || "",
  });

  const res = await axios.post(cfg.sessionUrl, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 20_000,
  });

  const status = res.data?.status;
  const gatewayUrl = res.data?.GatewayPageURL;
  if (status !== "SUCCESS" || !gatewayUrl) {
    return { success: false, message: res.data?.failedreason || "SSLCommerz session failed" };
  }

  return {
    success: true,
    redirectUrl: gatewayUrl,
    providerPaymentId: res.data?.sessionkey,
  };
}

export function verifyIpnSignature(body: Record<string, string>): boolean {
  if (!isSslCommerzConfigured()) return false;
  const cfg = getSslCommerzConfig();
  const verifyKey = body.verify_key || body.verify_sign || "";
  const storePass = cfg.storePassword;
  const expected = createHash("md5")
    .update(
      [
        body.val_id,
        body.store_amount,
        body.store_passwd || storePass,
        body.tran_id,
        body.status,
      ]
        .filter(Boolean)
        .join("|")
    )
    .digest("hex");
  return verifyKey === expected || verifyKey === body.verify_sign;
}

export async function validateTransaction(valId: string): Promise<VerifiedPaymentEvent | null> {
  if (!isSslCommerzConfigured()) return null;
  const cfg = getSslCommerzConfig();

  const res = await axios.get(cfg.validationUrl, {
    params: {
      val_id: valId,
      store_id: cfg.storeId,
      store_passwd: cfg.storePassword,
      format: "json",
    },
    timeout: 20_000,
  });

  const data = res.data;
  const status = String(data?.status || "").toUpperCase();
  const tranId = String(data?.tran_id || "");
  const amount = parseFloat(String(data?.amount || data?.store_amount || "0"));
  const bankTranId = String(data?.bank_tran_id || valId);

  let mapped: "SUCCESS" | "FAILED" | "CANCELLED" = "FAILED";
  if (status === "VALID" || status === "VALIDATED") mapped = "SUCCESS";
  else if (status === "CANCELLED") mapped = "CANCELLED";

  if (!tranId) return null;

  return {
    provider: "sslcommerz",
    transactionId: tranId,
    providerTxId: bankTranId,
    status: mapped,
    amount,
    eventId: `ssl:${valId}`,
  };
}

export function parseIpnBody(body: Record<string, string>): VerifiedPaymentEvent | null {
  const tranId = String(body.tran_id || "");
  const status = String(body.status || "").toUpperCase();
  const amount = parseFloat(String(body.amount || body.store_amount || "0"));
  const bankTranId = String(body.bank_tran_id || body.tran_id || "");

  let mapped: "SUCCESS" | "FAILED" | "CANCELLED" = "FAILED";
  if (status === "VALID" || status === "VALIDATED") mapped = "SUCCESS";
  else if (status === "CANCELLED" || status === "UNATTEMPTED") mapped = "CANCELLED";

  if (!tranId) return null;

  return {
    provider: "sslcommerz",
    transactionId: tranId,
    providerTxId: bankTranId,
    status: mapped,
    amount,
    eventId: `ssl:ipn:${tranId}:${bankTranId}`,
  };
}

export function isConfigured(): boolean {
  return isSslCommerzConfigured();
}
