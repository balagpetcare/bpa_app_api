/**
 * App-level Prisma singleton — delegates to the driver-adapter client (Prisma ORM 7+).
 */
const prisma = require("../infrastructure/db/prismaClient");

module.exports = { prisma };

export {};
