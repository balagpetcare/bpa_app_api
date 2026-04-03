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
import { StaffInviteDuplicatePendingError } from "./staffInvite.errors";

/** Audit actor role for AuditLog (must match AuditActorRole enum). */
type AuditActorRole = "OWNER" | "ADMIN" | "SUPER_ADMIN" | "STAFF" | "USER";

/**
 * Write a STAFF_INVITE audit log entry. Does not throw.
 */
export async function logStaffInviteAudit(
  prisma: any,
  opts: {
    actorId: number;
    actorRole: AuditActorRole;
    action: string; // INVITE_CREATED | INVITE_RESENT | INVITE_CANCELLED | INVITE_ACCEPTED | INVITE_DECLINED
    inviteId: number;
    branchId?: number | null;
    warehouseId?: number | null;
    targetType?: "BRANCH" | "WAREHOUSE";
    after?: Record<string, unknown>;
    before?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: String(opts.actorId),
        actorRole: opts.actorRole,
        action: opts.action,
        entityType: "STAFF_INVITE",
        entityId: String(opts.inviteId),
        before: (opts.before ?? null) as any,
        after: {
          ...(opts.after ?? {}),
          branchId: opts.branchId ?? null,
          warehouseId: opts.warehouseId ?? null,
          targetType: opts.targetType ?? (opts.warehouseId ? "WAREHOUSE" : "BRANCH"),
          inviteId: opts.inviteId,
        } as any,
      },
    });
  } catch (e: any) {
    console.error("[STAFF_INVITE] audit log error:", e?.message || e);
  }
}

export { getAllowedInviteRolesForBranch, getInviteableRolesForInviter, normalizeRole };

export type CreateStaffInviteBody = {
  email?: string | null;
  phone?: string | null;
  displayName?: string | null;
  role: string;
  permissions?: unknown;
  name?: string | null;
  message?: string | null;
  inviteAsDoctor?: boolean;
  /** When set, linked warehouse staff assignment is prepared after accept (unified flow). */
  warehouseId?: number | null;
};

