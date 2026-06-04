import type { Request, Response, NextFunction } from "express";
import {
  getActivePaymentProvider,
  getAmarPayConfig,
  getBkashConfig,
  getNagadConfig,
  getSslCommerzConfig,
  getEpsConfig,
  getUnifiedPaymentApiPrefix,
} from "../providers/paymentProvider.config";
import {
  createUnifiedPayment,
  handleUnifiedWebhook,
  verifyUnifiedPayment,
} from "./paymentOrchestrator.service";
import { createPaymentSchema, verifyPaymentSchema } from "./payment.validation";

export async function createPaymentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createPaymentSchema.parse(req.body);
    const result = await createUnifiedPayment(body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: { code: "PAYMENT_CREATE_FAILED", message: result.message || "Failed to create payment" },
        data: { provider: result.provider, logId: result.logId },
      });
    }
    res.json({
      success: true,
      data: {
        provider: result.provider,
        redirectUrl: result.redirectUrl,
        providerPaymentId: result.providerPaymentId,
        logId: result.logId,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function verifyPaymentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = verifyPaymentSchema.parse(req.body);
    const result = await verifyUnifiedPayment(body);
    res.json({
      success: result.success,
      data: {
        provider: result.provider,
        event: result.event,
        logId: result.logId,
      },
      error: result.error ? { code: "VERIFY_FAILED", message: result.error } : undefined,
    });
  } catch (error) {
    next(error);
  }
}

export async function webhookPostHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await handleUnifiedWebhook({
      body: req.body || {},
      query: normalizeQuery(req.query),
      headers: req.headers as Record<string, string | string[] | undefined>,
    });

    if (!result.success && result.error === "Invalid webhook secret") {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: result.error },
      });
    }

    res.json({ success: result.success, data: result });
  } catch (error) {
    next(error);
  }
}

/** bKash tokenized checkout uses GET callback with query params. */
export async function webhookGetHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await handleUnifiedWebhook({
      query: normalizeQuery(req.query),
      headers: req.headers as Record<string, string | string[] | undefined>,
    });

    if (!result.success) {
      const failBase = process.env.CAMPAIGN_LANDING_URL || process.env.APP_URL || "";
      const failUrl = failBase
        ? `${failBase.replace(/\/+$/, "")}/book/payment/failed`
        : "/book/payment/failed";
      if (req.headers.accept?.includes("text/html") || !req.headers.accept?.includes("application/json")) {
        return res.redirect(302, failUrl);
      }
      return res.status(400).json({ success: false, data: result });
    }

    const okBase = process.env.CAMPAIGN_LANDING_URL || process.env.APP_URL || "";
    const invoice = req.query.merchantInvoiceNumber || req.query.merchantInvoice;
    const bookingRef = invoice ? String(invoice).replace(/^CAMP-/i, "") : String(req.query.ref || "");
    const successPath = bookingRef
      ? `/book/payment/success?ref=${encodeURIComponent(bookingRef)}`
      : "/book/success";

    if (req.headers.accept?.includes("text/html") || !req.headers.accept?.includes("application/json")) {
      const url = okBase ? `${okBase.replace(/\/+$/, "")}${successPath}` : successPath;
      return res.redirect(302, url);
    }

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export function sslRedirectHandler(kind: "success" | "fail" | "cancel") {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.query)) {
        if (v != null) body[k] = String(v);
      }
      for (const [k, v] of Object.entries(req.body || {})) {
        if (v != null) body[k] = String(v);
      }

      await handleUnifiedWebhook({
        body,
        query: normalizeQuery(req.query),
        headers: req.headers as Record<string, string | string[] | undefined>,
      });

      const base = process.env.CAMPAIGN_LANDING_URL || process.env.APP_URL || "";
      const path =
        kind === "success"
          ? "/book/success"
          : kind === "fail"
            ? "/book/payment/failed"
            : "/book/payment/failed";
      const url = base ? `${base.replace(/\/+$/, "")}${path}` : path;
      res.redirect(302, url);
    } catch (error) {
      next(error);
    }
  };
}

export function callbackUrlsHandler(_req: Request, res: Response) {
  const prefix = getUnifiedPaymentApiPrefix();
  res.json({
    success: true,
    data: {
      activeProvider: getActivePaymentProvider(),
      apiPrefix: prefix,
      unifiedWebhook: `${prefix}/webhook`,
      bkash: getBkashConfig().callbackUrl,
      nagad: getNagadConfig().callbackUrl,
      sslcommerz: {
        success: getSslCommerzConfig().successUrl,
        fail: getSslCommerzConfig().failUrl,
        cancel: getSslCommerzConfig().cancelUrl,
        ipn: getSslCommerzConfig().ipnUrl,
      },
      amarpay: {
        ipn: getAmarPayConfig().ipnUrl,
      },
      eps: {
        success: getEpsConfig().successUrl,
        fail: getEpsConfig().failUrl,
        cancel: getEpsConfig().cancelUrl,
        baseUrl: getEpsConfig().baseUrl,
      },
    },
  });
}

function normalizeQuery(query: Request["query"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (v == null) continue;
    out[k] = Array.isArray(v) ? String(v[0]) : String(v);
  }
  return out;
}
