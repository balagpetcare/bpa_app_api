#!/usr/bin/env node
/**
 * Inspect campaign checkout DDL objects on the connected database.
 * Use on VPS before/after reconciliation deploy.
 *
 * Usage: node scripts/inspect-campaign-checkout-objects.mjs
 */
import pg from "pg";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const CHECKOUT_MIGRATION = "20260604130000_campaign_checkout_session";

const ENUMS = ["CampaignCheckoutStatus"];
const TABLES = ["campaign_checkout_sessions"];
const BOOKING_COLUMNS = ["rolloutRegionId", "checkoutSessionId", "ownerAlternatePhone"];
const REGION_COLUMNS = ["bookedCount"];
const INDEXES = [
  "campaign_bookings_rolloutRegionId_idx",
  "campaign_bookings_checkoutSessionId_key",
  "campaign_checkout_sessions_ownerPhone_idx",
  "campaign_checkout_sessions_status_expiresAt_idx",
  "campaign_checkout_sessions_campaignId_idx",
];
const CONSTRAINTS = [
  "campaign_bookings_rolloutRegionId_fkey",
  "campaign_bookings_checkoutSessionId_fkey",
  "campaign_checkout_sessions_campaignId_fkey",
  "campaign_checkout_sessions_rolloutRegionId_fkey",
  "campaign_checkout_sessions_orderId_fkey",
];

async function exists(client, sql, params) {
  const { rows } = await client.query(sql, params);
  return Boolean(rows[0]?.ok);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const { rows: migRows } = await client.query(
      `SELECT migration_name, finished_at, rolled_back_at, applied_steps_count, logs
       FROM _prisma_migrations
       WHERE migration_name LIKE '%checkout_session%'
       ORDER BY started_at`
    );

    console.log("=== _prisma_migrations (checkout) ===");
    console.log(JSON.stringify(migRows, null, 2));

    console.log("\n=== Enums ===");
    for (const e of ENUMS) {
      const ok = await exists(
        client,
        `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = $1) AS ok`,
        [e]
      );
      console.log(`${ok ? "YES" : "NO "}  ${e}`);
    }

    console.log("\n=== Tables ===");
    for (const t of TABLES) {
      const ok = await exists(client, `SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${t}`]);
      console.log(`${ok ? "YES" : "NO "}  ${t}`);
    }

    console.log("\n=== campaign_bookings columns ===");
    for (const c of BOOKING_COLUMNS) {
      const ok = await exists(
        client,
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'campaign_bookings' AND column_name = $1
         ) AS ok`,
        [c]
      );
      console.log(`${ok ? "YES" : "NO "}  campaign_bookings.${c}`);
    }

    console.log("\n=== campaign_rollout_regions columns ===");
    for (const c of REGION_COLUMNS) {
      const ok = await exists(
        client,
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'campaign_rollout_regions' AND column_name = $1
         ) AS ok`,
        [c]
      );
      console.log(`${ok ? "YES" : "NO "}  campaign_rollout_regions.${c}`);
    }

    console.log("\n=== Indexes ===");
    for (const i of INDEXES) {
      const ok = await exists(
        client,
        `SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1) AS ok`,
        [i]
      );
      console.log(`${ok ? "YES" : "NO "}  ${i}`);
    }

    console.log("\n=== Foreign keys ===");
    for (const c of CONSTRAINTS) {
      const ok = await exists(
        client,
        `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = $1) AS ok`,
        [c]
      );
      console.log(`${ok ? "YES" : "NO "}  ${c}`);
    }

    const checkoutApplied = migRows.some(
      (r) => r.migration_name === CHECKOUT_MIGRATION && r.finished_at
    );
    console.log("\n=== Summary ===");
    console.log(`Checkout migration marked applied: ${checkoutApplied ? "YES" : "NO"}`);
    console.log(`See docs/audits/CAMPAIGN_CHECKOUT_RECONCILIATION_PLAN.md for next steps.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
