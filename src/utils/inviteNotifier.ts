/**
 * Invite notifier (SMS/Email integration point)
 *
 * - EMAIL: sends SMTP email via nodemailer if SMTP is configured
 * - SMS: placeholder (logs only)
 */

type SendInviteArgs = {
  channel: "EMAIL" | "SMS";
  to: string;
  message: string;
  // Optional rich data for email template
  email?: {
    subject: string;
    html: string;
    text?: string;
  };
};

exports.sendInvite = async function sendInvite(args: SendInviteArgs) {
  const channel = String(args.channel || "EMAIL").toUpperCase();
  const to = String(args.to || "").trim();
  const msg = String(args.message || "").trim();

  if (!to) {
    // eslint-disable-next-line no-console
    console.log(`[INVITE:${channel}] skipped (missing recipient)`);
    return { success: false, skipped: true };
  }

  if (channel === "EMAIL") {
    try {
      const { isSmtpEnabled, sendMail } = require("./smtpMailer");
      if (!isSmtpEnabled()) {
        // eslint-disable-next-line no-console
        console.log(`[INVITE:EMAIL] SMTP not configured; fallback log. to=${to} message=${msg}`);
        return { success: true, fallback: "log" };
      }
      const subject = args.email?.subject || "BPA Invitation";
      const html = args.email?.html || `<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">${escapeHtml(msg)}</pre>`;
      const text = args.email?.text || msg;
      return await sendMail({ to, subject, html, text });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[INVITE:EMAIL] send failed", e);
      return { success: false, error: String(e?.message || e) };
    }
  }

  // SMS via central BPA SMS service
  if (channel === "SMS") {
    try {
      const { sendSMS } = require("../shared/services/sms/sms.service");
      return await sendSMS({ phone: to, message: msg, template: "STAFF_INVITE" });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[INVITE:SMS] send failed", e);
      return { success: false, error: String((e as Error)?.message || e) };
    }
  }
};

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export {};
