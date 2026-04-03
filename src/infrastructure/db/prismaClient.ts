/**
 * Prisma ORM 7+ with PostgreSQL uses the `pg` driver adapter (no URL in schema).
 * Requires `DATABASE_URL` at process env when this module loads.
 * After `npm install`, `postinstall` runs `prisma generate` (see `scripts/run-local-prisma.cjs`).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  __bpa_prisma__?: PrismaClient;
  __bpa_pg_pool__?: Pool;
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !String(databaseUrl).trim()) {
  throw new Error("DATABASE_URL must be set for PrismaClient");
}

function createPrismaClient(): PrismaClient {
  const pool =
    globalForPrisma.__bpa_pg_pool__ ??
    new Pool({ connectionString: databaseUrl });
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__bpa_pg_pool__ = pool;
  }
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: ["error", "warn"],
  });
}

const prisma = globalForPrisma.__bpa_prisma__ ?? createPrismaClient();

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
