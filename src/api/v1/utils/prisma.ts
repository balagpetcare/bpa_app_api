const { PrismaClient } = require('@prisma/client');

// Use a single Prisma client instance
const prisma = new PrismaClient();

module.exports = { prisma };

export {};
