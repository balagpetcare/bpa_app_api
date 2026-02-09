/**
 * Owner Delegation Service
 * Manages teams, delegations, and scope-based permission checks.
 * (Plain JS to avoid TS6200 identifier conflict with owner.controller.ts)
 */

const prismaClient = require("../../../infrastructure/db/prismaClient").default;
const { isValidScopeKey } = require("../constants/delegationScopes");

async function isOwnerOfOrg(ownerUserId, orgId) {
  const org = await prismaClient.organization.findFirst({
    where: { id: orgId, ownerUserId },
    select: { id: true },
  });
  return Boolean(org);
}

async function getOwnerOrgIds(ownerUserId) {
  const orgs = await prismaClient.organization.findMany({
    where: { ownerUserId },
    select: { id: true },
  });
  return orgs.map((o) => o.id);
}

async function getDelegationsForUser(ownerUserId, delegatedUserId) {
  return prismaClient.ownerDelegation.findMany({
    where: { ownerUserId, delegatedUserId },
    include: {
      org: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
  });
}

async function getDelegationsByScope(delegatedUserId, scopeKey) {
  if (!isValidScopeKey(scopeKey)) return [];
  return prismaClient.ownerDelegation.findMany({
    where: { delegatedUserId, scopeKey },
    include: {
      owner: {
        select: {
          id: true,
          profile: { select: { displayName: true } },
          auth: { select: { email: true } },
        },
      },
      org: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
  });
}

async function hasDelegationScope(delegatedUserId, ownerUserId, scopeKey, orgId, branchId) {
  if (!isValidScopeKey(scopeKey)) return false;
  const delegations = await prismaClient.ownerDelegation.findMany({
    where: { ownerUserId, delegatedUserId, scopeKey },
  });
  for (const d of delegations) {
    if (d.orgId == null && d.branchId == null) return true;
    if (orgId != null && d.orgId === orgId && d.branchId == null) return true;
    if (branchId != null && d.branchId === branchId) return true;
  }
  return false;
}

async function getOwnerTeams(ownerUserId) {
  return prismaClient.ownerTeam.findMany({
    where: { ownerUserId },
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              profile: { select: { displayName: true } },
              auth: { select: { email: true, phone: true } },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });
}

/**
 * @param {number} ownerUserId
 * @param {string} name
 * @param {string} [description]
 * @param {string[]} [scopes] - optional array of valid scope keys (products, inventory, staff, branches, etc.)
 */
async function createOwnerTeam(ownerUserId, name, description, scopes) {
  const scopeArray = Array.isArray(scopes) ? scopes.filter(Boolean).map((s) => String(s).trim()) : [];
  for (const key of scopeArray) {
    if (!isValidScopeKey(key)) throw new Error(`Invalid scope: ${key}`);
  }
  const scopesJson = scopeArray.length > 0 ? scopeArray : null;
  try {
    return await prismaClient.ownerTeam.create({
      data: {
        ownerUserId,
        name,
        description: description ?? null,
        scopes: scopesJson,
      },
    });
  } catch (e) {
    if (e.code === "P2002") throw new Error("A team with this name already exists.");
    throw e;
  }
}

async function addTeamMember(teamId, ownerUserId, userId, roleInTeam) {
  const team = await prismaClient.ownerTeam.findFirst({
    where: { id: teamId, ownerUserId },
  });
  if (!team) throw new Error("Team not found");
  return prismaClient.ownerTeamMember.upsert({
    where: { teamId_userId: { teamId, userId } },
    update: { roleInTeam: roleInTeam ?? null },
    create: { teamId, userId, roleInTeam: roleInTeam ?? null },
  });
}

async function removeTeamMember(teamId, ownerUserId, userId) {
  const team = await prismaClient.ownerTeam.findFirst({
    where: { id: teamId, ownerUserId },
  });
  if (!team) throw new Error("Team not found");
  return prismaClient.ownerTeamMember.delete({
    where: { teamId_userId: { teamId, userId } },
  });
}

async function assignDelegation(ownerUserId, delegatedUserId, scopeKey, options) {
  if (!isValidScopeKey(scopeKey)) throw new Error(`Invalid scope: ${scopeKey}`);
  const orgIds = await getOwnerOrgIds(ownerUserId);
  if (options?.orgId && !orgIds.includes(options.orgId)) {
    throw new Error("Forbidden: org not under owner");
  }
  if (options?.branchId) {
    const branch = await prismaClient.branch.findFirst({
      where: { id: options.branchId, orgId: { in: orgIds } },
    });
    if (!branch) throw new Error("Forbidden: branch not under owner");
  }
  const orgId = options?.orgId ?? null;
  const branchId = options?.branchId ?? null;
  const teamId = options?.teamId ?? null;
  const existing = await prismaClient.ownerDelegation.findFirst({
    where: { ownerUserId, delegatedUserId, scopeKey, orgId, branchId },
  });
  if (existing) {
    return prismaClient.ownerDelegation.update({
      where: { id: existing.id },
      data: { teamId, updatedAt: new Date() },
    });
  }
  return prismaClient.ownerDelegation.create({
    data: { ownerUserId, delegatedUserId, scopeKey, orgId, branchId, teamId },
  });
}

async function revokeDelegation(ownerUserId, delegatedUserId, scopeKey, orgId, branchId) {
  const where = {
    ownerUserId,
    delegatedUserId,
    scopeKey,
    orgId: orgId ?? null,
    branchId: branchId ?? null,
  };
  const existing = await prismaClient.ownerDelegation.findFirst({ where });
  if (!existing) return null;
  return prismaClient.ownerDelegation.delete({ where: { id: existing.id } });
}

/** Revoke all delegations for a user under this owner. Returns count deleted. */
async function revokeAllDelegationsForUser(ownerUserId, delegatedUserId) {
  const result = await prismaClient.ownerDelegation.deleteMany({
    where: { ownerUserId, delegatedUserId },
  });
  return result.count;
}

/** Set team for all delegations of a user under this owner. teamId must be one of owner's teams. Returns count updated. */
async function setTeamForUser(ownerUserId, delegatedUserId, teamId) {
  const team = await prismaClient.ownerTeam.findFirst({
    where: { id: teamId, ownerUserId },
  });
  if (!team) throw new Error("Team not found or not owned by you");
  const result = await prismaClient.ownerDelegation.updateMany({
    where: { ownerUserId, delegatedUserId },
    data: { teamId, updatedAt: new Date() },
  });
  return result.count;
}

async function getPermissionScopes() {
  return prismaClient.ownerPermissionScope.findMany({
    orderBy: { sortOrder: "asc" },
  });
}

/**
 * Flat list of team members for dashboard table (name, email, team, role, scopes, branchAccessCount).
 * @param {number} ownerUserId
 * @returns {Promise<Array<{ name, email, teamId, teamName, role, scopes, branchAccessCount, status, userId }>>}
 */
async function getTeamMembersForDashboard(ownerUserId) {
  const teams = await prismaClient.ownerTeam.findMany({
    where: { ownerUserId },
    select: {
      id: true,
      name: true,
      members: {
        select: {
          userId: true,
          roleInTeam: true,
          user: {
            select: {
              profile: { select: { displayName: true } },
              auth: { select: { email: true, phone: true } },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const delegatedUserIds = new Set();
  teams.forEach((t) => t.members.forEach((m) => delegatedUserIds.add(m.userId)));

  const delegations =
    delegatedUserIds.size === 0
      ? []
      : await prismaClient.ownerDelegation.findMany({
          where: { ownerUserId, delegatedUserId: { in: [...delegatedUserIds] } },
          select: { delegatedUserId: true, scopeKey: true, branchId: true },
        });
  const scopesByUser = new Map();
  const branchIdsByUser = new Map();
  delegations.forEach((d) => {
    if (!scopesByUser.has(d.delegatedUserId)) scopesByUser.set(d.delegatedUserId, new Set());
    scopesByUser.get(d.delegatedUserId).add(d.scopeKey);
    if (d.branchId != null) {
      if (!branchIdsByUser.has(d.delegatedUserId)) branchIdsByUser.set(d.delegatedUserId, new Set());
      branchIdsByUser.get(d.delegatedUserId).add(d.branchId);
    }
  });

  const out = [];
  for (const team of teams) {
    for (const m of team.members) {
      const email = m.user?.auth?.email || m.user?.auth?.phone || "";
      const name = m.user?.profile?.displayName || email || "—";
      const scopes = Array.from(scopesByUser.get(m.userId) || []);
      const branchAccessCount = (branchIdsByUser.get(m.userId) || new Set()).size;
      out.push({
        name,
        email,
        teamId: team.id,
        teamName: team.name,
        role: m.roleInTeam || "MEMBER",
        scopes,
        branchAccessCount,
        status: "ACTIVE",
        userId: m.userId,
      });
    }
  }
  return out;
}

module.exports = {
  isOwnerOfOrg,
  getOwnerOrgIds,
  getDelegationsForUser,
  getDelegationsByScope,
  hasDelegationScope,
  getOwnerTeams,
  getTeamMembersForDashboard,
  createOwnerTeam,
  addTeamMember,
  removeTeamMember,
  assignDelegation,
  revokeDelegation,
  revokeAllDelegationsForUser,
  setTeamForUser,
  getPermissionScopes,
};
