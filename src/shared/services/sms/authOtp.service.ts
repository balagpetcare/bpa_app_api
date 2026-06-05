/**
 * Auth OTP SMS — login, register, forgot password, phone verification.
 * Uses central SMS service; wire from auth routes when OTP auth is enabled.
 */
import { sendOtpSMS } from "./sms.service";
import type { OtpPurpose, SmsSendResult } from "./sms.types";

export async function sendAuthOtpSms(
  phone: string,
  otp: string,
  purpose: Exclude<OtpPurpose, "CAMPAIGN_BOOKING">
): Promise<SmsSendResult> {
  return sendOtpSMS({ phone, otp, purpose });
}

export default { sendAuthOtpSms };
