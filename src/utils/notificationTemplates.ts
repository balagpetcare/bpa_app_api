/**
 * Simple templates for notification email/SMS by type.
 */
export function renderNotificationEmail(type: string, data: { title: string; message: string; actionUrl?: string | null }): { subject: string; html: string; text: string } {
  const { title, message, actionUrl } = data;
  if (type === "OWNER_KYC_SUBMITTED") {
    const subject = "BPA Owner KYC Submitted – Pending Review";
    const body = [
      "Your Owner KYC has been submitted and is under review.",
      "You can continue setting up branches and products while we review.",
      actionUrl ? `Open Owner Dashboard: ${actionUrl}` : "",
    ].filter(Boolean).join("\n\n");
    const html = `
      <h2>${escapeHtml(subject)}</h2>
      <p>${escapeHtml(message)}</p>
      <p>You can continue setting up branches and products while we review.</p>
      ${actionUrl ? `<p><a href="${escapeHtml(actionUrl)}">Open Owner Dashboard</a></p>` : ""}
    `.trim();
    return { subject, html, text: body };
  }
  const subject = title || "BPA Notification";
  const text = [message, actionUrl ? `Link: ${actionUrl}` : ""].filter(Boolean).join("\n\n");
  const html = `
    <h2>${escapeHtml(subject)}</h2>
    <p>${escapeHtml(message)}</p>
    ${actionUrl ? `<p><a href="${escapeHtml(actionUrl)}">View</a></p>` : ""}
  `.trim();
  return { subject, html, text };
}

export function renderNotificationSms(type: string, data: { title: string; message: string; actionUrl?: string | null }): string {
  const { title, message, actionUrl } = data;
  const parts = [title, message];
  if (actionUrl) parts.push(actionUrl);
  return parts.join(" – ").slice(0, 320);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
