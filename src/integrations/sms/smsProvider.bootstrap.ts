import { getPrimarySmsProvider, isSmsEnabled } from "./smsGateway.service";
import {
  getSmsApiKey,
  getSmsProviderName,
  getSmsSenderId,
  isSmsIpWhitelistEnabled,
  validateSmsProviderConfig,
} from "../../shared/services/sms/sms.constants";

export type SmsBootstrapResult = {
  provider: string;
  enabled: boolean;
  ready: boolean;
  warnings: string[];
  errors: string[];
};

/**
 * Validates SMS env and logs active provider — call once on API startup.
 * When SMS_ENABLED=true but credentials missing, APIs return 503 on protected send routes.
 */
export function bootstrapSmsProvider(): SmsBootstrapResult {
  const validation = validateSmsProviderConfig();
  const provider = getSmsProviderName();
  const enabled = isSmsEnabled();
  const warnings: string[] = [];

  if (isSmsIpWhitelistEnabled()) {
    warnings.push(
      "SMS_IP_WHITELIST_ENABLED=true — ensure server egress IP is whitelisted in BulkSMSBD panel"
    );
  }

  const primary = getPrimarySmsProvider();
  const configured = primary.isConfigured();

  if (enabled && configured) {
    console.log(`[SMS] Active provider: ${provider} | configured: yes`);
    if (process.env.SMS_API_URL?.trim()) {
      console.log(`[SMS] API URL: ${process.env.SMS_API_URL.trim()}`);
    }
  } else if (enabled && !configured) {
    const msg = `[SMS] Active provider: ${provider} | NOT ready: ${validation.errors.join("; ")}`;
    console.warn(`${msg} — SMS send APIs will return 503 until configured.`);
    warnings.push(msg);
  } else if (!enabled) {
    console.log("[SMS] SMS_ENABLED=false — gateway sends will use mock/disabled path");
  }

  if (process.env.NODE_ENV === "production" && enabled && !configured && process.env.SMS_ALLOW_MOCK !== "true") {
    warnings.push("Production SMS enabled but provider credentials missing");
  }

  return {
    provider,
    enabled,
    ready: validation.ok && (configured || process.env.SMS_ALLOW_MOCK === "true"),
    warnings,
    errors: validation.errors,
  };
}

export function formatSmsNotConfiguredMessage(): string {
  const issues = validateSmsProviderConfig().errors;
  if (issues.length === 0) return "SMS provider is not configured";
  return `SMS provider is not configured (${issues.join("; ")})`;
}

export function assertSmsConfiguredForSend(): void {
  if (!isSmsEnabled()) return;
  if (process.env.SMS_ALLOW_MOCK === "true") return;
  const primary = getPrimarySmsProvider();
  if (!primary.isConfigured()) {
    throw new Error(formatSmsNotConfiguredMessage());
  }
  if (!getSmsApiKey() || !getSmsSenderId()) {
    throw new Error(formatSmsNotConfiguredMessage());
  }
}
