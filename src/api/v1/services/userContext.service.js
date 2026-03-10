/**
 * User Context Service
 * Multi-context: list contexts for user, set current (default), create context.
 */

const prisma = require("../../../infrastructure/db/prismaClient").default ?? require("../../../infrastructure/db/prismaClient");

/**
 * List all contexts for a user (owner, branch, team, roles, scopes).
 * @param {number} userId
 * @returns {Promise<Array>} contexts with branch/team/owner names
 */
async function listContexts(userId) {
  const rows = await prisma.userContext.findMany({
    where: { userId },
    include: {
      owner: { select: { id: true, profile: { select: { displayName: true } } } },
      branch: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
    },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    ownerUserId: r.ownerUserId,
    branchId: r.branchId,
    teamId: r.teamId,
    roles: r.roles,
    scopes: r.scopes,
    defaultDashboard: r.defaultDashboard,
    isDefault: r.isDefault,
    owner: r.owner ? { id: r.owner.id, displayName: r.owner.profile?.displayName } : null,
    branch: r.branch ? { id: r.branch.id, name: r.branch.name } : null,
    team: r.team ? { id: r.team.id, name: r.team.name } : null,
  }));
}

/**
 * Set one context as the default for the user.
 * @param {number} userId
 * @param {number} contextId
 */
async function setDefaultContext(userId, contextId) {
  const ctx = await prisma.userContext.findFirst({
    where: { id: contextId, userId },
  });
  if (!ctx) throw new Error("Context not found");
  await prisma.$transaction([
    prisma.userContext.updateMany({
      where: { userId },
      data: { isDefault: false },
    }),
    prisma.userContext.update({
      where: { id: contextId },
      data: { isDefault: true },
    }),
  ]);
  return prisma.userContext.findUnique({
    where: { id: contextId },
    include: {
      owner: { select: { id: true, profile: { select: { displayName: true } } } },
      branch: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
    },
  });
}

/**
 * Create a user context (e.g. from onboarding or after branch join).
 * @param {object} data - { userId, ownerUserId?, branchId?, teamId?, roles?, scopes?, defaultDashboard?, isDefault? }
 */
async function createContext(data) {
  const {
    userId,
    ownerUserId = null,
    branchId = null,
    teamId = null,
    roles = [],
    scopes = [],
    defaultDashboard = "owner",
    isDefault = false,
  } = data;
  if (!userId) throw new Error("userId is required");
  const existing = await prisma.userContext.findFirst({
    where: {
      userId,
      ownerUserId: ownerUserId ?? null,
      branchId: branchId ?? null,
      teamId: teamId ?? null,
    },
  });
  if (existing) return existing;
  if (isDefault) {
    await prisma.userContext.updateMany({
      where: { userId },
      data: { isDefault: false },
    });
  }
  return prisma.userContext.create({
    data: {
      userId,
      ownerUserId,
      branchId,
      teamId,
      roles: Array.isArray(roles) ? roles : [],
      scopes: Array.isArray(scopes) ? scopes : [],
      defaultDashboard: defaultDashboard || "owner",
      isDefault: Boolean(isDefault),
    },
  });
}

/**
 * Get the default (or first) context for user. Returns null if none.
 */
async function getDefaultContext(userId) {
  let ctx = await prisma.userContext.findFirst({
    where: { userId, isDefault: true },
    include: {
      owner: { select: { id: true, profile: { select: { displayName: true } } } },
      branch: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
    },
  });
  if (!ctx) {
    ctx = await prisma.userContext.findFirst({
      where: { userId },
      include: {
        owner: { select: { id: true, profile: { select: { displayName: true } } } },
        branch: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
      },
    });
  }
  return ctx;
}

module.exports = {
  listContexts,
  setDefaultContext,
  createContext,
  getDefaultContext,
};
