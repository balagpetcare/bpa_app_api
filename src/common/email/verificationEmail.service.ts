import * as fs from "fs";
import * as path from "path";

const TEMPLATES_DIR = path.join(__dirname, "../../utils/emailTemplates");

type CommonPayload = {
  to: string;
  recipientName?: string | null;
  entityType: string;
  entityName?: string | null;
  actionUrl?: string | null;
};

type ApprovedPayload = CommonPayload & {
  details?: string | null;
};

type RejectedPayload = CommonPayload & {
  reason?: string | null;
};

type ChangesRequestedPayload = CommonPayload & {
  notes?: string | null;
};

type SuspendedPayload = CommonPayload & {
  reason?: string | null;
};

type MailResult = { messageId?: string } | { skipped: true; reason?: string };

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loadTemplate(name: string, variables: Record<string, string>): string {
  const filePath = path.join(TEMPLATES_DIR, `${name}.html`);
  let html = "";
  try {
    html = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
  } catch {
    html = "";
  }

  if (!html) {
    html = `
<!DOCTYPE html>
<html>
  <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2>{{title}}</h2>
    <p>Hello {{recipientName}},</p>
    <p>{{message}}</p>
    <p><a href="{{actionUrl}}">Open Verification Center</a></p>
  </body>
</html>`;
  }

  Object.keys(variables).forEach((key) => {
    const regex = new RegExp(`{{${key}}}`, "g");
    html = html.replace(regex, variables[key] ?? "");
  });
  return html;
}

async function sendTemplateMail(args: {
  to: string;
  subject: string;
  templateName: string;
  variables: Record<string, string>;
  text: string;
}): Promise<MailResult> {
  const { isSmtpEnabled, sendMail } = require("../../utils/smtpMailer");
  if (!isSmtpEnabled()) {
    return { skipped: true, reason: "SMTP not configured" };
  }
  const html = loadTemplate(args.templateName, args.variables);
  const result = await sendMail({
    to: args.to,
    subject: args.subject,
    html,
    text: args.text,
  });
  return { messageId: (result as { messageId?: string })?.messageId };
}

function baseVariables(payload: CommonPayload) {
  return {
    recipientName: escapeHtml(payload.recipientName || "User"),
    entityType: escapeHtml(payload.entityType || "verification"),
    entityName: escapeHtml(payload.entityName || "your profile"),
    actionUrl: escapeHtml(payload.actionUrl || "http://localhost:3103"),
  };
}

export async function sendVerificationApprovedEmail(payload: ApprovedPayload): Promise<MailResult> {
  const vars = {
    ...baseVariables(payload),
    details: escapeHtml(payload.details || "No additional details were provided."),
  };
  return sendTemplateMail({
    to: payload.to,
    subject: `Verification approved - ${payload.entityType}`,
    templateName: "verification_approved",
    variables: vars,
    text: `Your ${payload.entityType} verification for ${payload.entityName || "your profile"} has been approved. ${payload.details || ""} ${payload.actionUrl || ""}`.trim(),
  });
}

export async function sendVerificationRejectedEmail(payload: RejectedPayload): Promise<MailResult> {
  const vars = {
    ...baseVariables(payload),
    reason: escapeHtml(payload.reason || "Please review your submission and try again."),
  };
  return sendTemplateMail({
    to: payload.to,
    subject: `Verification rejected - ${payload.entityType}`,
    templateName: "verification_rejected",
    variables: vars,
    text: `Your ${payload.entityType} verification for ${payload.entityName || "your profile"} was rejected. Reason: ${payload.reason || "Please review and resubmit."} ${payload.actionUrl || ""}`.trim(),
  });
}

export async function sendVerificationChangesRequestedEmail(payload: ChangesRequestedPayload): Promise<MailResult> {
  const vars = {
    ...baseVariables(payload),
    notes: escapeHtml(payload.notes || "Please review the submission and upload corrected files."),
  };
  return sendTemplateMail({
    to: payload.to,
    subject: `Changes requested - ${payload.entityType} verification`,
    templateName: "verification_changes_requested",
    variables: vars,
    text: `Changes were requested for your ${payload.entityType} verification for ${payload.entityName || "your profile"}. Note: ${payload.notes || "Please update and resubmit."} ${payload.actionUrl || ""}`.trim(),
  });
}

export async function sendVerificationSuspendedEmail(payload: SuspendedPayload): Promise<MailResult> {
  const vars = {
    ...baseVariables(payload),
    reason: escapeHtml(payload.reason || "Please contact support for details."),
  };
  return sendTemplateMail({
    to: payload.to,
    subject: `Verification suspended - ${payload.entityType}`,
    templateName: "verification_suspended",
    variables: vars,
    text: `Your ${payload.entityType} verification for ${payload.entityName || "your profile"} has been suspended. Note: ${payload.reason || "Contact support for details."} ${payload.actionUrl || ""}`.trim(),
  });
}

