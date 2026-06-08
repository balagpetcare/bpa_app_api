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
  const apiRoot = /\/v1$/i.test(base) ? base : `${base}/v1`;
  return {
    getToken: `${apiRoot}/Auth/GetToken`,
    initialize: `${apiRoot}/EPSEngine/InitializeEPS`,
    verify: `${apiRoot}/EPSEngine/CheckMerchantTransactionStatus`,
  };
}

export async function getEpsAuthToken(): Promise<string> {
  const cfg = assertEpsConfigured();
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const endpoints = resolveEndpoints(cfg.baseUrl);
  const hash = generateEpsHash(cfg.username, cfg.hashKey);
  console.info("[CHECKOUT_INIT_DEBUG] eps_token_request", {
    providerSelected: "eps",
    url: endpoints.getToken,
    timeoutMs: cfg.timeoutMs,
  });
  const res = await axios.post<EpsTokenResponse>(
    endpoints.getToken,
    { userName: cfg.username, password: cfg.password },
    {
      headers: { "Content-Type": "application/json", "x-hash": hash },
      timeout: cfg.timeoutMs,
      validateStatus: () => true,
    }
  );
  console.info("[CHECKOUT_INIT_DEBUG] eps_token_response", {
    providerSelected: "eps",
    url: endpoints.getToken,
    status: res.status,
    body: res.data,
  });
  if (res.status >= 400) {
    throw new Error(`EPS GetToken failed (${res.status}) at ${endpoints.getToken}`);
  }

  const data = res.data;
  // EPS returns HTTP 200 with token=null + a generic errorMessage when the
  // credentials/merchant do not belong to this environment (e.g. sandbox creds
  // against the production host). A 200 status alone does NOT mean auth succeeded.
  if (data.errorMessage || data.errorCode || !data.token) {
    console.info("[CHECKOUT_INIT_DEBUG] eps_token_invalid", {
      providerSelected: "eps",
      url: endpoints.getToken,
      httpStatus: res.status,
      errorMessage: data.errorMessage ?? null,
      errorCode: data.errorCode ?? null,
      hasToken: Boolean(data.token),
      hint: "HTTP 200 with null token usually means credentials/merchant do not match this EPS environment (sandbox vs production).",
    });
    throw new Error(
      data.errorMessage
        ? `EPS GetToken rejected: ${data.errorMessage} (check EPS_USERNAME/EPS_PASSWORD/EPS_HASH_KEY match the ${cfg.sandbox ? "sandbox" : "production"} environment at ${endpoints.getToken})`
        : "EPS GetToken failed (no token returned)"
    );
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

  // EPS requires a UNIQUE merchantTransactionId per initialization and rejects
  // reuse with "TransactionId already used". The BPA order number (CKO-*) is fixed
  // per checkout, so deriving the merchantTransactionId from referenceId caused
  // every retry/re-init of the same checkout to reuse the id and fail at EPS.
  // Always generate a fresh EPS-safe id; preserve the order number as CustomerOrderId.
  const callerForcedMerchantTransactionId = req.metadata?.merchantTransactionId?.trim();
  const preferredMerchantTransactionId =
    callerForcedMerchantTransactionId || generateEpsMerchantTransactionId();

  const token = await getEpsAuthToken();
  const phone = normalizeEpsPhone(req.metadata?.phone || "01700000000");

  const buildBody = (merchantTransactionId: string) => ({
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
    ValueB: req.metadata?.checkoutSessionId || req.referenceId,
    ValueC: "",
    ValueD: "",
    ShippingMethod: "NO",
    NoOfItem: "1",
    ProductName: req.metadata?.description || "BPA Campaign Payment",
    ProductProfile: "general",
    ProductCategory: "Healthcare",
    ProductList: [],
  });

  const callInitialize = async (merchantTransactionId: string, attempt: number) => {
    const hash = generateEpsHash(merchantTransactionId, cfg.hashKey);
    const body = buildBody(merchantTransactionId);
    const requestHeaders = {
      "Content-Type": "application/json",
      "x-hash": hash,
      Authorization: "Bearer ***",
    };

    console.info("[CHECKOUT_INIT_DEBUG] eps_init_request", {
      attempt,
      method: "POST",
      url: endpoints.initialize,
      headers: requestHeaders,
      payload: body,
    });

    try {
      const res = await axios.post<EpsInitializeResponse>(endpoints.initialize, body, {
        headers: {
          "Content-Type": "application/json",
          "x-hash": hash,
          Authorization: `Bearer ${token}`,
        },
        timeout: cfg.timeoutMs,
        validateStatus: () => true,
      });

      console.info("[CHECKOUT_INIT_DEBUG] eps_init_response", {
        attempt,
        method: "POST",
        url: endpoints.initialize,
        status: res.status,
        headers: res.headers,
        body: res.data,
      });

      if (res.status >= 400) {
        console.info("[CHECKOUT_INIT_DEBUG] eps_init_error", {
          attempt,
          method: "POST",
          url: endpoints.initialize,
          status: res.status,
          requestHeaders,
          responseHeaders: res.headers,
          responseBody: res.data,
          merchantTransactionId,
          customerOrderId: req.referenceId,
        });
      }

      return { res, merchantTransactionId };
    } catch (error) {
      const err = error as {
        message?: string;
        code?: string;
        response?: { status?: number; data?: unknown; headers?: unknown };
      };
      console.info("[CHECKOUT_INIT_DEBUG] eps_init_error", {
        attempt,
        method: "POST",
        url: endpoints.initialize,
        errorMessage: err.message || "EPS init request failed",
        errorCode: err.code,
        status: err.response?.status,
        requestHeaders,
        responseHeaders: err.response?.headers,
        responseBody: err.response?.data,
        merchantTransactionId,
        customerOrderId: req.referenceId,
      });
      throw error;
    }
  };

  let attempt = await callInitialize(preferredMerchantTransactionId, 1);

  // Safety net: if EPS still rejects the id (404, or a body-level "already used"
  // reuse error), retry once with a fresh generated id — unless the caller forced
  // a specific merchantTransactionId.
  const looksLikeReuse = (data: EpsInitializeResponse | undefined): boolean => {
    const msg = String(data?.ErrorMessage || "").toLowerCase();
    return msg.includes("already used") || msg.includes("already exist");
  };
  const shouldRetry =
    !callerForcedMerchantTransactionId &&
    (attempt.res.status === 404 || (attempt.res.status < 400 && looksLikeReuse(attempt.res.data)));

  if (shouldRetry) {
    const fallbackMerchantTransactionId = generateEpsMerchantTransactionId();
    console.info("[CHECKOUT_INIT_DEBUG] eps_init_retry_with_fresh_merchant_txn", {
      fromMerchantTransactionId: preferredMerchantTransactionId,
      toMerchantTransactionId: fallbackMerchantTransactionId,
      reason: attempt.res.status === 404 ? "initialize_404" : "merchant_txn_reuse",
    });
    attempt = await callInitialize(fallbackMerchantTransactionId, 2);
  }

  if (attempt.res.status >= 400) {
    return {
      success: false,
      message: `EPS Initialize failed (${attempt.res.status}) at ${endpoints.initialize}`,
    };
  }

  const data = attempt.res.data;
  if (data.ErrorMessage || data.ErrorCode || !data.RedirectURL) {
    console.info("[CHECKOUT_INIT_DEBUG] eps_init_error", {
      method: "POST",
      url: endpoints.initialize,
      status: attempt.res.status,
      responseHeaders: attempt.res.headers,
      responseBody: data,
      merchantTransactionId: attempt.merchantTransactionId,
      customerOrderId: req.referenceId,
    });
    return {
      success: false,
      message: data.ErrorMessage || "EPS payment initialization failed",
    };
  }

  return {
    success: true,
    redirectUrl: data.RedirectURL,
    providerPaymentId: data.TransactionId || attempt.merchantTransactionId,
    metadata: {
      merchantTransactionId: attempt.merchantTransactionId,
      customerOrderId: req.referenceId,
    },
  };
}

async function requestEpsTransactionStatus(
  cfg: ReturnType<typeof assertEpsConfigured>,
  endpoints: ReturnType<typeof resolveEndpoints>,
  input: {
    merchantTransactionId?: string;
    epsTransactionId?: string;
    customerOrderId?: string;
  }
): Promise<EpsVerifiedEvent | null> {
  const merchantTransactionId = input.merchantTransactionId?.trim();
  const epsTransactionId = input.epsTransactionId?.trim();
  const customerOrderId = input.customerOrderId?.trim();
  if (!merchantTransactionId && !epsTransactionId) return null;

  const hashValue = merchantTransactionId || epsTransactionId!;
  const hash = generateEpsHash(hashValue, cfg.hashKey);
  const token = await getEpsAuthToken();
  const params = new URLSearchParams();
  if (merchantTransactionId) params.append("merchantTransactionId", merchantTransactionId);
  if (epsTransactionId) params.append("EPSTransactionId", epsTransactionId);

  let data: EpsVerifyResponse;
  try {
    const res = await axios.get<EpsVerifyResponse>(`${endpoints.verify}?${params.toString()}`, {
      headers: {
        "x-hash": hash,
        Authorization: `Bearer ${token}`,
      },
      timeout: cfg.timeoutMs,
      validateStatus: (status) => status < 500,
    });
    if (res.status === 404) {
      console.warn("[EPS verify] transaction not found (HTTP 404)", {
        merchantTransactionId,
        epsTransactionId,
      });
      return null;
    }
    if (res.status >= 400) {
      console.warn("[EPS verify] HTTP error", {
        status: res.status,
        merchantTransactionId,
        epsTransactionId,
      });
      return null;
    }
    data = res.data;
  } catch (error) {
    const err = error as { message?: string; code?: string; response?: { status?: number } };
    console.warn("[EPS verify] request failed — using callback fallback if available", {
      message: err.message,
      code: err.code,
      status: err.response?.status,
      merchantTransactionId,
      epsTransactionId,
    });
    return null;
  }

  if (data.ErrorMessage || data.ErrorCode) return null;

  const txnId = String(
    data.MerchantTransactionId || merchantTransactionId || epsTransactionId || ""
  );
  if (!txnId) return null;

  const providerTxId = String(data.EPSTransactionId || data.EpsTransactionId || txnId);
  const amount = parseFloat(String(data.TotalAmount || "0")) || 0;
  const mapped = mapEpsStatus(data.Status);
  const orderReference =
    customerOrderId ||
    String(data.CustomerOrderId || "").trim() ||
    undefined;

  return {
    provider: "eps",
    transactionId: orderReference || txnId,
    providerTxId,
    status: mapped,
    amount,
    eventId: `eps:verify:${providerTxId}:${mapped}`,
    rawResponse: {
      ...(data as unknown as Record<string, unknown>),
      ...(orderReference ? { CustomerOrderId: orderReference } : {}),
    },
  };
}

export async function verifyEpsTransaction(input: {
  merchantTransactionId?: string;
  epsTransactionId?: string;
  customerOrderId?: string;
}): Promise<EpsVerifiedEvent | null> {
  const merchantTransactionId = input.merchantTransactionId?.trim();
  const epsTransactionId = input.epsTransactionId?.trim();
  const customerOrderId = input.customerOrderId?.trim();
  if (!merchantTransactionId && !epsTransactionId) return null;

  const cfg = assertEpsConfigured();
  const endpoints = resolveEndpoints(cfg.baseUrl);

  const attempts: Array<{ merchantTransactionId?: string; epsTransactionId?: string }> = [
    { merchantTransactionId, epsTransactionId },
  ];
  if (merchantTransactionId && epsTransactionId) {
    attempts.push({ merchantTransactionId });
    attempts.push({ epsTransactionId });
  }

  for (const attempt of attempts) {
    const verified = await requestEpsTransactionStatus(cfg, endpoints, {
      ...attempt,
      customerOrderId,
    });
    if (verified) return verified;
  }

  return null;
}

export function parseEpsCallbackQuery(query: Record<string, string>): EpsVerifiedEvent | null {
  const customerOrderId = String(query.CustomerOrderId || query.customerOrderId || "").trim();
  const merchantTransactionId = String(
    query.merchantTransactionId || query.MerchantTransactionId || ""
  ).trim();
  const epsTransactionId = String(
    query.epsTransactionId || query.EPSTransactionId || query.EpsTransactionId || ""
  ).trim();
  const statusRaw = String(query.status || query.Status || "").trim();

  if (!customerOrderId && !merchantTransactionId && !epsTransactionId) return null;

  /** Campaign orders are keyed by orderNumber (CAMP-* / CKO-*), not EPS merchant txn id. */
  const transactionId = customerOrderId || merchantTransactionId || epsTransactionId;
  const mapped = mapEpsStatus(statusRaw);

  return {
    provider: "eps",
    transactionId,
    providerTxId: epsTransactionId || merchantTransactionId || transactionId,
    status: mapped,
    amount: 0,
    eventId: `eps:callback:${merchantTransactionId || epsTransactionId || customerOrderId}:${mapped}:${statusRaw}`,
    rawResponse: query,
  };
}
