/**
 * Shared SMS send entry point for API services and fallbacks.
 */
import { sendSmsViaGateway } from "../../../integrations/sms/smsGateway.service";
import type { SmsSendContext, SmsSendResult } from "../../../integrations/sms/types";

export async function sendSms(
  phone: string,
  message: string,
  context?: SmsSendContext
): Promise<SmsSendResult> {
  return sendSmsViaGateway(phone, message, context);
}

export default { sendSms };
