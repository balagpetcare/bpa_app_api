import axios from "axios";
import type { SmsProvider, SmsSendContext, SmsSendResult } from "./types";
import { formatBdMsisdn } from "./phone";

type BulkSmsBdMode = "rest_v3" | "legacy";

function getMode(): BulkSmsBdMode {
  const provider = String(process.env.SMS_PROVIDER || "").toLowerCase();
  if (provider === "bulksmsbd") return "legacy";
  const mode = String(process.env.BULKSMSBD_API_MODE || "rest_v3").toLowerCase();
  return mode === "legacy" ? "legacy" : "rest_v3";
}

export class BulkSmsBdProvider implements SmsProvider {
  readonly name = "bulksmsbd";

  isConfigured(): boolean {
    const token =
      process.env.SMS_API_KEY ||
      process.env.BULKSMSBD_API_TOKEN ||
      process.env.BULKSMSBD_API_KEY;
    const senderId =
      process.env.SMS_SENDER_ID ||
      process.env.BULKSMSBD_SENDER_ID ||
      process.env.CAMPAIGN_SMS_SENDER_ID;
    return Boolean(token && senderId);
  }

  async send(phone: string, message: string, _context?: SmsSendContext): Promise<SmsSendResult> {
    return getMode() === "legacy" ? this.sendLegacy(phone, message) : this.sendRestV3(phone, message);
  }

  private async sendRestV3(phone: string, message: string): Promise<SmsSendResult> {
    const apiToken =
      process.env.SMS_API_KEY ||
      process.env.BULKSMSBD_API_TOKEN ||
      process.env.BULKSMSBD_API_KEY;
    const senderId =
      process.env.SMS_SENDER_ID ||
      process.env.BULKSMSBD_SENDER_ID ||
      process.env.CAMPAIGN_SMS_SENDER_ID;
    const baseUrl = (
      process.env.SMS_BASE_URL ||
      process.env.BULKSMSBD_BASE_URL ||
      "https://app.bulksmsbd.xyz"
    ).replace(/\/+$/, "");

    if (!apiToken || !senderId) {
      return { success: false, provider: this.name, error: "BulkSMSBD is not configured" };
    }

    try {
      const response = await axios.post(
        `${baseUrl}/api/v3/sms/send`,
        {
          recipient: formatBdMsisdn(phone),
          sender_id: senderId,
          type: "plain",
          message,
        },
        {
          timeout: Number(process.env.SMS_HTTP_TIMEOUT_MS || 15000),
          headers: {
            Authorization: `Bearer ${apiToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          validateStatus: () => true,
        }
      );

      const data = response.data as {
        status?: string;
        message?: string;
        data?: { uid?: string; id?: string | number };
      };

      const ok =
        response.status >= 200 &&
        response.status < 300 &&
        (String(data?.status || "").toLowerCase() === "success" || Boolean(data?.data?.uid || data?.data?.id));

      if (ok) {
        const messageId = String(data?.data?.uid ?? data?.data?.id ?? `bulksmsbd-${Date.now()}`);
        return { success: true, provider: this.name, messageId, raw: data };
      }

      return {
        success: false,
        provider: this.name,
        error: data?.message || `BulkSMSBD HTTP ${response.status}`,
        raw: data,
      };
    } catch (error) {
      return {
        success: false,
        provider: this.name,
        error: (error as Error)?.message || "BulkSMSBD request failed",
      };
    }
  }

  private async sendLegacy(phone: string, message: string): Promise<SmsSendResult> {
    const apiKey =
      process.env.SMS_API_KEY ||
      process.env.BULKSMSBD_API_KEY ||
      process.env.BULKSMSBD_API_TOKEN;
    const senderId =
      process.env.SMS_SENDER_ID ||
      process.env.BULKSMSBD_SENDER_ID ||
      process.env.CAMPAIGN_SMS_SENDER_ID;
    const baseUrl = (
      process.env.SMS_BASE_URL ||
      process.env.BULKSMSBD_BASE_URL ||
      "http://bulksmsbd.net/api"
    ).replace(/\/+$/, "");
    const legacyUrl = process.env.BULKSMSBD_LEGACY_URL || `${baseUrl}/smsapi`;

    if (!apiKey || !senderId) {
      return { success: false, provider: this.name, error: "BulkSMSBD legacy API is not configured" };
    }

    try {
      const response = await axios.get(legacyUrl, {
        timeout: Number(process.env.SMS_HTTP_TIMEOUT_MS || 15000),
        params: {
          api_key: apiKey,
          type: "text",
          number: formatBdMsisdn(phone),
          senderid: senderId,
          message,
        },
        validateStatus: () => true,
      });

      const body = response.data;
      const code =
        typeof body === "object" && body !== null && "response_code" in body
          ? Number((body as { response_code: unknown }).response_code)
          : Number(String(body).trim());

      if (code === 202 || code === 200) {
        const messageId =
          typeof body === "object" && body !== null && "message_id" in body
            ? String((body as { message_id: unknown }).message_id)
            : `bulksmsbd-${Date.now()}`;
        return { success: true, provider: this.name, messageId, raw: body };
      }

      const errorText =
        typeof body === "object" && body !== null && "error_message" in body
          ? String((body as { error_message: unknown }).error_message)
          : `BulkSMSBD legacy response code ${code}`;

      return { success: false, provider: this.name, error: errorText, raw: body };
    } catch (error) {
      return {
        success: false,
        provider: this.name,
        error: (error as Error)?.message || "BulkSMSBD legacy request failed",
      };
    }
  }
}

export const bulkSmsBdProvider = new BulkSmsBdProvider();
