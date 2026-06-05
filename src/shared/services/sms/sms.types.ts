export type SmsLogStatus = "QUEUED" | "SENDING" | "SENT" | "DELIVERED" | "FAILED";

export type OtpPurpose =
  | "LOGIN"
  | "REGISTER"
  | "FORGOT_PASSWORD"
  | "PHONE_VERIFICATION"
  | "CAMPAIGN_BOOKING";

export type SmsTemplateKey =
  | "OTP"
  | "PAYMENT_SUCCESS"
  | "PAYMENT_FAILED"
  | "BOOKING_REQUEST"
  | "SLOT_CONFIRMED"
  | "REMINDER_24H"
  | "CERTIFICATE_READY"
  | "CAMPAIGN_ANNOUNCEMENT";

export type SendSmsInput = {
  phone: string;
  message: string;
  template?: string;
  meta?: Record<string, unknown>;
  /** When false, bypass queue and send immediately. Default: queue when available. */
  direct?: boolean;
};

export type SendBulkSmsInput = {
  phones: string[];
  message: string;
  template?: string;
  meta?: Record<string, unknown>;
};

export type SendOtpSmsInput = {
  phone: string;
  otp: string;
  purpose?: OtpPurpose;
};

export type SendCampaignSmsInput = {
  phone: string;
  message: string;
  campaignId?: number;
  bookingId?: number;
  template?: string;
};

export type SmsSendResult = {
  success: boolean;
  logId?: number;
  messageId?: string;
  provider?: string;
  error?: string;
  queued?: boolean;
};

export type SmsBalanceResult = {
  success: boolean;
  balance?: number | string;
  raw?: unknown;
  error?: string;
};

export type SmsJobPayload = {
  logId: number;
  phone: string;
  message: string;
  template?: string;
  meta?: Record<string, unknown>;
};

export type SmsDashboardStats = {
  total: number;
  sent: number;
  failed: number;
  queued: number;
  last24h: number;
  queue: { waiting: number; active: number; failed: number; delayed: number } | null;
  providerConfigured: boolean;
  smsEnabled: boolean;
};
