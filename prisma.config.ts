/**
 * Prisma ORM 7+: database URL and CLI settings live here (not in schema.prisma).
 * @see https://www.prisma.io/docs/orm/reference/prisma-config-reference
 */
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    /** Used by `prisma db seed` / `npm run seed` (Prisma 7+ reads this from prisma.config.ts). */
    seed: "node -r ts-node/register prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
    shadowDatabaseUrl: env("SHADOW_DATABASE_URL"),
  },
});
