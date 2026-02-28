/**
 * Producer staff invite email service.
 * Loads HTML templates from utils/emailTemplates and sends via smtpMailer.
 */
import * as fs from "fs";
import * as path from "path";

const TEMPLATES_DIR = path.join(__dirname, "../../utils/emailTemplates");

function loadTemplate(name: string, variables: Record<string, string>): string {
  const filePath = path.join(TEMPLATES_DIR, `${name}.html`);
  let html: string;
  try {
    html = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : getFallbackInviteHtml(variables);
  } catch {
    html = getFallbackInviteHtml(variables);
  }
  Object.keys(variables).forEach((key) => {
    const regex = new RegExp(`{{${key}}}`, "g");
    html = html.replace(regex, variables[key] || "");
  });
  return html;
}

function getFallbackInviteHtml(v: Record<string, string>): string {
  return `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <h2>Staff invitation</h2>
  <p>You have been invited to join <strong>${v.orgName || "the producer"}</strong> as <strong>${v.roleName || "staff"}</strong>.</p>
  <p>Invited by: ${v.ownerName || "Owner"}.</p>
  ${v.expiryDate ? `<p>This invite expires on ${v.expiryDate}.</p>` : ""}
  <p><a href="${v.inviteLink || "#"}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Accept invitation</a></p>
  <p style="color:#666;font-size:12px;">This is an automated message from BPA.</p>
</body></html>`;
}

export type SendInviteEmailParams = {
  to: string;
  inviteLink: string;
  producerName: string;
  roleLabel: string;
  expiresAt: Date;
  ownerName?: string;
  customMessage?: string;
};

export async function sendInviteEmail(params: SendInviteEmailParams): Promise<{ messageId?: string } | { skipped: true; reason?: string }> {
  const { isSmtpEnabled, sendMail } = require("../../utils/smtpMailer");
  if (!isSmtpEnabled()) {
    return { skipped: true, reason: "SMTP not configured" };
  }
  const expiryDate = params.expiresAt ? params.expiresAt.toLocaleDateString(undefined, { dateStyle: "medium" }) : "";
  const variables: Record<string, string> = {
    orgName: params.producerName || "Producer",
    ownerName: params.ownerName || "The owner",
    roleName: params.roleLabel || "Staff",
    expiryDate,
    inviteLink: params.inviteLink || "#",
    customMessage: params.customMessage ? `<p class="custom-message">${String(params.customMessage).replace(/\n/g, "<br>")}</p>` : "",
  };
  const html = loadTemplate("producer_staff_invite", variables);
  const subject = `You're invited to join ${params.producerName} as ${params.roleLabel}`;
  const text = `You have been invited to join ${params.producerName} as ${params.roleLabel}. Invited by ${params.ownerName}. Expires: ${expiryDate}. Accept here: ${params.inviteLink}`;
  try {
    const result = await sendMail({ to: params.to, subject, html, text });
    return { messageId: (result as { messageId?: string }).messageId };
  } catch (err) {
    throw err;
  }
}

export type SendStaffInviteAcceptedToOwnerParams = {
  to: string;
  ownerName: string;
  staffDisplayName: string;
  orgName: string;
  roleLabel: string;
  staffListUrl: string;
};

export async function sendStaffInviteAcceptedToOwner(
  params: SendStaffInviteAcceptedToOwnerParams
): Promise<{ messageId?: string } | { skipped: true; reason?: string }> {
  const { isSmtpEnabled, sendMail } = require("../../utils/smtpMailer");
  if (!isSmtpEnabled()) return { skipped: true, reason: "SMTP not configured" };
  const variables: Record<string, string> = {
    ownerName: params.ownerName || "Owner",
    staffDisplayName: params.staffDisplayName || "A staff member",
    orgName: params.orgName || "your producer",
    roleLabel: params.roleLabel || "staff",
    staffListUrl: params.staffListUrl || "#",
  };
  const html = loadTemplate("producer_staff_invite_accepted", variables);
  const subject = `${params.staffDisplayName} accepted your staff invitation`;
  const text = `${params.staffDisplayName} has accepted your invitation to join ${params.orgName} as ${params.roleLabel}. View staff: ${params.staffListUrl}`;
  try {
    const result = await sendMail({ to: params.to, subject, html, text });
    return { messageId: (result as { messageId?: string }).messageId };
  } catch (err) {
    throw err;
  }
}