export type CreateStaffInviteResult = {
  invite: {
    id: number;
    orgId: number;
    branchId?: number | null;
    warehouseId?: number | null;
    role?: string | null;
    warehouseRole?: string | null;
    targetType: "BRANCH" | "WAREHOUSE";
    status: string;
    expiresAt: Date;
  };
  /** Null when `existingPending` — use share UI / resend; do not expose old token. */
  rawToken: string | null;
  /** Same recipient + branch + role + doctor flag: existing non-expired PENDING row reused. */
  existingPending?: boolean;
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
  const { phone, email, displayName, role, inviteAsDoctor } = body;

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

  // Duplicate: same branch + recipient — idempotent return, or structured conflict if role differs
  const existing = await prisma.staffInvite.findFirst({
    where: {
      branchId,
      targetType: "BRANCH",
      status: "PENDING",
      OR: [
        ...(emailNorm ? [{ email: { equals: emailNorm, mode: "insensitive" } }] : []),
        ...(phoneNorm ? [{ phone: phoneNorm }] : []),
      ].filter(Boolean),
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      orgId: true,
      branchId: true,
      warehouseId: true,
      role: true,
      warehouseRole: true,
      status: true,
      expiresAt: true,
      inviteAsDoctor: true,
    },
  });
  if (existing) {
    const sameRole = normalizeRole(String(existing.role || "")) === roleNorm;
    const sameDoctor = Boolean(existing.inviteAsDoctor) === Boolean(inviteAsDoctor);
    if (sameRole && sameDoctor) {
      return {
        invite: {
          id: existing.id,
          orgId: existing.orgId,
          branchId: existing.branchId,
          warehouseId: existing.warehouseId,
          role: existing.role,
          warehouseRole: existing.warehouseRole,
          targetType: "BRANCH",
          status: existing.status,
          expiresAt: existing.expiresAt,
        },
        rawToken: null,
        existingPending: true,
      };
    }
    throw new StaffInviteDuplicatePendingError(
      `A pending invitation already exists for this email or phone on this branch with a different role (${existing.role}). Revoke it or wait until it expires.`,
      {
        inviteId: existing.id,
        branchId: existing.branchId,
        warehouseId: existing.warehouseId,
        targetType: "BRANCH",
        expiresAt: existing.expiresAt.toISOString(),
        existingRole: existing.role ?? null,
        existingWarehouseRole: existing.warehouseRole ?? null,
        existingInviteAsDoctor: Boolean(existing.inviteAsDoctor),
        requestedRoleMatches: false,
        nextActions: ["RESEND_INVITE", "REVOKE_INVITE", "WAIT_FOR_EXPIRY"],
      }
    );
  }

  const crypto = require("crypto");
  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3); // 72h

  const whId =
    body.warehouseId != null && Number.isFinite(Number(body.warehouseId))
      ? Number(body.warehouseId)
      : null;

  const invite = await prisma.staffInvite.create({
    data: {
      orgId: branch.orgId,
      targetType: "BRANCH",
      branchId: branch.id,
      warehouseId: whId,
      role: roleNorm,
      warehouseRole: null,
      status: "PENDING",
      email: emailNorm,
      phone: phoneNorm,
      displayName: displayName ? String(displayName) : null,
      inviteAsDoctor: Boolean(inviteAsDoctor),
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

  let emailResult: { success?: boolean; error?: string; fallback?: string } = { success: true };
  try {
    const sendResult = await sendInvite({ channel, to, message: msg, email: emailPayload });
    emailResult = sendResult as any;
    if (sendResult && (sendResult as any).success === false) {
      console.warn(
        "[STAFF_INVITE] Email/SMS send failed for inviteId=%s to=%s: %s",
        invite.id,
        to,
        (sendResult as any).error ?? "unknown"
      );
    } else if ((sendResult as any)?.fallback === "log") {
      console.log("[STAFF_INVITE] SMTP not configured; invitation saved but email not sent. inviteId=%s to=%s", invite.id, to);
    }
  } catch (sendErr: any) {
    console.error("[STAFF_INVITE] sendInvite threw for inviteId=%s to=%s:", invite.id, to, sendErr?.message || sendErr);
    emailResult = { success: false, error: String(sendErr?.message || sendErr) };
    // Invitation is already saved; do not throw so caller gets inviteId
  }

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

  // Notify invitee in-app if they already have an account (by email/phone)
  const existingAuth = await prisma.userAuth.findFirst({
    where: {
      OR: [
        ...(emailNorm ? [{ email: { equals: emailNorm, mode: "insensitive" } }] : []),
        ...(phoneNorm ? [{ phone: phoneNorm }] : []),
      ].filter(Boolean),
    },
    select: { userId: true },
  });
  if (existingAuth?.userId) {
    const { createNotification } = require("./notification.service");
    await createNotification({
      userId: existingAuth.userId,
      type: "STAFF_INVITE",
      title: "Staff Invitation",
      message: `You have been invited to join ${branch.name} as ${roleNorm}.`,
      meta: {
        inviteId: invite.id,
        branchId: branch.id,
        branchName: branch.name,
        orgId: branch.orgId,
        role: roleNorm,
        inviteAsDoctor: Boolean(inviteAsDoctor),
        expiresAt: expiresAt?.toISOString() ?? null,
      },
      priority: "P2",
      actionUrl: "/doctor",
      dedupeKey: `staff_invite:${invite.id}:${existingAuth.userId}`,
      branchId: branch.id,
      source: "staff_invite",
      senderId: invitedByUserId,
    }).catch((err: Error) => console.error("[NOTIFICATION] invite created invitee:", err?.message));
  }

  const actorRole: AuditActorRole = inviterRole === "OWNER" ? "OWNER" : "STAFF";
  await logStaffInviteAudit(prisma, {
    actorId: invitedByUserId,
    actorRole,
    action: "INVITE_CREATED",
    inviteId: invite.id,
    branchId: invite.branchId,
    targetType: "BRANCH",
    after: { email: emailNorm, phone: phoneNorm, role: roleNorm, inviteAsDoctor: Boolean(inviteAsDoctor) },
  });

  return {
    invite: {
      id: invite.id,
      orgId: invite.orgId,
      branchId: invite.branchId,
      warehouseId: null,
      role: invite.role,
      warehouseRole: null,
      targetType: "BRANCH",
      status: invite.status,
      expiresAt: invite.expiresAt,
    },
    rawToken,
  };
}

const ALLOWED_WAREHOUSE_INVITE_ROLES = [
  "WAREHOUSE_MANAGER",
  "RECEIVING_STAFF",
  "DISPATCH_STAFF",
  "INVENTORY_CONTROLLER",
  "QC_OFFICER",
  "AUDIT_OFFICER",
] as const;

export async function createWarehouseStaffInvite(
  prisma: any,
  warehouseId: number,
  body: CreateStaffInviteBody,
  invitedByUserId: number
): Promise<CreateStaffInviteResult> {
  const { phone, email, displayName, role } = body;
  if (!role) throw new Error("role is required");
  const roleNorm = String(role).trim().toUpperCase().replace(/\s+/g, "_");
  if (!ALLOWED_WAREHOUSE_INVITE_ROLES.includes(roleNorm as any)) {
    throw new Error(`Invalid warehouse role. Must be one of: ${ALLOWED_WAREHOUSE_INVITE_ROLES.join(", ")}`);
  }

  const emailNorm = (email || "").trim().toLowerCase() || null;
  const phoneNorm = (phone || "").trim().replace(/\D/g, "") || null;
  if (!emailNorm && !phoneNorm) throw new Error("phone or email is required");

  const warehouse = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, orgId: true, name: true, org: { select: { ownerUserId: true } } },
  });
  if (!warehouse) throw new Error("Warehouse not found");

  const existing = await prisma.staffInvite.findFirst({
    where: {
      orgId: warehouse.orgId,
      targetType: "WAREHOUSE",
      warehouseId: warehouse.id,
      status: "PENDING",
      expiresAt: { gt: new Date() },
      OR: [
        ...(emailNorm ? [{ email: { equals: emailNorm, mode: "insensitive" } }] : []),
        ...(phoneNorm ? [{ phone: phoneNorm }] : []),
      ].filter(Boolean),
    },
    select: {
      id: true,
      orgId: true,
      branchId: true,
      warehouseId: true,
      role: true,
      warehouseRole: true,
      status: true,
      expiresAt: true,
      inviteAsDoctor: true,
    },
  });
  if (existing) {
    const sameWhRole = String(existing.warehouseRole || "").toUpperCase() === roleNorm;
    if (sameWhRole) {
      return {
        invite: {
          id: existing.id,
          orgId: existing.orgId,
          branchId: existing.branchId,
          warehouseId: existing.warehouseId,
          role: existing.role,
          warehouseRole: existing.warehouseRole,
          targetType: "WAREHOUSE",
          status: existing.status,
          expiresAt: existing.expiresAt,
        },
        rawToken: null,
        existingPending: true,
      };
    }
    throw new StaffInviteDuplicatePendingError(
      `A pending warehouse invitation already exists for this recipient with a different role (${existing.warehouseRole}). Revoke it or wait until it expires.`,
      {
        inviteId: existing.id,
        branchId: existing.branchId,
        warehouseId: existing.warehouseId,
        targetType: "WAREHOUSE",
        expiresAt: existing.expiresAt.toISOString(),
        existingRole: existing.role ?? null,
        existingWarehouseRole: existing.warehouseRole ?? null,
        existingInviteAsDoctor: Boolean(existing.inviteAsDoctor),
        requestedRoleMatches: false,
        nextActions: ["RESEND_INVITE", "REVOKE_INVITE", "WAIT_FOR_EXPIRY"],
      }
    );
  }

  const existingAuth = await prisma.userAuth.findFirst({
    where: {
      OR: [
        ...(emailNorm ? [{ email: { equals: emailNorm, mode: "insensitive" } }] : []),
        ...(phoneNorm ? [{ phone: phoneNorm }] : []),
      ].filter(Boolean),
    },
    select: { userId: true },
  });
  if (existingAuth?.userId) {
    const existingAssignment = await prisma.warehouseStaffAssignment.findFirst({
      where: { warehouseId: warehouse.id, userId: existingAuth.userId, role: roleNorm as any, isActive: true },
      select: { id: true },
    });
    if (existingAssignment) throw new Error("This user is already assigned to the warehouse with this role");
  }

  const crypto = require("crypto");
  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3);

  const invite = await prisma.staffInvite.create({
    data: {
      orgId: warehouse.orgId,
      targetType: "WAREHOUSE",
      branchId: null,
      warehouseId: warehouse.id,
      role: null,
      warehouseRole: roleNorm as any,
      status: "PENDING",
      email: emailNorm,
      phone: phoneNorm,
      displayName: displayName ? String(displayName) : null,
      inviteAsDoctor: false,
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
  const msg = `BPA Invite: You are invited as ${roleNorm} for warehouse "${warehouse.name}". Complete registration: ${link}`;
  await sendInvite({ channel, to, message: msg }).catch(() => null);

  await logStaffInviteAudit(prisma, {
    actorId: invitedByUserId,
    actorRole: "OWNER",
    action: "INVITE_CREATED",
    inviteId: invite.id,
    warehouseId: warehouse.id,
    targetType: "WAREHOUSE",
    after: { email: emailNorm, phone: phoneNorm, warehouseRole: roleNorm, status: "PENDING" },
  });

  return {
    invite: {
      id: invite.id,
      orgId: invite.orgId,
      branchId: null,
      warehouseId: invite.warehouseId,
      role: null,
      warehouseRole: invite.warehouseRole,
      targetType: "WAREHOUSE",
      status: invite.status,
      expiresAt: invite.expiresAt,
    },
    rawToken,
  };
}

export type ResendStaffInviteResult = {
  invite: { id: number; branchId: number; status: string; expiresAt: Date };
  rawToken: string;
};

export type ReinviteStaffInviteResult = ResendStaffInviteResult;

/**
 * Re-issue an invite (PENDING/EXPIRED/REVOKED) with a fresh token + expiry.
 * Keeps the same invite row for idempotency and audit traceability.
 */
export async function reinviteStaffInviteForBranch(
  prisma: any,
  inviteId: number,
  _actedByUserId: number,
  actorRole: AuditActorRole = "OWNER"
): Promise<ReinviteStaffInviteResult> {
  const invite = await prisma.staffInvite.findFirst({
    where: { id: inviteId },
    include: {
      branch: { select: { id: true, orgId: true, name: true } },
    },
  });
  if (!invite) throw new Error("Invitation not found");
  if (invite.status === "ACCEPTED") throw new Error("Invitation already accepted");

  const emailNorm = (invite.email || "").trim().toLowerCase() || null;
  const phoneNorm = (invite.phone || "").trim().replace(/\D/g, "") || null;
  if (!emailNorm && !phoneNorm) throw new Error("Invitation missing recipient identity");

  // Prevent duplicate active invites for same email/phone + branch
  const existing = await prisma.staffInvite.findFirst({
    where: {
      branchId: invite.branchId,
      status: "PENDING",
      expiresAt: { gt: new Date() },
      id: { not: inviteId },
      OR: [
        ...(emailNorm ? [{ email: { equals: emailNorm, mode: "insensitive" } }] : []),
        ...(phoneNorm ? [{ phone: phoneNorm }] : []),
      ].filter(Boolean),
    },
    select: { id: true },
  });
  if (existing) {
    throw new Error("Another invitation is already pending for this email/phone and branch");
  }

  const crypto = require("crypto");
  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3); // 72h

  await prisma.staffInvite.update({
    where: { id: inviteId },
    data: { tokenHash, expiresAt, status: "PENDING", acceptedByUserId: null },
  });

  const action = invite.status === "PENDING" ? "INVITE_RESENT" : "INVITE_REINVITED";
  await logStaffInviteAudit(prisma, {
    actorId: _actedByUserId,
    actorRole,
    action,
    inviteId,
    branchId: invite.branchId,
    after: {
      email: invite.email,
      role: invite.role,
      inviteAsDoctor: Boolean(invite.inviteAsDoctor),
      expiresAt: expiresAt?.toISOString(),
      status: "PENDING",
    },
  });

  const channel = invite.phone ? "SMS" : "EMAIL";
  const to = (invite.phone || invite.email || "").trim();
  const base = String(process.env.PANEL_PUBLIC_URL || process.env.PUBLIC_WEB_URL || "").replace(/\/$/, "");
  const link = `${base}/register?invite=${rawToken}`;
  const msg = `BPA Invite (reminder): You are invited as ${invite.role} for branch "${invite.branch?.name}". Complete registration: ${link}`;

  let emailPayload: { subject: string; html: string; text: string } | undefined;
  if (channel === "EMAIL") {
    const { renderInviteEmail } = require("../../../utils/emailTemplates/inviteEmail");
    const rendered = renderInviteEmail({
      toName: invite.displayName || null,
      role: invite.role,
      branchName: invite.branch?.name || null,
      orgName: null,
      inviteLink: link,
      expiresAt,
    });
    emailPayload = { subject: rendered.subject, html: rendered.html, text: rendered.text };
  }

  const { sendInvite } = require("../../../utils/inviteNotifier");
  try {
    await sendInvite({ channel, to, message: msg, email: emailPayload });
  } catch (e: any) {
    console.warn("[STAFF_INVITE] reinvite sendInvite failed for inviteId=%s:", inviteId, e?.message);
  }

  const existingAuth = await prisma.userAuth.findFirst({
    where: {
      OR: [
        ...(emailNorm ? [{ email: { equals: emailNorm, mode: "insensitive" } }] : []),
        ...(phoneNorm ? [{ phone: phoneNorm }] : []),
      ].filter(Boolean),
    },
    select: { userId: true },
  });
  if (existingAuth?.userId) {
    const { createNotification } = require("./notification.service");
    await createNotification({
      userId: existingAuth.userId,
      type: "STAFF_INVITE",
      title: "Staff invitation resent",
      message: `Your invitation to join ${invite.branch?.name} has been resent.`,
      meta: {
        inviteId: invite.id,
        branchId: invite.branchId,
        branchName: invite.branch?.name ?? null,
        orgId: invite.orgId,
        role: invite.role,
        inviteAsDoctor: Boolean(invite.inviteAsDoctor),
        expiresAt: expiresAt?.toISOString() ?? null,
      },
      priority: "P2",
      actionUrl: "/doctor",
      dedupeKey: `staff_invite_reinvited:${invite.id}:${existingAuth.userId}`,
      branchId: invite.branchId,
      source: "staff_invite",
    }).catch((err: Error) => console.error("[NOTIFICATION] invite reinvite invitee:", err?.message));
  }

  return {
    invite: { id: invite.id, branchId: invite.branchId, status: "PENDING", expiresAt },
    rawToken,
  };
}

/**
 * Resend a pending staff invite for a branch: new token, extend expiry, send email, notify invitee.
 * Caller must have permission for the branch (staff or owner). Invite must be PENDING and for this branch.
 */
export async function resendStaffInviteForBranch(
  prisma: any,
  branchId: number,
  inviteId: number,
  _actedByUserId: number,
  actorRole: AuditActorRole = "STAFF"
): Promise<ResendStaffInviteResult> {
  const invite = await prisma.staffInvite.findFirst({
    where: { id: inviteId, branchId, status: "PENDING" },
    include: {
      branch: { select: { id: true, orgId: true, name: true } },
    },
  });
  if (!invite) throw new Error("Invitation not found or not pending");

  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
    await prisma.staffInvite.update({ where: { id: inviteId }, data: { status: "EXPIRED" } });
    throw new Error("Invitation has expired");
  }

  const crypto = require("crypto");
  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3); // 72h

  await prisma.staffInvite.update({
    where: { id: inviteId },
    data: { tokenHash, expiresAt },
  });

  await logStaffInviteAudit(prisma, {
    actorId: _actedByUserId,
    actorRole,
    action: "INVITE_RESENT",
    inviteId,
    branchId: invite.branchId,
    after: { email: invite.email, role: invite.role, inviteAsDoctor: Boolean(invite.inviteAsDoctor), expiresAt: expiresAt?.toISOString() },
  });

  const channel = invite.phone ? "SMS" : "EMAIL";
  const to = (invite.phone || invite.email || "").trim();
  const base = String(process.env.PANEL_PUBLIC_URL || process.env.PUBLIC_WEB_URL || "").replace(/\/$/, "");
  const link = `${base}/register?invite=${rawToken}`;
  const msg = `BPA Invite (reminder): You are invited as ${invite.role} for branch "${invite.branch?.name}". Complete registration: ${link}`;

  let emailPayload: { subject: string; html: string; text: string } | undefined;
  if (channel === "EMAIL") {
    const { renderInviteEmail } = require("../../../utils/emailTemplates/inviteEmail");
    const rendered = renderInviteEmail({
      toName: invite.displayName || null,
      role: invite.role,
      branchName: invite.branch?.name || null,
      orgName: null,
      inviteLink: link,
      expiresAt,
    });
    emailPayload = { subject: rendered.subject, html: rendered.html, text: rendered.text };
  }

  const { sendInvite } = require("../../../utils/inviteNotifier");
  try {
    await sendInvite({ channel, to, message: msg, email: emailPayload });
  } catch (e: any) {
    console.warn("[STAFF_INVITE] resend sendInvite failed for inviteId=%s:", inviteId, e?.message);
  }

  const emailNorm = (invite.email || "").trim().toLowerCase() || null;
  const phoneNorm = (invite.phone || "").trim().replace(/\D/g, "") || null;
  const existingAuth = await prisma.userAuth.findFirst({
    where: {
      OR: [
        ...(emailNorm ? [{ email: { equals: emailNorm, mode: "insensitive" } }] : []),
        ...(phoneNorm ? [{ phone: phoneNorm }] : []),
      ].filter(Boolean),
    },
    select: { userId: true },
  });
  if (existingAuth?.userId) {
    const { createNotification } = require("./notification.service");
    await createNotification({
      userId: existingAuth.userId,
      type: "STAFF_INVITE",
      title: "Staff invitation resent",
      message: `Your invitation to join ${invite.branch?.name} has been resent.`,
      meta: {
        inviteId: invite.id,
        branchId: invite.branchId,
        branchName: invite.branch?.name ?? null,
        orgId: invite.orgId,
        role: invite.role,
        inviteAsDoctor: Boolean(invite.inviteAsDoctor),
        expiresAt: expiresAt?.toISOString() ?? null,
      },
      priority: "P2",
      actionUrl: "/doctor",
      dedupeKey: `staff_invite_resent:${invite.id}:${existingAuth.userId}`,
      branchId: invite.branchId,
      source: "staff_invite",
    }).catch((err: Error) => console.error("[NOTIFICATION] invite resent invitee:", err?.message));
  }

  return {
    invite: { id: invite.id, branchId: invite.branchId, status: "PENDING", expiresAt },
    rawToken,
  };
}

