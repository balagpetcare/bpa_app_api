import axios from "axios";
import { assertEpsConfigured } from "./eps.config";
import type {
  EpsInitializeResponse,
  EpsTokenResponse,
  EpsVerifyResponse,
  EpsVerifiedEvent,
} from "./eps.types";
import {
  generateEpsHash,
  generateEpsMerchantTransactionId,
  mapEpsStatus,
  normalizeEpsPhone,
} from "./eps.utils";
import type { PaymentIntentRequest, PaymentIntentResponse } from "../../../providers/paymentProvider.types";

let cachedToken: { token: string; expiresAt: number } | null = null;

function trimBase(url: string): string {
  return url.replace(/\/+$/, "");
}

function resolveEndpoints(baseUrl: string) {
  const base = trimBase(baseUrl);
  return {
    getToken: `${base}/v1/Auth/GetToken`,
    initialize: `${base}/v1/EPSEngine/InitializeEPS`,
    verify: `${base}/v1/EPSEngine/CheckMerchantTransactionStatus`,
  };
}

export async function getEpsAuthToken(): Promise<string> {
  const cfg = assertEpsConfigured();
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const endpoints = resolveEndpoints(cfg.baseUrl);
  const hash = generateEpsHash(cfg.username, cfg.hashKey);

  const res = await axios.post<EpsTokenResponse>(
    endpoints.getToken,
    { userName: cfg.username, password: cfg.password },
    {
      headers: { "Content-Type": "application/json", "x-hash": hash },
      timeout: cfg.timeoutMs,
    }
  );

  const data = res.data;
  if (data.errorMessage || data.errorCode || !data.token) {
    throw new Error(data.errorMessage || "EPS GetToken failed");
  }

  const expiresAt = data.expireDate
    ? new Date(data.expireDate).getTime()
    : Date.now() + 55 * 60_000;
  cachedToken = { token: data.token, expiresAt };
  return data.token;
}

export function clearEpsTokenCache(): void {
  cachedToken = null;
}

export async function initializeEpsPayment(
  req: PaymentIntentRequest
): Promise<PaymentIntentResponse> {
  const cfg = assertEpsConfigured();
  const endpoints = resolveEndpoints(cfg.baseUrl);

  const merchantTransactionId =
    req.metadata?.merchantTransactionId?.trim() ||
    (req.referenceId.length >= 10 ? req.referenceId : generateEpsMerchantTransactionId());

  const token = await getEpsAuthToken();
  const hash = generateEpsHash(merchantTransactionId, cfg.hashKey);
  const phone = normalizeEpsPhone(req.metadata?.phone || "01700000000");

  const body = {
    merchantId: cfg.merchantId,
    storeId: cfg.storeId,
    CustomerOrderId: req.referenceId,
    merchantTransactionId,
    transactionTypeId: 1,
    financialEntityId: 0,
    transitionStatusId: 0,
    totalAmount: Number(req.amount),
    ipAddress: req.metadata?.ipAddress || "0.0.0.0",
    version: "1",
    successUrl: cfg.successUrl,
    failUrl: cfg.failUrl,
    cancelUrl: req.cancelUrl || cfg.cancelUrl,
    customerName: req.metadata?.name || "Guest",
    customerEmail: req.metadata?.email || "guest@bpa.com.bd",
    CustomerAddress: req.metadata?.address || "Dhaka",
    CustomerAddress2: "",
    CustomerCity: req.metadata?.city || "Dhaka",
    CustomerState: req.metadata?.state || "Dhaka",
    CustomerPostcode: req.metadata?.postcode || "1200",
    CustomerCountry: "BD",
    CustomerPhone: phone,
    ShipmentName: "",
    ShipmentAddress: "",
    ShipmentAddress2: "",
    ShipmentCity: "",
    ShipmentState: "",
    ShipmentPostcode: "",
    ShipmentCountry: "",
    ValueA: req.metadata?.orderId || "",
    ValueB: req.referenceId,
    ValueC: "",
    ValueD: "",
    ShippingMethod: "NO",
    NoOfItem: "1",
    ProductName: req.metadata?.description || "BPA Campaign Payment",
    ProductProfile: "general",
    ProductCategory: "Healthcare",
    ProductList: [],
  };

  const res = await axios.post<EpsInitializeResponse>(endpoints.initialize, body, {
    headers: {
      "Content-Type": "application/json",
      "x-hash": hash,
      Authorization: `Bearer ${token}`,
    },
    timeout: cfg.timeoutMs,
  });

  const data = res.data;
  if (data.ErrorMessage || data.ErrorCode || !data.RedirectURL) {
    return {
      success: false,
      message: data.ErrorMessage || "EPS payment initialization failed",
    };
  }

  return {
    success: true,
    redirectUrl: data.RedirectURL,
    providerPaymentId: data.TransactionId || merchantTransactionId,
  };
}

export async function verifyEpsTransaction(input: {
  merchantTransactionId?: string;
  epsTransactionId?: string;
}): Promise<EpsVerifiedEvent | null> {
  const merchantTransactionId = input.merchantTransactionId?.trim();
  const epsTransactionId = input.epsTransactionId?.trim();
  if (!merchantTransactionId && !epsTransactionId) return null;

  const cfg = assertEpsConfigured();
  const endpoints = resolveEndpoints(cfg.baseUrl);
  const hashValue = merchantTransactionId || epsTransactionId!;
  const hash = generateEpsHash(hashValue, cfg.hashKey);

  const token = await getEpsAuthToken();
  const params = new URLSearchParams();
  if (merchantTransactionId) params.append("merchantTransactionId", merchantTransactionId);
  if (epsTransactionId) params.append("EPSTransactionId", epsTransactionId);

  const res = await axios.get<EpsVerifyResponse>(`${endpoints.verify}?${params.toString()}`, {
    headers: {
      "x-hash": hash,
      Authorization: `Bearer ${token}`,
    },
    timeout: cfg.timeoutMs,
  });

  const data = res.data;
  if (data.ErrorMessage || data.ErrorCode) return null;

  const txnId = String(
    data.MerchantTransactionId || merchantTransactionId || epsTransactionId || ""
  );
  if (!txnId) return null;

  const providerTxId = String(data.EPSTransactionId || data.EpsTransactionId || txnId);
  const amount = parseFloat(String(data.TotalAmount || "0")) || 0;
  const mapped = mapEpsStatus(data.Status);

  return {
    provider: "eps",
    transactionId: txnId,
    providerTxId,
    status: mapped,
    amount,
    eventId: `eps:verify:${providerTxId}:${mapped}`,
    rawResponse: data as unknown as Record<string, unknown>,
  };
}

export function parseEpsCallbackQuery(query: Record<string, string>): EpsVerifiedEvent | null {
  const merchantTransactionId = String(
    query.merchantTransactionId || query.MerchantTransactionId || ""
  ).trim();
  const epsTransactionId = String(
    query.epsTransactionId || query.EPSTransactionId || query.EpsTransactionId || ""
  ).trim();
  const statusRaw = String(query.status || query.Status || "").trim();

  if (!merchantTransactionId && !epsTransactionId) return null;

  const transactionId = merchantTransactionId || epsTransactionId;
  const mapped = mapEpsStatus(statusRaw);

  return {
    provider: "eps",
    transactionId,
    providerTxId: epsTransactionId || transactionId,
    status: mapped,
    amount: 0,
    eventId: `eps:callback:${transactionId}:${mapped}:${statusRaw}`,
    rawResponse: query,
  };
}
