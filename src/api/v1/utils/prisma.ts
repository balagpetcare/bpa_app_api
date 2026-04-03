/**
 * Shared Prisma instance for modules that require this path.
 */
const prisma = require("../../../infrastructure/db/prismaClient");

module.exports = { prisma };

export {};