/**
 * Cancel (revoke) a pending staff invite for a branch. Notify invitee if they have an account.
 */
export async function cancelStaffInviteForBranch(
  prisma: any,
  branchId: number,
  inviteId: number,
  _actedByUserId: number
): Promise<{ invite: { id: number; branchId: number; status: string } }> {
  const invite = await prisma.staffInvite.findFirst({
    where: { id: inviteId, branchId, status: "PENDING" },
    include: { branch: { select: { name: true } } },
  });
  if (!invite) throw new Error("Invitation not found or not pending");

  await prisma.staffInvite.update({
    where: { id: inviteId },
    data: { status: "REVOKED" },
  });

  await logStaffInviteAudit(prisma, {
    actorId: _actedByUserId,
    actorRole: "STAFF",
    action: "INVITE_CANCELLED",
    inviteId,
    branchId: invite.branchId,
    after: { email: invite.email, role: invite.role, inviteAsDoctor: Boolean(invite.inviteAsDoctor), status: "REVOKED" },
  });

  const emailNorm = (invite.email || "").trim().toLowerCase() || null;
  const phoneNorm = (invite.phone || "").trim().replace(/\D/g, "") || null;
  const existingAuth = await prisma.userAuth.findFirst({
    where: {
      OR: [
        ...(emailNorm ? [{ email: { equals: emailNorm, mode: "insensitive" } }] : []),
        ...(phoneNorm ? [{ phone: phoneNorm }] : []),
      ].filter(Boolean),
    },
    select: { userId: true },
  });
  if (existingAuth?.userId) {
    const { createNotification } = require("./notification.service");
    await createNotification({
      userId: existingAuth.userId,
      type: "SYSTEM",
      title: "Invitation cancelled",
      message: `Your invitation to join ${invite.branch?.name} has been cancelled.`,
      meta: { inviteId: invite.id, branchId: invite.branchId, branchName: invite.branch?.name ?? null },
      priority: "P2",
      actionUrl: "/doctor",
      dedupeKey: `staff_invite_cancelled:${invite.id}:${existingAuth.userId}`,
      branchId: invite.branchId,
      source: "staff_invite",
    }).catch((err: Error) => console.error("[NOTIFICATION] invite cancelled invitee:", err?.message));
  }

  return {
    invite: { id: invite.id, branchId: invite.branchId, status: "REVOKED" },
  };
}

