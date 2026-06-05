/**
 * Admin SMS Center — dashboard, send, bulk, logs, balance, retry.
 */
import {
  getSmsBalance,
  getSmsDashboardStats,
  listSmsLogs,
  retryFailedSms,
  sendBulkSMS,
  sendCampaignSMS,
  sendSMS,
} from "../../../../shared/services/sms/sms.service";
import { normalizePhone } from "../campaign/campaign.utils";

export async function getDashboard() {
  return getSmsDashboardStats();
}

export async function getBalance() {
  return getSmsBalance();
}

export async function getLogs(input: {
  page?: number;
  pageSize?: number;
  status?: string;
  phone?: string;
}) {
  return listSmsLogs(input);
}

export async function sendSingleSms(input: { phone: string; message: string }) {
  const phone = normalizePhone(input.phone);
  const message = input.message?.trim();
  if (!message || message.length < 1) throw new Error("Message is required");
  if (message.length > 500) throw new Error("Message must be 500 characters or fewer");
  return sendSMS({ phone, message, template: "ADMIN_SINGLE" });
}

export async function sendBulkAdminSms(input: { phones: string[]; message: string }) {
  const message = input.message?.trim();
  if (!message || message.length < 3) throw new Error("Message is required (min 3 characters)");
  const phones = input.phones.map(normalizePhone).filter((p) => p.length >= 10);
  return sendBulkSMS({ phones, message, template: "ADMIN_BULK" });
}

export async function sendCampaignAnnouncement(input: {
  phones: string[];
  message: string;
  campaignId?: number;
}) {
  const message = input.message?.trim();
  if (!message) throw new Error("Message is required");
  const phones = input.phones.map(normalizePhone).filter((p) => p.length >= 10);
  let queued = 0;
  let failed = 0;
  for (const phone of phones) {
    const result = await sendCampaignSMS({
      phone,
      message,
      campaignId: input.campaignId,
      template: "CAMPAIGN_ANNOUNCEMENT",
    });
    if (result.success) queued++;
    else failed++;
  }
  return { recipientCount: phones.length, queued, failed };
}

export async function retrySms(logId: number) {
  return retryFailedSms(logId);
}
