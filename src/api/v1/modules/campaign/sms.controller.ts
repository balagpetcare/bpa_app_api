import { Request, Response, NextFunction } from "express";
import { handleDeliveryCallback } from "./sms.service";

/**
 * POST /public/sms/delivery-callback
 * Provider delivery status webhook (SSL Wireless / BulkSMSBD).
 */
export async function smsDeliveryCallbackHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const webhookSecret = process.env.CAMPAIGN_SMS_WEBHOOK_SECRET;
    if (webhookSecret) {
      const provided = req.headers["x-campaign-sms-secret"];
      if (provided !== webhookSecret) {
        return res.status(401).json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Invalid SMS webhook secret" },
        });
      }
    }

    const body = req.body as Record<string, unknown>;
    const query = req.query as Record<string, unknown>;

    const externalId = String(
      body.externalId ?? body.message_id ?? body.messageId ?? body.csms_id ?? query.message_id ?? query.externalId ?? ""
    ).trim();

    if (!externalId) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_PAYLOAD", message: "externalId or message_id is required" },
      });
    }

    const rawStatus = String(body.status ?? body.delivery_status ?? query.status ?? "").toUpperCase();
    const delivered =
      rawStatus === "DELIVERED" ||
      rawStatus === "SUCCESS" ||
      rawStatus === "200" ||
      rawStatus === "202";

    const errorMessage =
      typeof body.error === "string"
        ? body.error
        : typeof body.error_message === "string"
          ? body.error_message
          : undefined;

    await handleDeliveryCallback(externalId, delivered ? "DELIVERED" : "FAILED", errorMessage);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}
