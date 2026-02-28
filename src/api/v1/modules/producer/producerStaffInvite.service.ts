/**
 * Producer Staff Invite workflow: registered (notification + accept) and unregistered (token link → register → accept).
 */

const prisma = require("../../../../infrastructure/db/prismaClient");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { createNotification } = require("../../services/notification.service");
const { writeProducerAudit } = require("./producerAudit");
const { addProducerStaffInviteEmailJob } = require("../../../../common/queue/queues");
const { sendStaffInviteAcceptedToOwner } = require("../../../../common/email/email.service");

const INVITE_EXPIRY_DAYS = 14;
const TOKEN_BYTES = 32;

type AppError = Error & { statusCode?: number; code?: string; fields?: Record<string, string> };
function createError(message: string, statusCode: number, code?: string, fields?: Record<string, string>): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = statusCode;
  if (code) err.code = code;
  if (fields) err.fields = fields;
  return err;
}

function normalizeEmail(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().toLowerCase();
  return s || null;
}
function normalizePhone(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  return String(v).trim().replace(/\D/g, "") || null;
}

/** Producer role keys in DB. Accept shorthand (e.g. STAFF -> PRODUCER_STAFF). */
const PRODUCER_ROLE_KEYS = ["PRODUCER_OWNER", "PRODUCER_MANAGER", "PRODUCER_STAFF", "PRODUCER_AUDITOR", "PRODUCER_VIEWER"] as const;
const ROLE_ALIASES: Record<string, string> = {
  OWNER: "PRODUCER_OWNER",
  MANAGER: "PRODUCER_MANAGER",
  STAFF: "PRODUCER_STAFF",
  AUDITOR: "PRODUCER_AUDITOR",
  VIEWER: "PRODUCER_VIEWER",
};

