import axios from "axios";
import type { SmsProvider, SmsSendContext, SmsSendResult } from "./types";
import { formatBdMsisdn, generateCsmsId } from "./phone";

export class SslWirelessProvider implements SmsProvider {
  readonly name = "ssl_wireless";

  isConfigured(): boolean {
    return Boolean(process.env.SSL_WIRELESS_API_TOKEN && (process.env.SSL_WIRELESS_SENDER_ID || process.env.CAMPAIGN_SMS_SENDER_ID));
  }

  async send(phone: string, message: string, context?: SmsSendContext): Promise<SmsSendResult> {
    const apiToken = process.env.SSL_WIRELESS_API_TOKEN;
    const senderId = process.env.SSL_WIRELESS_SENDER_ID || process.env.CAMPAIGN_SMS_SENDER_ID;
    const baseUrl = (process.env.SSL_WIRELESS_BASE_URL || "https://smsplus.sslwireless.com").replace(/\/+$/, "");

    if (!apiToken || !senderId) {
      return { success: false, provider: this.name, error: "SSL Wireless is not configured" };
    }

    const csmsId = generateCsmsId(context?.campaignSmsLogId ? `BPA${context.campaignSmsLogId}` : "BPA");

    try {
      const response = await axios.post(
        `${baseUrl}/api/v3/send-sms`,
        {
          api_token: apiToken,
          sid: senderId,
          msisdn: formatBdMsisdn(phone),
          sms: message,
          csms_id: csmsId,
        },
        {
          timeout: Number(process.env.SMS_HTTP_TIMEOUT_MS || 15000),
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          validateStatus: () => true,
        }
      );

      const data = response.data as {
        status?: string;
        message?: string;
        smsinfo?: Array<{ sms_status?: string; reference_id?: string }>;
        csms_id?: string;
      };

      const ok =
        response.status >= 200 &&
        response.status < 300 &&
        String(data?.status || "").toUpperCase() === "SUCCESS";

      if (ok) {
        const messageId = data.smsinfo?.[0]?.reference_id || data.csms_id || csmsId;
        return { success: true, provider: this.name, messageId, raw: data };
      }

      return {
        success: false,
        provider: this.name,
        error: data?.message || `SSL Wireless HTTP ${response.status}`,
        raw: data,
      };
    } catch (error) {
      return {
        success: false,
        provider: this.name,
        error: (error as Error)?.message || "SSL Wireless request failed",
      };
    }
  }
}

export const sslWirelessProvider = new SslWirelessProvider();
