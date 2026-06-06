import axios from "axios";
import type { SmsBalanceResult, SmsProvider, SmsSendContext, SmsSendResult } from "./types";
import { formatBdMsisdn } from "./phone";
import {
  getSmsApiKey,
  getSmsApiUrl,
  getSmsBalanceApiUrl,
  getSmsDefaultMessageType,
  getSmsSenderId,
} from "../../shared/services/sms/sms.constants";

type BulkSmsBdMode = "rest_v3" | "legacy";

function getMode(): BulkSmsBdMode {
  const method = String(process.env.SMS_API_METHOD || "").toUpperCase();
  if (method === "GET") return "legacy";
  const provider = String(process.env.SMS_PROVIDER || "").toLowerCase();
  if (provider === "bulksmsbd") return "legacy";
  const mode = String(process.env.BULKSMSBD_API_MODE || "rest_v3").toLowerCase();
  return mode === "legacy" ? "legacy" : "rest_v3";
}

function getTimeoutMs(): number {
  return Number(process.env.SMS_TIMEOUT_MS || process.env.SMS_HTTP_TIMEOUT_MS || 15000);
}

export class BulkSmsBdProvider implements SmsProvider {
  readonly name = "bulksmsbd";

  isConfigured(): boolean {
    return Boolean(getSmsApiKey() && getSmsSenderId());
  }

  async send(phone: string, message: string, context?: SmsSendContext): Promise<SmsSendResult> {
    return getMode() === "legacy"
      ? this.sendLegacy(phone, message, context)
      : this.sendRestV3(phone, message, context);
  }

  async sendOtp(phone: string, otp: string, context?: SmsSendContext): Promise<SmsSendResult> {
    const message = `Your BPA verification code is ${otp}. Valid for 5 minutes. Do not share this code.`;
    return this.send(phone, message, { ...context, template: context?.template || "OTP" });
  }

  async getBalance(): Promise<SmsBalanceResult> {
    const apiKey = getSmsApiKey();
    if (!apiKey) {
      return { success: false, error: "BulkSMSBD API key not configured" };
    }

    const url = getSmsBalanceApiUrl();
    try {
      const response = await axios.get(url, {
        timeout: getTimeoutMs(),
        params: { api_key: apiKey },
        validateStatus: () => true,
      });

      const body = response.data;
      if (response.status >= 200 && response.status < 300) {
        const balance =
          typeof body === "object" && body !== null
            ? (body as { balance?: number | string }).balance ??
              (body as { data?: { balance?: number | string } }).data?.balance ??
              body
            : body;
        return { success: true, balance, raw: body };
      }

      return {
        success: false,
        error: `Balance API HTTP ${response.status}`,
        raw: body,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error)?.message || "BulkSMSBD balance check failed",
      };
    }
  }

  private async sendRestV3(
    phone: string,
    message: string,
    _context?: SmsSendContext
  ): Promise<SmsSendResult> {
    const apiToken = getSmsApiKey();
    const senderId = getSmsSenderId();
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
          timeout: getTimeoutMs(),
          headers: {
            Authorization: `Bearer ${apiToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          validateStatus: () => true,
        }
      );

      return this.parseRestResponse(response.status, response.data);
    } catch (error) {
      return {
        success: false,
        provider: this.name,
        error: (error as Error)?.message || "BulkSMSBD request failed",
      };
    }
  }

  private parseRestResponse(status: number, data: unknown): SmsSendResult {
    const body = data as {
      status?: string;
      message?: string;
      data?: { uid?: string; id?: string | number };
    };

    const ok =
      status >= 200 &&
      status < 300 &&
      (String(body?.status || "").toLowerCase() === "success" ||
        Boolean(body?.data?.uid || body?.data?.id));

    if (ok) {
      const messageId = String(body?.data?.uid ?? body?.data?.id ?? `bulksmsbd-${Date.now()}`);
      return { success: true, provider: this.name, messageId, raw: data };
    }

    return {
      success: false,
      provider: this.name,
      error: body?.message || `BulkSMSBD HTTP ${status}`,
      raw: data,
    };
  }

  private async sendLegacy(
    phone: string,
    message: string,
    _context?: SmsSendContext
  ): Promise<SmsSendResult> {
    const apiKey = getSmsApiKey();
    const senderId = getSmsSenderId();
    const legacyUrl = getSmsApiUrl();
    const messageType = getSmsDefaultMessageType();

    if (!apiKey || !senderId) {
      return { success: false, provider: this.name, error: "BulkSMSBD legacy API is not configured" };
    }

    try {
      const response = await axios.get(legacyUrl, {
        timeout: getTimeoutMs(),
        params: {
          api_key: apiKey,
          type: messageType,
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
