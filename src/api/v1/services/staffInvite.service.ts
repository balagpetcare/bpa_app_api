/**
 * Staff Invite Service
 * Shared logic for creating branch staff invites and notifying owner.
 * Used by both /owner/branches/:id/members/invite and /branches/:branchId/members/invite.
 * Role validation uses branchRoleMatrix (single source of truth).
 */

import {
  normalizeRole,
  canInviteRole,
  getAllowedInviteRolesForBranch,
  getInviteableRolesForInviter,
} from "../constants/branchRoleMatrix";

export { getAllowedInviteRolesForBranch, getInviteableRolesForInviter, normalizeRole };

export type CreateStaffInviteBody = {
  email?: string | null;
  phone?: string | null;
  displayName?: string | null;
  role: string;
  permissions?: unknown;
  name?: string | null;
  message?: string | null;
};

export type CreateStaffInviteResult = {
  invite: {
    id: number;
    orgId: number;
    branchId: number;
    role: string;
    status: string;
    expiresAt: Date;
  };
  rawToken: string;
};

/**
 * Create a staff invite for a branch, send email/SMS, and notify org owner.
 * Caller must ensure the inviter has permission (owner or branch manager).
 * inviterRole: OWNER | ORG_OWNER | ORG_ADMIN | BRANCH_MANAGER | DELIVERY_MANAGER (used for role validation).
 */
export async function createStaffInvite(
  prisma: any,
  branchId: number,
  body: CreateStaffInviteBody,
  invitedByUserId: number,
  inviterRole: string | null | undefined
): Promise<CreateStaffInviteResult> {
  const { phone, email, displayName, role } = body;

  if (!role) throw new Error("role is required");

  const emailNorm = (email || "").trim().toLowerCase() || null;
  const phoneNorm = (phone || "").trim().replace(/\D/g, "") || null;

  if (!emailNorm && !phoneNorm) {
    throw new Error("phone or email is required");
  }

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      id: true,
      orgId: true,
      name: true,
      types: { select: { type: { select: { code: true } } } },
      org: { select: { ownerUserId: true } },
    },
  });

  if (!branch) throw new Error("Branch not found");

  const roleNorm = normalizeRole(role);
  const check = canInviteRole(inviterRole, roleNorm, branch);
  if (!check.allowed) {
    throw new Error(check.message || "Invalid role for this branch type");
  }

  const crypto = require("crypto");
  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3); // 72h

  const invite = await prisma.staffInvite.create({
    data: {
      orgId: branch.orgId,
      branchId: branch.id,
      role: roleNorm,
      status: "PENDING",
      email: emailNorm,
      phone: phoneNorm,
      displayName: displayName ? String(displayName) : null,
      tokenHash,
      expiresAt,
      invitedByUserId,
    },
  });

  const { sendInvite } = require("../../../utils/inviteNotifier");
  const channel = phoneNorm ? "SMS" : "EMAIL";
  const to = phoneNorm ? phoneNorm : emailNorm;
  const base = String(process.env.PANEL_PUBLIC_URL || process.env.PUBLIC_WEB_URL || "").replace(/\/$/, "");
  const link = `${base}/register?invite=${rawToken}`;
  const msg = `BPA Invite: You are invited as ${roleNorm} for branch "${branch.name}". Complete registration: ${link}`;

  let emailPayload: { subject: string; html: string; text: string } | undefined;
  if (channel === "EMAIL") {
    const { renderInviteEmail } = require("../../../utils/emailTemplates/inviteEmail");
    const rendered = renderInviteEmail({
      toName: displayName || null,
      role: roleNorm,
      branchName: branch?.name || null,
      orgName: null,
      inviteLink: link,
      expiresAt,
    });
    emailPayload = { subject: rendered.subject, html: rendered.html, text: rendered.text };
  }

  await sendInvite({ channel, to, message: msg, email: emailPayload });

  const targetEmailOrPhone = emailNorm || phoneNorm || "";
  const dedupeKey = `invite_created:${branchId}:${targetEmailOrPhone}`;
  const ownerUserId = (branch as any).org?.ownerUserId;
  if (ownerUserId) {
    const { createNotification } = require("./notification.service");
    await createNotification({
      userId: ownerUserId,
      type: "SYSTEM",
      title: "Staff invite created",
      message: `A staff invite was created for branch "${branch.name}" (${emailNorm || phoneNorm}).`,
      meta: { inviteId: invite.id, branchId, branchName: branch.name, email: emailNorm, phone: phoneNorm },
      priority: "P2",
      actionUrl: "/owner/invitations",
      dedupeKey,
    }).catch((err: Error) => console.error("[NOTIFICATION] invite created owner:", err?.message));
  }

  return {
    invite: {
      id: invite.id,
      orgId: invite.orgId,
      branchId: invite.branchId,
      role: invite.role,
      status: invite.status,
      expiresAt: invite.expiresAt,
    },
    rawToken,
  };
}