export async function resendStaffInviteForWarehouse(
  prisma: any,
  warehouseId: number,
  inviteId: number,
  actedByUserId: number
): Promise<{ invite: { id: number; warehouseId: number; status: string; expiresAt: Date }; rawToken: string }> {
  const invite = await prisma.staffInvite.findFirst({
    where: { id: inviteId, warehouseId, status: "PENDING" },
    include: { warehouse: { select: { id: true, name: true } } },
  });
  if (!invite) throw new Error("Invitation not found or not pending");
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
    await prisma.staffInvite.update({ where: { id: inviteId }, data: { status: "EXPIRED" } });
    throw new Error("Invitation has expired");
  }

  const crypto = require("crypto");
  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3);
  await prisma.staffInvite.update({ where: { id: inviteId }, data: { tokenHash, expiresAt } });

  await logStaffInviteAudit(prisma, {
    actorId: actedByUserId,
    actorRole: "OWNER",
    action: "INVITE_RESENT",
    inviteId,
    warehouseId,
    targetType: "WAREHOUSE",
    after: { warehouseRole: invite.warehouseRole, expiresAt: expiresAt.toISOString(), status: "PENDING" },
  });

  return { invite: { id: invite.id, warehouseId, status: "PENDING", expiresAt }, rawToken };
}

