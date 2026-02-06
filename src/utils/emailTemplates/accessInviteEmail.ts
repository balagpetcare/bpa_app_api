type AccessInviteEmailParams = {
  toName?: string | null;
  roleLabel: string;
  scopeLabel: string;
  inviteLink: string;
  expiresAt?: Date | string | null;
};

exports.renderAccessInviteEmail = function renderAccessInviteEmail(p: AccessInviteEmailParams) {
  const nameLine = p.toName ? `Hi ${escapeHtml(String(p.toName))},` : "Hi,";
  const role = escapeHtml(String(p.roleLabel || "ADMIN"));
  const scope = escapeHtml(String(p.scopeLabel || "your region"));
  const expires = p.expiresAt ? new Date(p.expiresAt as any) : null;
  const expiresText = expires ? expires.toLocaleString() : "-";
  const link = String(p.inviteLink || "");

  const subject = `You're invited to join BPA (${scope})`;

  const html = `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 24px;">
    <h2 style="color:#1f2937; margin: 0 0 12px;">BPA Invitation</h2>
    <p style="margin: 0 0 12px;">${nameLine}</p>
    <p style="margin: 0 0 16px; color:#374151;">
      You have been invited as <strong>${role}</strong> for <strong>${scope}</strong>.
      Please complete your registration using the button below.
    </p>
    <div style="text-align:center; margin: 24px 0;">
      <a href="${escapeAttr(link)}"
         style="background:#16a34a; color:#ffffff; padding:14px 24px; text-decoration:none; border-radius:6px; font-weight:bold; display:inline-block;">
        Complete Registration
      </a>
    </div>
    <p style="color:#6b7280; margin: 0 0 4px;">⏰ This invitation will expire on <strong>${escapeHtml(expiresText)}</strong>.</p>
    <p style="color:#9ca3af; font-size: 12px; margin-top: 20px;">
      If you did not expect this invitation, you can safely ignore this email.
    </p>
  </div>
  `;

  const text = `You are invited as ${role} for ${scope}.\n\nAccept: ${link}\n\nExpires: ${expiresText}`;
  return { subject, html, text };
};

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(s: string) {
  return escapeHtml(s).replace(/`/g, "&#096;");
}

export {};

