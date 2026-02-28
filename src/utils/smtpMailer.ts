/**
 * Minimal SMTP mailer using nodemailer.
 *
 * Env:
 *  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *  SMTP_SECURE ("true"/"false") optional
 *  SMTP_FROM (e.g. "BPA <noreply@balagpetclinic.com>") optional
 */

type SendMailArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

type Attachment = { filename: string; content: Buffer | string };

type SendMailWithAttachmentArgs = SendMailArgs & {
  attachments?: Attachment[];
};

function getSmtpConfig() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const secureEnv = String(process.env.SMTP_SECURE || "").trim().toLowerCase();
  const secure = secureEnv ? secureEnv === "true" : port === 465;
  const from = String(process.env.SMTP_FROM || "").trim() || "BPA <no-reply@localhost>";

  return { host, port, user, pass, secure, from };
}

exports.isSmtpEnabled = function isSmtpEnabled() {
  const c = getSmtpConfig();
  return Boolean(c.host && c.port && c.user && c.pass);
};

exports.sendMail = async function sendMail(args: SendMailArgs) {
  const nodemailer = require("nodemailer");
  const c = getSmtpConfig();

  if (!c.host || !c.user || !c.pass) {
    throw new Error("SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS)");
  }

  const transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: {
      user: c.user,
      pass: c.pass,
    },
  });

  const info = await transporter.sendMail({
    from: c.from,
    to: args.to,
    subject: args.subject,
    text: args.text,
    html: args.html,
  });

  return { success: true, messageId: info?.messageId };
};

exports.sendMailWithAttachment = async function sendMailWithAttachment(args: SendMailWithAttachmentArgs) {
  const nodemailer = require("nodemailer");
  const c = getSmtpConfig();

  if (!c.host || !c.user || !c.pass) {
    throw new Error("SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS)");
  }

  const transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: { user: c.user, pass: c.pass },
  });

  const mailOptions: Record<string, unknown> = {
    from: c.from,
    to: args.to,
    subject: args.subject,
    text: args.text,
    html: args.html,
  };
  if (args.attachments && args.attachments.length > 0) {
    mailOptions.attachments = args.attachments.map((a) => ({ filename: a.filename, content: a.content }));
  }

  const info = await transporter.sendMail(mailOptions);
  return { success: true, messageId: info?.messageId };
};

export {};