export async function reinviteStaffInviteForWarehouse(
  prisma: any,
  warehouseId: number,
  inviteId: number,
  actedByUserId: number
): Promise<{ invite: { id: number; warehouseId: number; status: string; expiresAt: Date }; rawToken: string }> {
  const invite = await prisma.staffInvite.findFirst({
    where: { id: inviteId, warehouseId },
    include: { warehouse: { select: { id: true, name: true } } },
  });
  if (!invite) throw new Error("Invitation not found");
  if (invite.status === "ACCEPTED") throw new Error("Invitation already accepted");

  const emailNorm = (invite.email || "").trim().toLowerCase() || null;
  const phoneNorm = (invite.phone || "").trim().replace(/\D/g, "") || null;
  const existing = await prisma.staffInvite.findFirst({
    where: {
      warehouseId,
      status: "PENDING",
      expiresAt: { gt: new Date() },
      id: { not: inviteId },
      OR: [
        ...(emailNorm ? [{ email: { equals: emailNorm, mode: "insensitive" } }] : []),
        ...(phoneNorm ? [{ phone: phoneNorm }] : []),
      ].filter(Boolean),
    },
    select: { id: true },
  });
  if (existing) throw new Error("Another invitation is already pending for this email/phone and warehouse");

  const crypto = require("crypto");
  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3);
  await prisma.staffInvite.update({
    where: { id: inviteId },
    data: { tokenHash, expiresAt, status: "PENDING", acceptedByUserId: null },
  });

  await logStaffInviteAudit(prisma, {
    actorId: actedByUserId,
    actorRole: "OWNER",
    action: invite.status === "PENDING" ? "INVITE_RESENT" : "INVITE_REINVITED",
    inviteId,
    warehouseId,
    targetType: "WAREHOUSE",
    after: { warehouseRole: invite.warehouseRole, expiresAt: expiresAt.toISOString(), status: "PENDING" },
  });

  return { invite: { id: invite.id, warehouseId, status: "PENDING", expiresAt }, rawToken };
}

export async function cancelStaffInviteForWarehouse(
  prisma: any,
  warehouseId: number,
  inviteId: number,
  actedByUserId: number
): Promise<{ invite: { id: number; warehouseId: number; status: string } }> {
  const invite = await prisma.staffInvite.findFirst({
    where: { id: inviteId, warehouseId, status: "PENDING" },
    select: { id: true, warehouseId: true, warehouseRole: true, email: true, phone: true },
  });
  if (!invite) throw new Error("Invitation not found or not pending");
  await prisma.staffInvite.update({ where: { id: invite.id }, data: { status: "REVOKED" } });
  await logStaffInviteAudit(prisma, {
    actorId: actedByUserId,
    actorRole: "OWNER",
    action: "INVITE_CANCELLED",
    inviteId: invite.id,
    warehouseId,
    targetType: "WAREHOUSE",
    after: { warehouseRole: invite.warehouseRole, status: "REVOKED" },
  });
  return { invite: { id: invite.id, warehouseId, status: "REVOKED" } };
}
