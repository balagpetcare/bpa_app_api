import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  __bpa_prisma__?: PrismaClient;
};

const prisma =
  globalForPrisma.__bpa_prisma__ ??
  new PrismaClient({
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__bpa_prisma__ = prisma;
}

/**
 * ESM / TypeScript default export
 */
export default prisma;

/**
 * CommonJS compatibility (for require())
 */
module.exports = prisma;
module.exports.default = prisma;
module.exports.prisma = prisma;
