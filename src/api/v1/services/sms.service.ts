/**
 * Shared SMS send entry point for API services — delegates to central SMS module.
 */
import {
  sendSMS as sendSmsCentral,
  sendBulkSMS,
  sendOtpSMS,
  sendCampaignSMS,
  sendTemplatedSMS,
} from "../../../shared/services/sms/sms.service";
import type { SmsSendContext, SmsSendResult } from "../../../integrations/sms/types";

export async function sendSms(
  phone: string,
  message: string,
  context?: SmsSendContext
): Promise<SmsSendResult> {
  const result = await sendSmsCentral({
    phone,
    message,
    template: context?.template,
    meta: {
      jobId: context?.jobId,
      campaignSmsLogId: context?.campaignSmsLogId,
    },
  });

  return {
    success: result.success,
    messageId: result.messageId,
    provider: result.provider || "bulksmsbd",
    error: result.error,
  };
}

export {
  sendBulkSMS,
  sendOtpSMS,
  sendCampaignSMS,
  sendTemplatedSMS,
  sendSMS,
} from "../../../shared/services/sms/sms.service";

export default { sendSms };
