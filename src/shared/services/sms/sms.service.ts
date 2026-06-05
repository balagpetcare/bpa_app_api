/**
 * Central BPA/WPA SMS service — BulkSMSBD gateway, BullMQ queue, unified logging.
 */
import axios from "axios";
import { Queue } from "bullmq";
import prisma from "../../../infrastructure/db/prismaClient";
import { areRedisQueuesEnabled } from "../../../infrastructure/redis/redis.client";
import { getRedisConnectionOptions, isRedisEnabled } from "../../../infrastructure/redis/redisConnection";
import { sendSmsViaGateway } from "../../../integrations/sms/smsGateway.service";
import { formatBdMsisdn } from "../../../integrations/sms/phone";
import {
  getSmsApiKey,
  getSmsBaseUrl,
  getSmsProviderName,
  getSmsQueueAttempts,
  getSmsQueueBackoffMs,
  isSmsEnabled,
  SMS_BALANCE_API_PATH,
  SMS_BULK_MAX_RECIPIENTS,
  SMS_DEFAULT_TIMEOUT_MS,
  SMS_LEGACY_API_PATH,
  SMS_LEGACY_QUEUE_NAME,
  SMS_QUEUE_NAME,
} from "./sms.constants";
import { buildOtpMessage, buildTemplateMessage } from "./sms.templates";
import type {
  SendBulkSmsInput,
  SendCampaignSmsInput,
  SendOtpSmsInput,
  SendSmsInput,
  SmsBalanceResult,
  SmsDashboardStats,
  SmsJobPayload,
  SmsLogStatus,
  SmsSendResult,
  SmsTemplateKey,
} from "./sms.types";

export { buildOtpMessage, buildTemplateMessage, listSmsTemplates } from "./sms.templates";
export * from "./sms.constants";
export * from "./sms.types";

let _smsQueue: Queue<SmsJobPayload> | null = null;

