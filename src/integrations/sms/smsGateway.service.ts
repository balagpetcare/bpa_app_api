import type { SmsProvider, SmsProviderName, SmsSendContext, SmsSendResult } from "./types";
import { sslWirelessProvider } from "./sslWireless.provider";
import { bulkSmsBdProvider } from "./bulkSmsBd.provider";
import { mockSmsProvider } from "./mock.provider";

const providers: Record<SmsProviderName, SmsProvider> = {
  ssl_wireless: sslWirelessProvider,
  bulksmsbd: bulkSmsBdProvider,
  mock: mockSmsProvider,
};

function resolveProviderName(raw?: string | null): SmsProviderName {
  const value = String(raw || "").toLowerCase();
  if (value === "ssl_wireless" || value === "sslwireless" || value === "ssl") return "ssl_wireless";
  if (value === "bulksmsbd" || value === "bulk_sms_bd" || value === "bulk") return "bulksmsbd";
  return "mock";
}

export function getSmsProvider(name?: string): SmsProvider {
  return providers[resolveProviderName(name)];
}

export function getPrimarySmsProvider(): SmsProvider {
  const primary = resolveProviderName(process.env.SMS_PRIMARY_PROVIDER || process.env.SMS_PROVIDER || "ssl_wireless");
  const provider = providers[primary];
  if (provider.isConfigured()) return provider;
  if (process.env.NODE_ENV === "production" && process.env.SMS_ALLOW_MOCK !== "true") {
    return provider;
  }
  return mockSmsProvider;
}

export function getFallbackSmsProvider(primary: SmsProvider): SmsProvider | null {
  const fallbackName = resolveProviderName(process.env.SMS_FALLBACK_PROVIDER || "bulksmsbd");
  if (fallbackName === primary.name) return null;
  const fallback = providers[fallbackName];
  return fallback.isConfigured() ? fallback : null;
}

export function isSmsEnabled(): boolean {
  if (process.env.SMS_ENABLED === "false" || process.env.SMS_ENABLED === "0") return false;
  if (process.env.NODE_ENV === "test") return true;
  const primaryName = resolveProviderName(process.env.SMS_PRIMARY_PROVIDER || "ssl_wireless");
  const primary = providers[primaryName];
  if (primary.isConfigured()) return true;
  if (process.env.NODE_ENV === "production") {
    return process.env.SMS_ALLOW_MOCK === "true";
  }
  return process.env.SMS_ALLOW_MOCK === "true" || getPrimarySmsProvider().name === "mock";
}

export type SmsFailureLogEntry = {
  phone: string;
  provider: string;
  error: string;
  attempt?: number;
  jobId?: string;
  template?: string;
  campaignSmsLogId?: number;
  at: string;
};

const failureBuffer: SmsFailureLogEntry[] = [];

export function logSmsFailure(entry: Omit<SmsFailureLogEntry, "at">): void {
  const row: SmsFailureLogEntry = { ...entry, at: new Date().toISOString() };
  failureBuffer.push(row);
  if (failureBuffer.length > 500) failureBuffer.shift();
  console.warn("[SmsGateway] send failed", JSON.stringify(row));
}

export function getRecentSmsFailures(limit = 50): SmsFailureLogEntry[] {
  return failureBuffer.slice(-limit);
}

export async function sendSmsViaGateway(
  phone: string,
  message: string,
  context: SmsSendContext = {}
): Promise<SmsSendResult> {
  if (!isSmsEnabled()) {
    return mockSmsProvider.send(phone, message, context);
  }

  const primary = getPrimarySmsProvider();
  const fallback = getFallbackSmsProvider(primary);

  let result = await primary.send(phone, message, context);
  if (result.success) return result;

  logSmsFailure({
    phone,
    provider: primary.name,
    error: result.error || "Primary provider failed",
    jobId: context.jobId,
    template: context.template,
    campaignSmsLogId: context.campaignSmsLogId,
  });

  if (fallback) {
    result = await fallback.send(phone, message, context);
    if (result.success) return result;
    logSmsFailure({
      phone,
      provider: fallback.name,
      error: result.error || "Fallback provider failed",
      jobId: context.jobId,
      template: context.template,
      campaignSmsLogId: context.campaignSmsLogId,
    });
  }

  throw new Error(result.error || "All SMS providers failed");
}

export { providers as smsProviders };
