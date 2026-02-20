type InviteEmailParams = {
  toName?: string | null;
  role: string;
  branchName?: string | null;
  orgName?: string | null;
  inviteLink: string;
  expiresAt?: Date | string | null;
};

exports.renderInviteEmail = function renderInviteEmail(p: InviteEmailParams) {
  const role = String(p.role || "STAFF");
  const nameLine = p.toName ? `Hi ${escapeHtml(String(p.toName))},` : "Hi,";
  const org = p.orgName ? String(p.orgName) : "Bangladesh Pet Association";
  const branch = p.branchName ? ` for branch “${escapeHtml(String(p.branchName))}”` : "";
  const expires = p.expiresAt ? new Date(p.expiresAt as any) : null;
  const expiresText = expires ? expires.toLocaleString() : "-";
  const link = String(p.inviteLink || "");

  const subject = `You're invited to join ${org}`;

  const html = `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 24px;">
    <h2 style="color:#1f2937; margin: 0 0 12px;">Welcome to ${escapeHtml(org)} 🐾</h2>
    <p style="margin: 0 0 12px;">${nameLine}</p>
    <p style="margin: 0 0 16px; color:#374151;">
      You have been invited as <strong>${escapeHtml(role)}</strong>${branch}.
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
    <p style="color:#9ca3af; font-size: 12px;">© ${escapeHtml(org)}</p>
  </div>
  `;

  const text = `You are invited as ${role}${p.branchName ? ` for branch "${p.branchName}"` : ""}.\n\nAccept: ${link}\n\nExpires: ${expiresText}`;

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
  // minimal attr escaping
  return escapeHtml(s).replace(/`/g, "&#096;");
}

export {};