function getSmsQueue(): Queue<SmsJobPayload> | null {
  if (_smsQueue) return _smsQueue;
  if (!isRedisEnabled() || !areRedisQueuesEnabled()) return null;
  try {
    _smsQueue = new Queue(SMS_QUEUE_NAME, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: {
        attempts: getSmsQueueAttempts(),
        backoff: { type: "exponential", delay: getSmsQueueBackoffMs() },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
  } catch (err) {
    console.warn("[SmsService] queue init failed:", (err as Error).message);
    return null;
  }
  return _smsQueue;
}

function normalizePhone(phone: string): string {
  return formatBdMsisdn(phone);
}

function serializeResponse(raw: unknown): string | null {
  if (raw == null) return null;
  try {
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    return text.slice(0, 2000);
  } catch {
    return String(raw).slice(0, 2000);
  }
}

export async function createSmsLog(input: {
  phone: string;
  message: string;
  provider?: string;
  status?: SmsLogStatus;
  response?: unknown;
  template?: string;
  externalId?: string;
  errorMessage?: string;
}): Promise<number> {
  const row = await prisma.smsLog.create({
    data: {
      phone: normalizePhone(input.phone),
      message: input.message,
      provider: input.provider || getSmsProviderName(),
      status: input.status || "QUEUED",
      response: serializeResponse(input.response),
      template: input.template,
      externalId: input.externalId,
      errorMessage: input.errorMessage?.slice(0, 500),
    },
  });
  return row.id;
}

async function updateSmsLog(
  logId: number,
  data: {
    status?: SmsLogStatus;
    response?: unknown;
    externalId?: string;
    errorMessage?: string;
    provider?: string;
    sent?: boolean;
    attemptIncrement?: boolean;
  }
): Promise<void> {
  await prisma.smsLog.update({
    where: { id: logId },
    data: {
      status: data.status,
      response: data.response != null ? serializeResponse(data.response) : undefined,
      externalId: data.externalId,
      errorMessage: data.errorMessage?.slice(0, 500),
      provider: data.provider,
      sentAt: data.sent ? new Date() : undefined,
      attemptCount: data.attemptIncrement ? { increment: 1 } : undefined,
    },
  });
}

export async function enqueueSmsJob(payload: SmsJobPayload): Promise<boolean> {
  const queue = getSmsQueue();
  if (!queue) return false;
  await queue.add("send", payload);
  return true;
}

/** Low-level BulkSMSBD legacy API send (GET with URL-encoded params). */
export async function sendSmsDirectLegacy(phone: string, message: string): Promise<{
  success: boolean;
  messageId?: string;
  raw?: unknown;
  error?: string;
}> {
  const apiKey = getSmsApiKey();
  const senderId = process.env.SMS_SENDER_ID || process.env.BULKSMSBD_SENDER_ID;
  const baseUrl = getSmsBaseUrl();

  if (!apiKey || !senderId) {
    return { success: false, error: "SMS API key or sender ID not configured" };
  }

  try {
    const url = `${baseUrl}${SMS_LEGACY_API_PATH}`;
    const response = await axios.get(url, {
      timeout: Number(process.env.SMS_HTTP_TIMEOUT_MS || SMS_DEFAULT_TIMEOUT_MS),
      params: {
        api_key: apiKey,
        senderid: senderId,
        number: normalizePhone(phone),
        message,
        type: "text",
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
      return { success: true, messageId, raw: body };
    }

    const errorText =
      typeof body === "object" && body !== null && "error_message" in body
        ? String((body as { error_message: unknown }).error_message)
        : `BulkSMSBD response code ${code}`;

    return { success: false, error: errorText, raw: body };
  } catch (err) {
    return { success: false, error: (err as Error).message || "SMS request failed" };
  }
}

async function deliverSms(
  logId: number,
  phone: string,
  message: string,
  template?: string
): Promise<SmsSendResult> {
  await updateSmsLog(logId, { status: "SENDING", attemptIncrement: true });

  try {
    const result = await sendSmsViaGateway(phone, message, {
      template,
      campaignSmsLogId: undefined,
    });

    if (result.success) {
      await updateSmsLog(logId, {
        status: "SENT",
        externalId: result.messageId,
        provider: result.provider,
        response: result.raw,
        sent: true,
      });
      return {
        success: true,
        logId,
        messageId: result.messageId,
        provider: result.provider,
      };
    }

    await updateSmsLog(logId, {
      status: "FAILED",
      errorMessage: result.error,
      provider: result.provider,
      response: result.raw,
    });
    return { success: false, logId, error: result.error, provider: result.provider };
  } catch (err) {
    const errorMessage = (err as Error).message || "Send failed";
    await updateSmsLog(logId, { status: "FAILED", errorMessage });
    return { success: false, logId, error: errorMessage };
  }
}

/**
 * Primary send entry point — queues when Redis available, otherwise sends directly.
 */
export async function sendSMS(input: SendSmsInput): Promise<SmsSendResult> {
  const phone = normalizePhone(input.phone);
  const message = input.message.trim();
  if (!phone || phone.length < 10) {
    return { success: false, error: "Invalid phone number" };
  }
  if (!message) {
    return { success: false, error: "Message is required" };
  }

  const logId = await createSmsLog({
    phone,
    message,
    template: input.template,
    status: "QUEUED",
  });

  if (!input.direct) {
    const queued = await enqueueSmsJob({
      logId,
      phone,
      message,
      template: input.template,
      meta: input.meta,
    });
    if (queued) {
      return { success: true, logId, queued: true };
    }
  }

  return deliverSms(logId, phone, message, input.template);
}

export async function sendBulkSMS(input: SendBulkSmsInput): Promise<{
  recipientCount: number;
  queued: number;
  failed: number;
  errors: string[];
}> {
  const message = input.message.trim();
  const phones = [...new Set(input.phones.map(normalizePhone).filter((p) => p.length >= 10))].slice(
    0,
    SMS_BULK_MAX_RECIPIENTS
  );

  let queued = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const phone of phones) {
    const result = await sendSMS({
      phone,
      message,
      template: input.template || "BULK_SMS",
      meta: input.meta,
    });
    if (result.success) queued++;
    else {
      failed++;
      if (result.error) errors.push(`${phone}: ${result.error}`);
    }
  }

  return { recipientCount: phones.length, queued, failed, errors: errors.slice(0, 20) };
}

export async function sendOtpSMS(input: SendOtpSmsInput): Promise<SmsSendResult> {
  const message = buildOtpMessage(input.otp, input.purpose);
  const template =
    input.purpose === "CAMPAIGN_BOOKING"
      ? "CAMPAIGN_OTP"
      : `AUTH_OTP_${input.purpose || "GENERIC"}`;

  return sendSMS({
    phone: input.phone,
    message,
    template,
    meta: { purpose: input.purpose, otp: false },
  });
}

export async function sendTemplatedSMS(
  phone: string,
  templateKey: SmsTemplateKey,
  vars: Record<string, string | number | undefined | null>
): Promise<SmsSendResult> {
  const message = buildTemplateMessage(templateKey, vars);
  return sendSMS({ phone, message, template: templateKey });
}

export async function sendCampaignSMS(input: SendCampaignSmsInput): Promise<SmsSendResult> {
  return sendSMS({
    phone: input.phone,
    message: input.message,
    template: input.template || "CAMPAIGN_SMS",
    meta: {
      campaignId: input.campaignId,
      bookingId: input.bookingId,
    },
  });
}

export async function getSmsBalance(): Promise<SmsBalanceResult> {
  const apiKey = getSmsApiKey();
  if (!apiKey) {
    return { success: false, error: "SMS API key not configured" };
  }

  const baseUrl = getSmsBaseUrl();
  const url = `${baseUrl}${SMS_BALANCE_API_PATH}`;

  try {
    const response = await axios.get(url, {
      timeout: Number(process.env.SMS_HTTP_TIMEOUT_MS || SMS_DEFAULT_TIMEOUT_MS),
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
  } catch (err) {
    return { success: false, error: (err as Error).message || "Balance check failed" };
  }
}

export async function listSmsLogs(input?: {
  page?: number;
  pageSize?: number;
  status?: string;
  phone?: string;
}) {
  const page = Math.max(1, input?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input?.pageSize ?? 25));
  const where: Record<string, unknown> = {};
  if (input?.status) where.status = input.status;
  if (input?.phone) where.phone = { contains: normalizePhone(input.phone) };

  const [items, total] = await Promise.all([
    prisma.smsLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.smsLog.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize) || 1,
  };
}

export async function retryFailedSms(logId: number): Promise<SmsSendResult> {
  const log = await prisma.smsLog.findUnique({ where: { id: logId } });
  if (!log) return { success: false, error: "SMS log not found" };
  if (log.status !== "FAILED") {
    return { success: false, error: "Only failed SMS can be retried" };
  }

  await updateSmsLog(logId, { status: "QUEUED", errorMessage: null });
  const queued = await enqueueSmsJob({
    logId,
    phone: log.phone,
    message: log.message,
    template: log.template ?? undefined,
  });

  if (queued) return { success: true, logId, queued: true };
  return deliverSms(logId, log.phone, log.message, log.template ?? undefined);
}

export async function getSmsDashboardStats(): Promise<SmsDashboardStats> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [total, sent, failed, queued, last24h] = await Promise.all([
    prisma.smsLog.count(),
    prisma.smsLog.count({ where: { status: { in: ["SENT", "DELIVERED"] } } }),
    prisma.smsLog.count({ where: { status: "FAILED" } }),
    prisma.smsLog.count({ where: { status: { in: ["QUEUED", "SENDING"] } } }),
    prisma.smsLog.count({ where: { createdAt: { gte: since24h } } }),
  ]);

  let queue: SmsDashboardStats["queue"] = null;
  const q = getSmsQueue();
  if (q) {
    try {
      const counts = await q.getJobCounts("waiting", "active", "failed", "delayed");
      queue = {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      };
    } catch {
      queue = null;
    }
  }

  return {
    total,
    sent,
    failed,
    queued,
    last24h,
    queue,
    providerConfigured: Boolean(getSmsApiKey() && process.env.SMS_SENDER_ID),
    smsEnabled: isSmsEnabled(),
  };
}

/** Process a queued SMS job (used by BullMQ worker). */
export async function processSmsQueueJob(payload: SmsJobPayload): Promise<string | null> {
  const result = await deliverSms(payload.logId, payload.phone, payload.message, payload.template);
  if (!result.success) throw new Error(result.error || "SMS delivery failed");
  return result.messageId || null;
}

export async function getSmsQueueJobCounts(): Promise<{
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
} | null> {
  const q = getSmsQueue();
  if (!q) return null;
  const counts = await q.getJobCounts("waiting", "active", "failed", "delayed");
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
  };
}

export { SMS_QUEUE_NAME, SMS_LEGACY_QUEUE_NAME };

export default {
  sendSMS,
  sendBulkSMS,
  sendOtpSMS,
  sendTemplatedSMS,
  sendCampaignSMS,
  getSmsBalance,
  listSmsLogs,
  retryFailedSms,
  getSmsDashboardStats,
  processSmsQueueJob,
};
