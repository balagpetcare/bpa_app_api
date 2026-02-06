const { prisma } = require("../../../../lib/prisma");

function withStatus(message, statusCode) {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = statusCode;
  return err;
}

async function getOrgIdForUser(userId) {
  const member = await prisma.orgMember.findFirst({
    where: { userId, status: "ACTIVE" },
    select: { orgId: true },
  });
  return member?.orgId || null;
}

async function listFactories({ userId }) {
  const orgId = await getOrgIdForUser(userId);
  if (!orgId) return [];
  return prisma.factory.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    include: { lines: true },
  });
}

async function createFactory({ userId, name, countryCode, addressJson }) {
  if (!name) {
    throw withStatus("Factory name is required", 400);
  }
  const orgId = await getOrgIdForUser(userId);
  if (!orgId) {
    throw withStatus("You must be a member of an organization", 403);
  }

  return prisma.factory.create({
    data: {
      orgId,
      name: String(name).trim(),
      countryCode: countryCode ? String(countryCode).trim().toUpperCase().slice(0, 2) : null,
      addressJson: addressJson || null,
    },
  });
}

async function listLines({ userId, factoryId }) {
  const orgId = await getOrgIdForUser(userId);
  if (!orgId) return [];
  const factory = await prisma.factory.findUnique({ where: { id: Number(factoryId) } });
  if (!factory || factory.orgId !== orgId) {
    throw withStatus("Factory not found", 404);
  }
  return prisma.productionLine.findMany({
    where: { factoryId: factory.id },
    orderBy: { createdAt: "desc" },
  });
}

async function createLine({ userId, factoryId, lineCode, deviceId }) {
  if (!lineCode) {
    throw withStatus("lineCode is required", 400);
  }
  const orgId = await getOrgIdForUser(userId);
  if (!orgId) {
    throw withStatus("You must be a member of an organization", 403);
  }
  const factory = await prisma.factory.findUnique({ where: { id: Number(factoryId) } });
  if (!factory || factory.orgId !== orgId) {
    throw withStatus("Factory not found", 404);
  }

  return prisma.productionLine.create({
    data: {
      factoryId: factory.id,
      lineCode: String(lineCode).trim(),
      deviceId: deviceId ? String(deviceId).trim() : null,
    },
  });
}

module.exports = {
  listFactories,
  createFactory,
  listLines,
  createLine,
};
export { listFactories, createFactory, listLines, createLine };
