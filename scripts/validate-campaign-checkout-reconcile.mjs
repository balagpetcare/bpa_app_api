#!/usr/bin/env node
/**
 * Validate idempotent campaign checkout migration:
 *   1) fresh database full deploy
 *   2) partial state (enum pre-exists, checkout migration re-applied)
 *   3) failed migration row cleared then redeploy
 *
 * Usage: node scripts/validate-campaign-checkout-reconcile.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CHECKOUT_MIGRATION = "20260604130000_campaign_checkout_session";

dotenv.config({ path: path.join(ROOT, ".env") });

function parseDbUrl(url) {
  const u = new URL(url);
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    host: u.hostname,
    port: u.port || "5432",
    database: u.pathname.replace(/^\//, ""),
  };
}

function buildUrl(parts, database) {
  const u = new URL("postgresql://localhost");
  u.username = encodeURIComponent(parts.user);
  if (parts.password) u.password = encodeURIComponent(parts.password);
  u.hostname = parts.host;
  u.port = parts.port;
  u.pathname = `/${database}`;
  return u.toString();
}

function prisma(args, env) {
  const prismaBin = path.join(ROOT, "node_modules", ".bin", "prisma");
  const cmd = process.platform === "win32" ? `"${prismaBin}.cmd"` : prismaBin;
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed`);
  }
}

async function createDb(adminUrl, name) {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
}

async function dropDb(adminUrl, name) {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

async function assertCheckoutObjects(client) {
  const checks = [
    [`enum CampaignCheckoutStatus`, `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CampaignCheckoutStatus') AS ok`],
    [`table campaign_checkout_sessions`, `SELECT to_regclass('public.campaign_checkout_sessions') IS NOT NULL AS ok`],
    [`column bookedCount`, `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='campaign_rollout_regions' AND column_name='bookedCount') AS ok`],
    [`FK campaign_checkout_sessions_campaignId_fkey`, `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='campaign_checkout_sessions_campaignId_fkey') AS ok`],
  ];
  for (const [label, sql] of checks) {
    const { rows } = await client.query(sql);
    if (!rows[0]?.ok) throw new Error(`Missing after reconcile: ${label}`);
  }
}

async function simulatePartialEnumOnly(client) {
  await client.query(`
    DELETE FROM _prisma_migrations WHERE migration_name = $1
  `, [CHECKOUT_MIGRATION]);

  await client.query(`ALTER TABLE "campaign_bookings" DROP CONSTRAINT IF EXISTS "campaign_bookings_checkoutSessionId_fkey"`);
  await client.query(`ALTER TABLE "campaign_bookings" DROP CONSTRAINT IF EXISTS "campaign_bookings_rolloutRegionId_fkey"`);
  await client.query(`DROP TABLE IF EXISTS "campaign_checkout_sessions" CASCADE`);
  await client.query(`DROP INDEX IF EXISTS "campaign_bookings_rolloutRegionId_idx"`);
  await client.query(`DROP INDEX IF EXISTS "campaign_bookings_checkoutSessionId_key"`);
  await client.query(`ALTER TABLE "campaign_bookings" DROP COLUMN IF EXISTS "rolloutRegionId"`);
  await client.query(`ALTER TABLE "campaign_bookings" DROP COLUMN IF EXISTS "checkoutSessionId"`);
  await client.query(`ALTER TABLE "campaign_bookings" DROP COLUMN IF EXISTS "ownerAlternatePhone"`);
  await client.query(`ALTER TABLE "campaign_rollout_regions" DROP COLUMN IF EXISTS "bookedCount"`);

  await client.query(`
    DO $$
    BEGIN
      CREATE TYPE "CampaignCheckoutStatus" AS ENUM ('PENDING', 'PAID', 'FULFILLED', 'EXPIRED', 'FAILED');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
}

async function simulateFailedMigrationRow(client) {
  await client.query(`DELETE FROM _prisma_migrations WHERE migration_name = $1`, [CHECKOUT_MIGRATION]);
  await client.query(
    `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
     VALUES (gen_random_uuid()::text, 'stale', NULL, $1, 'ERROR: type CampaignCheckoutStatus already exists', NULL, NOW(), 1)`,
    [CHECKOUT_MIGRATION]
  );
}

async function main() {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const parts = parseDbUrl(baseUrl);
  const adminUrl = buildUrl(parts, "postgres");
  const ts = Date.now();

  // Scenario 1: fresh database
  const freshDb = `bpa_checkout_fresh_${ts}`;
  const freshUrl = buildUrl(parts, freshDb);
  console.log("\n=== Scenario 1: fresh database ===");
  await createDb(adminUrl, freshDb);
  try {
    prisma(["migrate", "deploy"], { DATABASE_URL: freshUrl });
    const c = new pg.Client({ connectionString: freshUrl });
    await c.connect();
    try {
      await assertCheckoutObjects(c);
    } finally {
      await c.end();
    }
    console.log("Scenario 1: PASS");
  } finally {
    await dropDb(adminUrl, freshDb);
  }

  // Scenario 2: partial (enum only) then redeploy checkout
  const partialDb = `bpa_checkout_partial_${ts}`;
  const partialUrl = buildUrl(parts, partialDb);
  console.log("\n=== Scenario 2: partial apply (enum pre-exists) ===");
  await createDb(adminUrl, partialDb);
  try {
    prisma(["migrate", "deploy"], { DATABASE_URL: partialUrl });
    const c = new pg.Client({ connectionString: partialUrl });
    await c.connect();
    try {
      await simulatePartialEnumOnly(c);
    } finally {
      await c.end();
    }
    prisma(["migrate", "deploy"], { DATABASE_URL: partialUrl });
    const c2 = new pg.Client({ connectionString: partialUrl });
    await c2.connect();
    try {
      await assertCheckoutObjects(c2);
      const { rows } = await c2.query(
        `SELECT finished_at IS NOT NULL AS ok FROM _prisma_migrations WHERE migration_name = $1`,
        [CHECKOUT_MIGRATION]
      );
      if (!rows[0]?.ok) throw new Error("Checkout migration not marked finished after partial reconcile");
    } finally {
      await c2.end();
    }
    console.log("Scenario 2: PASS");
  } finally {
    await dropDb(adminUrl, partialDb);
  }

  // Scenario 3: failed migration row (P3018) then resolve + redeploy
  const failedDb = `bpa_checkout_failed_${ts}`;
  const failedUrl = buildUrl(parts, failedDb);
  console.log("\n=== Scenario 3: failed migration metadata ===");
  await createDb(adminUrl, failedDb);
  try {
    prisma(["migrate", "deploy"], { DATABASE_URL: failedUrl });
    const c = new pg.Client({ connectionString: failedUrl });
    await c.connect();
    try {
      await simulatePartialEnumOnly(c);
      await simulateFailedMigrationRow(c);
    } finally {
      await c.end();
    }
    prisma(["migrate", "resolve", "--rolled-back", CHECKOUT_MIGRATION], { DATABASE_URL: failedUrl });
    prisma(["migrate", "deploy"], { DATABASE_URL: failedUrl });
    const c2 = new pg.Client({ connectionString: failedUrl });
    await c2.connect();
    try {
      await assertCheckoutObjects(c2);
    } finally {
      await c2.end();
    }
    console.log("Scenario 3: PASS");
  } finally {
    await dropDb(adminUrl, failedDb);
  }

  console.log("\nAll campaign checkout reconciliation scenarios: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
