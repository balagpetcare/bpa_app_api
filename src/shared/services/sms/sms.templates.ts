import type { OtpPurpose, SmsTemplateKey } from "./sms.types";

type TemplateVars = Record<string, string | number | undefined | null>;

function pick(vars: TemplateVars, key: string, fallback = ""): string {
  const v = vars[key];
  return v == null ? fallback : String(v);
}

/** Replace `{Key}` and `{{key}}` placeholders in a template string. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    if (value == null) continue;
    const str = String(value);
    out = out.replace(new RegExp(`\\{${key}\\}`, "g"), str);
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, "gi"), str);
  }
  return out;
}

const TEMPLATE_BODIES: Record<SmsTemplateKey, string> = {
  OTP: "Your BPA OTP is {OTP}",

  PAYMENT_SUCCESS: `Dear {CustomerName},

Your BPA Cat Flu & Rabies Vaccination booking has been confirmed.

Booking ID: {BookingId}
Date: {Date}
Location: {Location}

Thank you.
Bangladesh Pet Association`,

  PAYMENT_FAILED: `Dear {CustomerName},

Your payment could not be completed.
Please try again.

Booking ID: {BookingId}

Bangladesh Pet Association`,

  BOOKING_REQUEST: `Dear {CustomerName},

Your booking request has been received.

Booking ID: {BookingId}

You will receive further updates shortly.`,

  SLOT_CONFIRMED: `Your vaccination slot has been confirmed.

Date: {Date}
Time: {Time}
Location: {Location}

Booking ID: {BookingId}`,

  REMINDER_24H: `Reminder:

Your BPA vaccination appointment is tomorrow.

Date: {Date}
Time: {Time}
Location: {Location}`,

  CERTIFICATE_READY: `Your BPA vaccination certificate is ready.

Certificate ID: {CertificateId}

Download from your BPA account.`,

  CAMPAIGN_ANNOUNCEMENT: "{message}",
};

export function buildOtpMessage(otp: string, _purpose?: OtpPurpose): string {
  return renderTemplate(TEMPLATE_BODIES.OTP, { OTP: otp, otp });
}

export function buildTemplateMessage(key: SmsTemplateKey, vars: TemplateVars): string {
  const body = TEMPLATE_BODIES[key];
  if (!body) throw new Error(`Unknown SMS template: ${key}`);
  return renderTemplate(body, vars);
}

export function listSmsTemplates(): { key: SmsTemplateKey; body: string }[] {
  return (Object.keys(TEMPLATE_BODIES) as SmsTemplateKey[]).map((key) => ({
    key,
    body: TEMPLATE_BODIES[key],
  }));
}

export { TEMPLATE_BODIES as SMS_TEMPLATE_BODIES };
