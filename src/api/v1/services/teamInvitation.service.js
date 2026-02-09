/**
 * Team Invitation Service
 * Email-based invite to owner team: token hashed, one-time use, 72h expiry.
 * On accept: add to OwnerTeamMember, create OwnerDelegation per scope, create UserContext.
 */

const crypto = require("crypto");
const prisma = require("../../../infrastructure/db/prismaClient").default;
const { isValidScopeKey } = require("../constants/delegationScopes");

const TOKEN_BYTES = 24;
const EXPIRY_HOURS = 72;

/**
 * Create team invitation. Returns { invite, rawToken }.
 * @param {number} ownerUserId
 * @param {number} teamId
 * @param {string} email
 * @param {number} invitedByUserId
 * @param {string[]} [scopes] - scope keys to assign on accept (default: team's scopes)
 * @param {number[]} [branchIds] - optional branch IDs to limit delegation
 */
async function createTeamInvitation(ownerUserId, teamId, email, invitedByUserId, scopes = null, branchIds = null) {
  const emailNorm = String(email || "").trim().toLowerCase();
  if (!emailNorm) throw new Error("email is required");

  const team = await prisma.ownerTeam.findFirst({
    where: { id: teamId, ownerUserId },
    select: { id: true, name: true, scopes: true },
  });
  if (!team) throw new Error("Team not found or not owned by you");

  const scopeList = Array.isArray(scopes) && scopes.length > 0
    ? scopes.map((s) => String(s).trim()).filter(Boolean)
    : (Array.isArray(team.scopes) ? team.scopes : []);
  for (const key of scopeList) {
    if (!isValidScopeKey(key)) throw new Error(`Invalid scope: ${key}`);
  }

  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000);

  const invite = await prisma.teamInvitation.create({
    data: {
      ownerUserId,
      teamId,
      email: emailNorm,
      tokenHash,
      status: "PENDING",
      expiresAt,
      scopes: scopeList.length > 0 ? scopeList : null,
      branchIds: Array.isArray(branchIds) && branchIds.length > 0 ? branchIds : null,
      invitedByUserId,
    },
  });

  return { invite, rawToken };
}

/**
 * Verify team invite by raw token. Returns { valid, invite, userExists, requiresRegistration } or null if not found.
 */
async function verifyTeamInvitation(token) {
  const tokenHash = crypto.createHash("sha256").update(String(token).trim()).digest("hex");
  const invite = await prisma.teamInvitation.findUnique({
    where: { tokenHash },
    include: {
      team: { select: { id: true, name: true } },
      owner: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
  if (!invite) return null;
  if (invite.status !== "PENDING") return { valid: false, invite, reason: invite.status };
  if (new Date(invite.expiresAt) < new Date()) {
    await prisma.teamInvitation.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
    return { valid: false, invite, reason: "EXPIRED" };
  }
  const existingAuth = await prisma.userAuth.findFirst({
    where: { email: { equals: invite.email, mode: "insensitive" } },
    select: { userId: true },
  });
  const userExists = Boolean(existingAuth);
  return {
    valid: true,
    invite,
    userExists,
    requiresRegistration: !userExists,
  };
}

/**
 * Accept team invitation. Creates user if new, adds to team, assigns delegations, creates UserContext.
 * @param {string} token - raw invite token
 * @param {number|null} existingUserId - if user already exists and is logged in
 * @param {object} [newUserData] - for new users: { password, displayName }
 * @returns { object } { userId, invite }
 */
async function acceptTeamInvitation(token, existingUserId, newUserData = {}) {
  const verified = await verifyTeamInvitation(token);
  if (!verified || !verified.valid) {
    throw new Error(verified?.reason === "EXPIRED" ? "Invite expired" : "Invalid or already used invite");
  }
  const invite = verified.invite;
  const scopeList = Array.isArray(invite.scopes) ? invite.scopes : [];
  const branchIds = Array.isArray(invite.branchIds) ? invite.branchIds : [];
  let userId = existingUserId ? Number(existingUserId) : null;

  await prisma.$transaction(async (tx) => {
    if (!userId) {
      const authRow = await tx.userAuth.findFirst({
        where: { email: { equals: invite.email, mode: "insensitive" } },
        select: { userId: true },
      });
      if (authRow) {
        userId = authRow.userId;
      } else {
        const { password, displayName } = newUserData;
        if (!password || String(password).length < 4) throw new Error("password required (min 4 chars) for new user");
        const bcrypt = require("bcrypt");
        const hashed = await bcrypt.hash(password, 10);
        let base = (invite.email.split("@")[0] || "user").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20) || "user";
        let username = base;
        for (let i = 0; i < 10; i++) {
          const exists = await tx.userProfile.findFirst({ where: { username }, select: { id: true } });
          if (!exists) break;
          username = `${base}_${Math.floor(1000 + Math.random() * 9000)}`.slice(0, 30);
        }
        const newUser = await tx.user.create({ data: {} });
        await tx.userAuth.create({
          data: {
            userId: newUser.id,
            email: invite.email,
            passwordHash: hashed,
          },
        });
        await tx.userProfile.create({
          data: {
            userId: newUser.id,
            displayName: displayName || invite.email.split("@")[0],
            username,
          },
        });
        userId = newUser.id;
      }
    } else {
      const authRow = await tx.userAuth.findFirst({
        where: { userId },
        select: { email: true },
      });
      const emailNorm = (authRow?.email || "").toLowerCase();
      if (emailNorm !== invite.email.toLowerCase()) {
        throw new Error("Logged-in user email does not match invitation");
      }
    }

    const team = await tx.ownerTeam.findFirst({
      where: { id: invite.teamId, ownerUserId: invite.ownerUserId },
    });
    if (!team) throw new Error("Team not found");
    await tx.ownerTeamMember.upsert({
      where: { teamId_userId: { teamId: invite.teamId, userId } },
      update: { roleInTeam: "MEMBER" },
      create: { teamId: invite.teamId, userId, roleInTeam: "MEMBER" },
    });

    const orgIds = await tx.organization.findMany({
      where: { ownerUserId: invite.ownerUserId },
      select: { id: true },
    }).then((r) => r.map((o) => o.id));
    const orgId = null;
    const singleBranchId = branchIds.length === 1 ? branchIds[0] : null;
    if (singleBranchId && orgIds.length > 0) {
      const branch = await tx.branch.findFirst({
        where: { id: singleBranchId, orgId: { in: orgIds } },
      });
      if (!branch) throw new Error("Branch not under owner");
    }
    for (const scopeKey of scopeList) {
      if (!isValidScopeKey(scopeKey)) continue;
      const existing = await tx.ownerDelegation.findFirst({
        where: {
          ownerUserId: invite.ownerUserId,
          delegatedUserId: userId,
          scopeKey,
          orgId,
          branchId: singleBranchId,
        },
      });
      if (existing) {
        await tx.ownerDelegation.update({
          where: { id: existing.id },
          data: { teamId: invite.teamId, updatedAt: new Date() },
        });
      } else {
        await tx.ownerDelegation.create({
          data: {
            ownerUserId: invite.ownerUserId,
            delegatedUserId: userId,
            scopeKey,
            orgId,
            branchId: singleBranchId,
            teamId: invite.teamId,
          },
        });
      }
    }

    const existingContext = await tx.userContext.findFirst({
      where: { userId, ownerUserId: invite.ownerUserId, teamId: invite.teamId },
    });
    if (!existingContext) {
      await tx.userContext.create({
        data: {
          userId,
          ownerUserId: invite.ownerUserId,
          teamId: invite.teamId,
          branchId: singleBranchId,
          scopes: scopeList.length > 0 ? scopeList : null,
          roles: ["MEMBER"],
          defaultDashboard: "owner",
          isDefault: false,
        },
      });
    }

    await tx.teamInvitation.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", acceptedByUserId: userId },
    });
  });

  return { userId, invite };
}