function resolveRoleKey(roleOrKey: string | null | undefined): string {
  const raw = (roleOrKey != null ? String(roleOrKey).trim() : "") || "PRODUCER_VIEWER";
  if (PRODUCER_ROLE_KEYS.includes(raw as any)) return raw;
  const upper = raw.toUpperCase().replace(/^PRODUCER_/, "");
  return ROLE_ALIASES[upper] || raw;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** Single source of truth for public web (Producer panel) base URL. Never use backend host or 0.0.0.0 in emails. */
function getFrontendBaseUrl(): string {
  const raw =
    process.env.FRONTEND_BASE_URL ||
    process.env.WEB_APP_URL ||
    process.env.PRODUCER_PANEL_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.FRONTEND_URL ||
    "";
  let base = String(raw).trim().replace(/\/$/, "");
  if (base) {
    base = base.replace(/^https?:\/\/0\.0\.0\.0(\b|$)/i, (_, rest) => `http://localhost${rest || ""}`);
    if (base.includes("0.0.0.0")) base = base.replace(/0\.0\.0\.0/g, "localhost");
  }
  if (base && (base.startsWith("http://") || base.startsWith("https://"))) {
    if (process.env.NODE_ENV !== "production") {
      console.log("[producer-invite] inviteLink base URL:", base);
    }
    return base;
  }
  if (base) return `https://${base}`;
  if (process.env.NODE_ENV !== "production") {
    console.warn("[producer-invite] FRONTEND_BASE_URL (or WEB_APP_URL) not set; using http://localhost:3105 for invite links.");
  }
  return "http://localhost:3105";
}

/** @deprecated Use getFrontendBaseUrl. Kept for any external callers. */
function getProducerPanelBaseUrl(): string {
  return getFrontendBaseUrl();
}

export async function createStaffInvite(params: {
  producerOrgId: number;
  invitedByUserId: number;
  email?: string | null;
  phone?: string | null;
  roleKey?: string | null;
  message?: string | null;
}) {
  const emailNorm = normalizeEmail(params.email);
  const phoneNorm = normalizePhone(params.phone);
  if (!emailNorm && !phoneNorm) {
    throw createError("At least one of email or phone is required", 400, "VALIDATION_ERROR", {
      email: "Provide an email address",
      phone: "Or provide a phone number",
    });
  }

  const roleKey = resolveRoleKey(params.roleKey);
  const role = await prisma.role.findUnique({
    where: { key: roleKey },
    select: { id: true, key: true },
  });
  if (!role) {
    throw createError(
      `Invalid role. Use one of: ${PRODUCER_ROLE_KEYS.join(", ")}`,
      400,
      "INVALID_ROLE",
      { role: roleKey }
    );
  }

  const producerOrg = await prisma.producerOrg.findUnique({
    where: { id: params.producerOrgId },
    select: { id: true, name: true },
  });
  if (!producerOrg) throw createError("Producer org not found", 404);

  const inviterAuth = await prisma.userAuth.findUnique({
    where: { userId: params.invitedByUserId },
    select: { email: true, phone: true },
  });
  if (emailNorm && normalizeEmail(inviterAuth?.email) === emailNorm) {
    throw createError("You cannot invite yourself", 400, "SELF_INVITE_FORBIDDEN");
  }
  if (phoneNorm && normalizePhone(inviterAuth?.phone) === phoneNorm) {
    throw createError("You cannot invite yourself", 400, "SELF_INVITE_FORBIDDEN");
  }

  // Check duplicate pending/sent invite for same email or phone
  const pendingStatuses = ["PENDING", "SENT"];
  if (emailNorm) {
    const dup = await prisma.producerStaffInvite.findFirst({
      where: {
        producerOrgId: params.producerOrgId,
        email: emailNorm,
        status: { in: pendingStatuses },
      },
    });
    if (dup) throw createError("An invitation for this email is already pending", 400, "INVITE_ALREADY_PENDING");
  }
  if (phoneNorm) {
    const dup = await prisma.producerStaffInvite.findFirst({
      where: {
        producerOrgId: params.producerOrgId,
        phone: phoneNorm,
        status: { in: pendingStatuses },
      },
    });
    if (dup) throw createError("An invitation for this phone is already pending", 400, "INVITE_ALREADY_PENDING");
  }

  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const auth = await prisma.userAuth.findFirst({
    where: {
      OR: [
        emailNorm ? { email: { equals: emailNorm, mode: "insensitive" } } : undefined,
        phoneNorm ? { phone: phoneNorm } : undefined,
      ].filter(Boolean),
    },
    select: { userId: true },
  });

  if (auth) {
    // CASE A: Registered user
    const existingStaff = await prisma.producerOrgStaff.findUnique({
      where: {
        producerOrgId_userId: { producerOrgId: params.producerOrgId, userId: auth.userId },
      },
    });
    if (existingStaff) throw createError("User is already a staff member", 400, "USER_ALREADY_STAFF");

    const invite = await prisma.producerStaffInvite.create({
      data: {
        producerOrgId: params.producerOrgId,
        invitedByUserId: params.invitedByUserId,
        email: emailNorm,
        phone: phoneNorm,
        roleId: role.id,
        status: "PENDING",
        tokenHash: null,
        expiresAt,
      },
      include: {
        role: { select: { key: true, label: true } },
        producerOrg: { select: { name: true } },
      },
    });

    try {
      await createNotification({
        userId: auth.userId,
        type: "STAFF_INVITE",
        title: "Producer Staff Invitation",
        message: `You have been invited to join ${producerOrg.name} as staff.`,
        meta: { inviteId: invite.id, producerOrgId: params.producerOrgId, producerName: producerOrg.name },
        source: "producer",
        actionUrl: `/producer/staff?inviteId=${invite.id}`,
        dedupeKey: `producer-staff-invite-${invite.id}`,
        senderId: params.invitedByUserId,
      });
    } catch (e) {
      console.error("Producer staff invite notification error:", e);
    }

    void writeProducerAudit({
      producerOrgId: params.producerOrgId,
      actorType: "OWNER",
      actorId: params.invitedByUserId,
      action: "STAFF_INVITE_CREATED",
      entityType: "PRODUCER_STAFF_INVITE",
      entityId: String(invite.id),
    });

    const baseUrl = getFrontendBaseUrl();
    const invitePath = `/producer/staff?inviteId=${invite.id}`;
    const inviteLink = `${baseUrl}${invitePath}`;
    if (process.env.NODE_ENV !== "production") {
      console.log("[producer-invite] inviteLink (registered):", inviteLink);
    }

    if (emailNorm) {
      try {
        const inviterProfile = await prisma.userProfile.findUnique({
          where: { userId: params.invitedByUserId },
          select: { displayName: true },
        });
        const ownerName = inviterProfile?.displayName || "The owner";
        const delivery = await prisma.producerStaffInviteDelivery.create({
          data: {
            inviteId: invite.id,
            channel: "email",
            to: emailNorm,
            status: "QUEUED",
            attemptCount: 0,
            updatedAt: new Date(),
          },
        });
        const jobPayload = {
          deliveryId: delivery.id,
          inviteId: invite.id,
          to: emailNorm,
          inviteLink,
          producerName: producerOrg.name,
          roleLabel: invite.role?.label || invite.role?.key || "Staff",
          expiresAt: invite.expiresAt.toISOString(),
          ownerName,
          customMessage: params.message ? String(params.message).trim() : undefined,
        };
        await addProducerStaffInviteEmailJob(jobPayload);
      } catch (e) {
        console.error("Producer staff invite email queue error:", e);
      }
    }

    return {
      mode: "REGISTERED" as const,
      inviteId: invite.id,
      inviteLink,
      invite: { ...invite, expiresAt: invite.expiresAt },
    };
  }

  // CASE B: Unregistered — create invite with token
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = hashToken(rawToken);

  const invite = await prisma.producerStaffInvite.create({
    data: {
      producerOrgId: params.producerOrgId,
      invitedByUserId: params.invitedByUserId,
      email: emailNorm,
      phone: phoneNorm,
      roleId: role.id,
      status: "SENT",
      tokenHash,
      expiresAt,
    },
    include: {
      role: { select: { key: true, label: true } },
      producerOrg: { select: { name: true } },
    },
  });

  const baseUrl = getFrontendBaseUrl();
  const invitePath = `/producer/invite?token=${rawToken}`;
  const inviteLink = `${baseUrl}${invitePath}`;
  if (process.env.NODE_ENV !== "production") {
    console.log("[producer-invite] inviteLink (create unregistered):", inviteLink.replace(/token=[a-f0-9]+/i, "token=***"));
  }

  void writeProducerAudit({
    producerOrgId: params.producerOrgId,
    actorType: "OWNER",
    actorId: params.invitedByUserId,
    action: "STAFF_INVITE_SENT",
    entityType: "PRODUCER_STAFF_INVITE",
    entityId: String(invite.id),
  });

  if (emailNorm) {
    try {
      const inviterProfile = await prisma.userProfile.findUnique({
        where: { userId: params.invitedByUserId },
        select: { displayName: true },
      });
      const ownerName = inviterProfile?.displayName || "The owner";
      const delivery = await prisma.producerStaffInviteDelivery.create({
        data: {
          inviteId: invite.id,
          channel: "email",
          to: emailNorm,
          status: "QUEUED",
          attemptCount: 0,
          updatedAt: new Date(),
        },
      });
      await addProducerStaffInviteEmailJob({
        deliveryId: delivery.id,
        inviteId: invite.id,
        to: emailNorm,
        inviteLink,
        producerName: producerOrg.name,
        roleLabel: invite.role?.label || invite.role?.key || "Staff",
        expiresAt: invite.expiresAt.toISOString(),
        ownerName,
        customMessage: params.message ? String(params.message).trim() : undefined,
      });
    } catch (e) {
      console.error("Producer staff invite email queue error:", e);
    }
  }

  return {
    mode: "UNREGISTERED" as const,
    inviteId: invite.id,
    inviteLink,
    invite: { ...invite, expiresAt: invite.expiresAt },
  };
}

export async function listStaffInvites(producerOrgId: number, filters?: { status?: string; search?: string }) {
  const where: any = { producerOrgId };
  if (filters?.status) {
    where.status = filters.status;
  }
  if (filters?.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    where.OR = [
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
    ];
  }
  return prisma.producerStaffInvite.findMany({
    where,
    include: {
      role: { select: { key: true, label: true } },
      invitedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      producerOrg: { select: { name: true } },
      deliveries: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function cancelStaffInvite(producerOrgId: number, inviteId: number, userId: number) {
  const invite = await prisma.producerStaffInvite.findFirst({
    where: { id: inviteId, producerOrgId },
  });
  if (!invite) throw createError("Invite not found", 404);
  if (invite.status !== "PENDING" && invite.status !== "SENT") {
    throw createError("Only pending or sent invites can be cancelled", 400);
  }
  await prisma.producerStaffInvite.update({
    where: { id: inviteId },
    data: { status: "CANCELLED", updatedAt: new Date() },
  });
  void writeProducerAudit({
    producerOrgId,
    actorType: "OWNER",
    actorId: userId,
    action: "STAFF_INVITE_CANCELLED",
    entityType: "PRODUCER_STAFF_INVITE",
    entityId: String(inviteId),
  });
  return { success: true };
}

/**
 * Resend a staff invite: new token (invalidates old link), extended expiry, audit.
 * Only PENDING or SENT invites can be resent.
 */
export async function resendStaffInvite(producerOrgId: number, inviteId: number, userId: number) {
  const invite = await prisma.producerStaffInvite.findFirst({
    where: { id: inviteId, producerOrgId },
    include: { role: { select: { key: true, label: true } }, producerOrg: { select: { name: true } } },
  });
  if (!invite) throw createError("Invite not found", 404);
  if (invite.status !== "PENDING" && invite.status !== "SENT") {
    throw createError("Only pending or sent invites can be resent", 400);
  }
  if (new Date() > invite.expiresAt) {
    await prisma.producerStaffInvite.update({
      where: { id: inviteId },
      data: { status: "EXPIRED", updatedAt: new Date() },
    });
    throw createError("This invite has expired", 400);
  }

  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await prisma.producerStaffInvite.update({
    where: { id: inviteId },
    data: { tokenHash, expiresAt, status: "SENT", updatedAt: new Date() },
  });

  void writeProducerAudit({
    producerOrgId,
    actorType: "OWNER",
    actorId: userId,
    action: "STAFF_INVITE_RESENT",
    entityType: "PRODUCER_STAFF_INVITE",
    entityId: String(inviteId),
  });

  const baseUrl = getFrontendBaseUrl();
  const invitePath = `/producer/invite?token=${rawToken}`;
  const inviteLink = `${baseUrl}${invitePath}`;
  if (process.env.NODE_ENV !== "production") {
    console.log("[producer-invite] inviteLink (resend):", inviteLink.replace(/token=[a-f0-9]+/i, "token=***"));
  }

  const updated = await prisma.producerStaffInvite.findUnique({
    where: { id: inviteId },
    include: { role: { select: { key: true, label: true } }, producerOrg: { select: { name: true } } },
  });

  if (invite.email) {
    try {
      const inviterProfile = await prisma.userProfile.findUnique({
        where: { userId },
        select: { displayName: true },
      });
      const ownerName = inviterProfile?.displayName || "The owner";
      const delivery = await prisma.producerStaffInviteDelivery.create({
        data: {
          inviteId,
          channel: "email",
          to: invite.email,
          status: "QUEUED",
          attemptCount: 0,
          updatedAt: new Date(),
        },
      });
      await addProducerStaffInviteEmailJob({
        deliveryId: delivery.id,
        inviteId,
        to: invite.email,
        inviteLink,
        producerName: updated.producerOrg?.name || "Producer",
        roleLabel: updated.role?.label || updated.role?.key || "Staff",
        expiresAt: expiresAt.toISOString(),
        ownerName,
        customMessage: undefined,
      });
    } catch (e) {
      console.error("Producer staff invite resend email queue error:", e);
    }
  }

  return { inviteLink, invite: updated };
}

function userMatchesInvite(userAuth: { email?: string | null; phone?: string | null }, invite: { email?: string | null; phone?: string | null }): boolean {
  const emailNorm = normalizeEmail(invite.email);
  const phoneNorm = normalizePhone(invite.phone);
  if (emailNorm && normalizeEmail(userAuth.email) === emailNorm) return true;
  if (phoneNorm && normalizePhone(userAuth.phone) === phoneNorm) return true;
  return false;
}

export async function acceptStaffInvite(params: { userId: number; inviteId?: number; token?: string }) {
  let invite: any = null;

  if (params.token) {
    const tokenHash = hashToken(params.token);
    invite = await prisma.producerStaffInvite.findFirst({
      where: { tokenHash, status: { in: ["PENDING", "SENT"] } },
      include: { role: true, producerOrg: true },
    });
    if (!invite) throw createError("Invalid or expired invite token", 404);
  } else if (params.inviteId) {
    invite = await prisma.producerStaffInvite.findUnique({
      where: { id: params.inviteId },
      include: { role: true, producerOrg: true },
    });
    if (!invite) throw createError("Invite not found", 404);
    if (invite.status !== "PENDING" && invite.status !== "SENT") {
      throw createError("This invite is no longer valid", 400);
    }
  } else {
    throw createError("inviteId or token is required", 400);
  }

  if (new Date() > invite.expiresAt) {
    await prisma.producerStaffInvite.update({
      where: { id: invite.id },
      data: { status: "EXPIRED", updatedAt: new Date() },
    });
    throw createError("This invite has expired", 400);
  }

  const userAuth = await prisma.userAuth.findUnique({
    where: { userId: params.userId },
    select: { email: true, phone: true },
  });
  if (!userAuth) throw createError("User auth not found", 404);

  if (!userMatchesInvite(userAuth, invite)) {
    throw createError("This invite was sent to a different email or phone", 403);
  }

  const existingStaff = await prisma.producerOrgStaff.findUnique({
    where: {
      producerOrgId_userId: { producerOrgId: invite.producerOrgId, userId: params.userId },
    },
  });
  if (existingStaff) throw createError("You are already a staff member", 400);

  await prisma.$transaction([
    prisma.producerOrgStaff.create({
      data: {
        producerOrgId: invite.producerOrgId,
        userId: params.userId,
        roleId: invite.roleId,
        invitedBy: invite.invitedByUserId,
        status: "ACTIVE",
      },
    }),
    prisma.producerStaffInvite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", acceptedByUserId: params.userId, updatedAt: new Date() },
    }),
  ]);

  void writeProducerAudit({
    producerOrgId: invite.producerOrgId,
    actorType: "OWNER",
    actorId: invite.invitedByUserId,
    action: "STAFF_INVITE_ACCEPTED",
    entityType: "PRODUCER_STAFF_INVITE",
    entityId: String(invite.id),
  });

  const baseUrl = getProducerPanelBaseUrl();
  const staffListUrl = `${baseUrl}/producer/staff`;
  try {
    const [acceptedUser, owner] = await Promise.all([
      prisma.user.findUnique({
        where: { id: params.userId },
        select: { profile: { select: { displayName: true } } },
      }),
      prisma.user.findUnique({
        where: { id: invite.invitedByUserId },
        select: { profile: { select: { displayName: true } }, auth: { select: { email: true } } },
      }),
    ]);
    const staffDisplayName = acceptedUser?.profile?.displayName || "A staff member";
    const ownerName = owner?.profile?.displayName || "Owner";
    const ownerEmail = owner?.auth?.email;
    await createNotification({
      userId: invite.invitedByUserId,
      type: "STAFF_INVITE",
      title: "Staff accepted your invitation",
      message: `${staffDisplayName} accepted your invitation to join ${invite.producerOrg?.name || "your producer"} as ${invite.role?.label || "staff"}.`,
      meta: { inviteId: invite.id, producerOrgId: invite.producerOrgId, acceptedByUserId: params.userId },
      source: "producer",
      actionUrl: "/producer/staff",
      dedupeKey: `producer-staff-accepted-${invite.id}`,
      senderId: params.userId,
    });
    if (ownerEmail) {
      const emailResult = await sendStaffInviteAcceptedToOwner({
        to: ownerEmail,
        ownerName,
        staffDisplayName,
        orgName: invite.producerOrg?.name || "your producer",
        roleLabel: invite.role?.label || "staff",
        staffListUrl,
      });
      if ("skipped" in emailResult) {
        // SMTP not configured - ignore
      }
    }
  } catch (e) {
    console.error("Producer staff accept notification/email error:", e);
  }

  return { success: true, producerOrgId: invite.producerOrgId, producerName: invite.producerOrg?.name };
}

export async function declineStaffInvite(params: { userId: number; inviteId?: number; token?: string }) {
  let invite: any = null;

  if (params.token) {
    const tokenHash = hashToken(params.token);
    invite = await prisma.producerStaffInvite.findFirst({
      where: { tokenHash, status: { in: ["PENDING", "SENT"] } },
      include: { producerOrg: true },
    });
  } else if (params.inviteId) {
    invite = await prisma.producerStaffInvite.findUnique({
      where: { id: params.inviteId },
      include: { producerOrg: true },
    });
  }
  if (!invite || (invite.status !== "PENDING" && invite.status !== "SENT")) {
    throw createError("Invite not found or no longer valid", 404);
  }

  const userAuth = await prisma.userAuth.findUnique({
    where: { userId: params.userId },
    select: { email: true, phone: true },
  });
  if (!userAuth) throw createError("User auth not found", 404);
  if (!userMatchesInvite(userAuth, invite)) {
    throw createError("This invite was sent to a different email or phone", 403);
  }

  await prisma.producerStaffInvite.update({
    where: { id: invite.id },
    data: { status: "DECLINED", updatedAt: new Date() },
  });

  return { success: true };
}

export async function getPendingInvitesForUser(userId: number) {
  const userAuth = await prisma.userAuth.findUnique({
    where: { userId },
    select: { email: true, phone: true },
  });
  if (!userAuth) return [];

  const emailNorm = normalizeEmail(userAuth.email);
  const phoneNorm = normalizePhone(userAuth.phone);
  const or: any[] = [];
  if (emailNorm) or.push({ email: { equals: emailNorm, mode: "insensitive" } });
  if (phoneNorm) or.push({ phone: phoneNorm });
  if (or.length === 0) return [];

  const invites = await prisma.producerStaffInvite.findMany({
    where: {
      OR: or,
      status: { in: ["PENDING", "SENT"] },
      expiresAt: { gt: new Date() },
    },
    include: {
      producerOrg: { select: { id: true, name: true } },
      role: { select: { key: true, label: true } },
      invitedBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return invites;
}

/**
 * Public preview of an invite by token (for accept page). Returns minimal info; validates token and expiry.
 */
export async function getStaffInvitePreviewByToken(token: string) {
  const t = String(token || "").trim();
  if (!t) throw createError("Token is required", 400);
  const tokenHash = hashToken(t);
  const invite = await prisma.producerStaffInvite.findFirst({
    where: { tokenHash, status: { in: ["PENDING", "SENT"] } },
    include: { role: { select: { label: true, key: true } }, producerOrg: { select: { name: true } } },
  });
  if (!invite) throw createError("Invalid or expired invite token", 404);
  if (new Date() > invite.expiresAt) {
    await prisma.producerStaffInvite.update({
      where: { id: invite.id },
      data: { status: "EXPIRED", updatedAt: new Date() },
    });
    throw createError("This invite has expired", 400);
  }
  return {
    orgName: invite.producerOrg?.name || "Producer",
    roleLabel: invite.role?.label || invite.role?.key || "Staff",
    expiresAt: invite.expiresAt,
  };
}

export async function getInviteByIdForProducer(producerOrgId: number, inviteId: number) {
  const invite = await prisma.producerStaffInvite.findFirst({
    where: { id: inviteId, producerOrgId },
    include: {
      role: { select: { key: true, label: true } },
      invitedBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
  return invite;
}

export async function acceptStaffInvitePublic(params: { token: string; password: string; name?: string | null }) {
  const token = String(params.token || "").trim();
  if (!token) throw createError("token is required", 400);
  if (!params.password || String(params.password).length < 4) {
    throw createError("password is required (min 4 chars)", 400);
  }

  const tokenHash = hashToken(token);
  const invite = await prisma.producerStaffInvite.findFirst({
    where: { tokenHash, status: { in: ["PENDING", "SENT"] } },
    include: { role: true, producerOrg: true },
  });
  if (!invite) throw createError("Invalid or expired invite token", 404);

  if (new Date() > invite.expiresAt) {
    await prisma.producerStaffInvite.update({
      where: { id: invite.id },
      data: { status: "EXPIRED", updatedAt: new Date() },
    });
    throw createError("This invite has expired", 400);
  }

  const emailNorm = normalizeEmail(invite.email);
  const phoneNorm = normalizePhone(invite.phone);
  if (!emailNorm && !phoneNorm) throw createError("Invite is missing recipient identity", 400);

  const existingAuth = await prisma.userAuth.findFirst({
    where: {
      OR: [
        emailNorm ? { email: { equals: emailNorm, mode: "insensitive" } } : undefined,
        phoneNorm ? { phone: phoneNorm } : undefined,
      ].filter(Boolean),
    },
    include: { user: { include: { profile: true } } },
  });

  const passwordHash = await bcrypt.hash(String(params.password), 10);

  const user = await prisma.$transaction(async (tx) => {
    let userId: number;

    if (existingAuth) {
      if (existingAuth.passwordHash) {
        throw createError("User already has an account. Please login and accept the invite.", 409, "USER_ALREADY_REGISTERED");
      }
      await tx.userAuth.update({
        where: { id: existingAuth.id },
        data: { passwordHash },
      });
      userId = existingAuth.userId;
    } else {
      const displayName =
        (params.name && String(params.name).trim()) ||
        (emailNorm ? emailNorm.split("@")[0] : phoneNorm ? `User_${phoneNorm.slice(-4)}` : "Producer Staff");
      const username = `${String(displayName).toLowerCase().replace(/\s+/g, "")}_${Date.now()}`.slice(0, 30);
      const created = await tx.user.create({
        data: {
          auth: { create: { email: emailNorm, phone: phoneNorm, passwordHash } },
          profile: { create: { displayName: String(displayName).trim(), username } },
          wallet: { create: { balance: 0.0, points: 0, tier: "Bronze", currency: "BDT" } },
        },
        include: { auth: true, profile: true },
      });
      userId = created.id;
    }

    await tx.producerOrgStaff.upsert({
      where: { producerOrgId_userId: { producerOrgId: invite.producerOrgId, userId } },
      update: { status: "ACTIVE", roleId: invite.roleId },
      create: {
        producerOrgId: invite.producerOrgId,
        userId,
        roleId: invite.roleId,
        invitedBy: invite.invitedByUserId,
        status: "ACTIVE",
      },
    });

    await tx.producerStaffInvite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", acceptedByUserId: userId, updatedAt: new Date() },
    });

    return tx.user.findUnique({
      where: { id: userId },
      include: { auth: true, profile: true },
    });
  });

  if (!user) throw createError("User not found", 404);

  void writeProducerAudit({
    producerOrgId: invite.producerOrgId,
    actorType: "OWNER",
    actorId: invite.invitedByUserId,
    action: "STAFF_INVITE_ACCEPTED",
    entityType: "PRODUCER_STAFF_INVITE",
    entityId: String(invite.id),
  });

  const baseUrl = getProducerPanelBaseUrl();
  const staffListUrl = `${baseUrl}/producer/staff`;
  try {
    const staffDisplayName = user?.profile?.displayName || "A staff member";
    const owner = await prisma.user.findUnique({
      where: { id: invite.invitedByUserId },
      select: { profile: { select: { displayName: true } }, auth: { select: { email: true } } },
    });
    const ownerName = owner?.profile?.displayName || "Owner";
    const ownerEmail = owner?.auth?.email;
    await createNotification({
      userId: invite.invitedByUserId,
      type: "STAFF_INVITE",
      title: "Staff accepted your invitation",
      message: `${staffDisplayName} accepted your invitation to join ${invite.producerOrg?.name || "your producer"} as ${invite.role?.label || "staff"}.`,
      meta: { inviteId: invite.id, producerOrgId: invite.producerOrgId, acceptedByUserId: user.id },
      source: "producer",
      actionUrl: "/producer/staff",
      dedupeKey: `producer-staff-accepted-${invite.id}`,
      senderId: user.id,
    });
    if (ownerEmail) {
      const emailResult = await sendStaffInviteAcceptedToOwner({
        to: ownerEmail,
        ownerName,
        staffDisplayName,
        orgName: invite.producerOrg?.name || "your producer",
        roleLabel: invite.role?.label || "staff",
        staffListUrl,
      });
      if ("skipped" in emailResult) {
        // SMTP not configured - ignore
      }
    }
  } catch (e) {
    console.error("Producer staff accept notification/email error:", e);
  }

  return { user, producerOrgId: invite.producerOrgId, producerName: invite.producerOrg?.name };
}
