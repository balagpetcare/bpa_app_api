export type SmsSendResult = {
  success: boolean;
  messageId?: string;
  provider: string;
  error?: string;
  raw?: unknown;
};

export type SmsDeliveryStatus = "SENT" | "DELIVERED" | "FAILED" | "UNKNOWN";

export type SmsSendContext = {
  jobId?: string;
  template?: string;
  campaignSmsLogId?: number;
};

export interface SmsProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(phone: string, message: string, context?: SmsSendContext): Promise<SmsSendResult>;
}

export type SmsProviderName = "ssl_wireless" | "bulksmsbd" | "mock";
