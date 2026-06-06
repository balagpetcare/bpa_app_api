import type { Request, Response, NextFunction } from "express";
import { getPaymentWebhookSecret } from "../../../providers/paymentProvider.config";
import {
  getEpsCallbackUrls,
  handleEpsCallback,
  handleEpsWebhook,
  initiateEpsPayment,
  validateEpsPayment,
} from "./eps.service";
import { epsInitiateSchema, epsValidateSchema } from "./eps.validation";

function assertWebhookSecret(req: Request): boolean {
  const secret = getPaymentWebhookSecret();
  if (!secret) return true;
  const provided =
    req.headers["x-payment-webhook-secret"] ||
    req.headers["x-campaign-payment-secret"] ||
    req.headers["x-payment-secret"];
  if (Array.isArray(provided)) return provided[0] === secret;
  return provided === secret;
}

function normalizeQuery(query: Request["query"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (v == null) continue;
    out[k] = Array.isArray(v) ? String(v[0]) : String(v);
  }
  return out;
}

function landingRedirect(res: Response, path: string) {
  const base = process.env.CAMPAIGN_LANDING_URL || process.env.APP_URL || "";
  const url = base ? `${base.replace(/\/+$/, "")}${path}` : path;
  return res.redirect(302, url);
}

export async function epsInitiateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = epsInitiateSchema.parse(req.body);
    const result = await initiateEpsPayment(body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: { code: "EPS_INIT_FAILED", message: result.message || "Failed to initiate EPS payment" },
        data: result,
      });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function epsValidateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = epsValidateSchema.parse(req.body);
    const result = await validateEpsPayment(body);
    res.json({ success: result.success, data: result });
  } catch (error) {
    next(error);
  }
}

/** GET /payments/eps/verify/:transactionId — verify by merchant or EPS transaction id. */
export async function epsVerifyByTransactionIdHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const transactionId = String(req.params.transactionId || "").trim();
    if (!transactionId) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "transactionId is required" },
      });
    }
    const result = await validateEpsPayment({
      merchantTransactionId: transactionId,
      epsTransactionId: transactionId,
    });
    res.json({ success: result.success, data: result });
  } catch (error) {
    next(error);
  }
}

export async function epsWebhookHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (!assertWebhookSecret(req)) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid webhook secret" },
      });
    }

    const result = await handleEpsWebhook({
      query: normalizeQuery(req.query),
      body: (req.body || {}) as Record<string, unknown>,
    });

    res.json({ success: result.success, data: result });
  } catch (error) {
    next(error);
  }
}

export function epsCallbackHandler(kind: "success" | "fail" | "cancel") {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await handleEpsCallback(kind, normalizeQuery(req.query));
      if (req.headers.accept?.includes("application/json")) {
        return res.json({ success: result.success, data: result });
      }
      return landingRedirect(res, result.redirectPath);
    } catch (error) {
      next(error);
    }
  };
}

export function epsCallbackUrlsHandler(_req: Request, res: Response) {
  res.json({ success: true, data: getEpsCallbackUrls() });
}
