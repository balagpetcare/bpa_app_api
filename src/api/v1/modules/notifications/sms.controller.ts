import type { Request, Response, NextFunction } from "express";
import { formatSmsNotConfiguredMessage } from "../../../../integrations/sms/smsProvider.bootstrap";
import { isSmsEnabled } from "../../../../shared/services/sms/sms.constants";
import { getPrimarySmsProvider } from "../../../../integrations/sms/smsGateway.service";
import * as adminSms from "../admin_sms/admin_sms.service";
import { sendSMS } from "../../../../shared/services/sms/sms.service";
import { normalizePhone } from "../campaign/campaign.utils";

function requireSmsConfigured(req: Request, res: Response, next: NextFunction) {
  if (!isSmsEnabled()) {
    return next();
  }
  if (process.env.SMS_ALLOW_MOCK === "true") {
    return next();
  }
  const provider = getPrimarySmsProvider();
  if (!provider.isConfigured()) {
    return res.status(503).json({
      success: false,
      error: { code: "SMS_NOT_CONFIGURED", message: formatSmsNotConfiguredMessage() },
    });
  }
  next();
}

export async function smsBalanceHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const data = await adminSms.getBalance();
    res.json({ success: data.success, data });
  } catch (err) {
    next(err);
  }
}

export async function smsSendHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { phone, message } = req.body as { phone?: string; message?: string };
    if (!phone) {
      return res.status(400).json({ success: false, error: { code: "INVALID_INPUT", message: "phone is required" } });
    }
    const data = await adminSms.sendSingleSms({ phone, message: message || "" });
    res.json({ success: data.success, data });
  } catch (err) {
    next(err);
  }
}

export async function smsSendBulkHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { phones, message } = req.body as { phones?: string[]; message?: string };
    if (!phones?.length) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "phones array is required" },
      });
    }
    const data = await adminSms.sendBulkAdminSms({ phones, message: message || "" });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function smsTestHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { phone } = req.body as { phone?: string };
    const target = phone?.trim();
    if (!target) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "phone is required for SMS test" },
      });
    }
    const normalized = normalizePhone(target);
    const result = await sendSMS({
      phone: normalized,
      message: "BPA/WPA SMS test — BulkSMSBD gateway is reachable.",
      template: "SMS_TEST",
      direct: true,
    });
    res.json({
      success: result.success,
      data: result,
      error: result.error ? { code: "SMS_TEST_FAILED", message: result.error } : undefined,
    });
  } catch (err) {
    next(err);
  }
}

export { requireSmsConfigured };