/**
 * List all pending (and optionally other) invitations for an owner (across all their teams).
 * @param {number} ownerUserId
 * @param {string} [statusFilter] - optional: PENDING, ACCEPTED, etc.; default all
 * @returns {Promise<Array<{ id, email, status, invitedAt, expiresAt, teamId, teamName, scopes }>>}
 */
async function listOwnerInvitations(ownerUserId, statusFilter = null) {
  const where = { ownerUserId };
  if (statusFilter) where.status = statusFilter;
  const rows = await prisma.teamInvitation.findMany({
    where,
    select: {
      id: true,
      email: true,
      status: true,
      createdAt: true,
      expiresAt: true,
      teamId: true,
      scopes: true,
      team: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    status: r.status,
    invitedAt: r.createdAt,
    expiresAt: r.expiresAt,
    teamId: r.teamId,
    teamName: r.team?.name ?? null,
    scopes: r.scopes ?? [],
  }));
}

/**
 * List team invitations for an owner's team (for UI pending list).
 * @param {number} ownerUserId
 * @param {number} teamId
 * @returns {Promise<Array<{ id, email, status, createdAt }>>}
 */
async function listTeamInvitations(ownerUserId, teamId) {
  const team = await prisma.ownerTeam.findFirst({
    where: { id: teamId, ownerUserId },
    select: { id: true },
  });
  if (!team) throw new Error("Team not found or not owned by you");
  const rows = await prisma.teamInvitation.findMany({
    where: { teamId, ownerUserId },
    select: { id: true, email: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    status: r.status,
    invitedAt: r.createdAt,
  }));
}

/**
 * Resend a team invitation: new token, update expiresAt. Only for PENDING invites owned by ownerUserId.
 * @param {number} invitationId
 * @param {number} ownerUserId
 * @returns {Promise<{ invite, rawToken }>}
 */
async function resendTeamInvitation(invitationId, ownerUserId) {
  const invite = await prisma.teamInvitation.findFirst({
    where: { id: Number(invitationId), ownerUserId },
    select: { id: true, status: true },
  });
  if (!invite) throw new Error("Invitation not found or not owned by you");
  if (invite.status !== "PENDING") throw new Error("Only PENDING invitations can be resent");

  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000);

  await prisma.teamInvitation.update({
    where: { id: invite.id },
    data: { tokenHash, expiresAt },
  });

  return {
    invite: await prisma.teamInvitation.findUnique({ where: { id: invite.id } }),
    rawToken,
  };
}

/**
 * Cancel (revoke) a team invitation. Only for PENDING invites owned by ownerUserId.
 * @param {number} invitationId
 * @param {number} ownerUserId
 */
async function cancelTeamInvitation(invitationId, ownerUserId) {
  const invite = await prisma.teamInvitation.findFirst({
    where: { id: Number(invitationId), ownerUserId },
    select: { id: true, status: true },
  });
  if (!invite) throw new Error("Invitation not found or not owned by you");
  if (invite.status !== "PENDING") throw new Error("Only PENDING invitations can be cancelled");

  await prisma.teamInvitation.update({
    where: { id: invite.id },
    data: { status: "REVOKED" },
  });
}

module.exports = {
  createTeamInvitation,
  verifyTeamInvitation,
  acceptTeamInvitation,
  listTeamInvitations,
  listOwnerInvitations,
  resendTeamInvitation,
  cancelTeamInvitation,
};
