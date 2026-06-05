#!/usr/bin/env node
/**
 * Repair migration metadata after campaign checkout reorder fix.
 *
 * Renamed: 20260603120000_campaign_checkout_session
 *       -> 20260604130000_campaign_checkout_session
 *
 * Usage:
 *   node scripts/repair-campaign-migration-order.mjs
 *   node scripts/repair-campaign-migration-order.mjs --resolve-failed
 *   node scripts/repair-campaign-migration-order.mjs --rename-applied
 *
 * @see docs/audits/CAMPAIGN_MIGRATION_PRODUCTION_FIX.md
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const OLD_MIGRATION = "20260603120000_campaign_checkout_session";
const NEW_MIGRATION = "20260604130000_campaign_checkout_session";

const RESOLVE_FAILED = process.argv.includes("--resolve-failed");
const RENAME_APPLIED = process.argv.includes("--rename-applied");

dotenv.config({ path: path.join(ROOT, ".env") });

function migrationChecksum(name) {
  const sqlPath = path.join(ROOT, "prisma", "migrations", name, "migration.sql");
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`Missing migration file: ${sqlPath}`);
  }
  const content = fs.readFileSync(sqlPath, "utf8");
  return crypto.createHash("sha256").update(content).digest("hex");
}

function runPrisma(args) {
  const prismaBin = path.join(ROOT, "node_modules", ".bin", "prisma");
  const cmd = process.platform === "win32" ? `"${prismaBin}.cmd"` : prismaBin;
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
    shell: true,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. Configure .env before running this script.");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();

  try {
    const { rows } = await client.query(
      `SELECT migration_name, finished_at, rolled_back_at, applied_steps_count, logs
       FROM _prisma_migrations
       WHERE migration_name IN ($1, $2)
       ORDER BY migration_name`,
      [OLD_MIGRATION, NEW_MIGRATION]
    );

    console.log("Campaign migration order repair — inspection\n");
    console.log(`Old (renamed away): ${OLD_MIGRATION}`);
    console.log(`New (deploy target): ${NEW_MIGRATION}\n`);

    const oldRow = rows.find((r) => r.migration_name === OLD_MIGRATION);
    const newRow = rows.find((r) => r.migration_name === NEW_MIGRATION);

    if (rows.length === 0) {
      console.log("No checkout migration rows. Safe to run: npx prisma migrate deploy");
      return;
    }

    for (const row of rows) {
      console.log(JSON.stringify(row, null, 2));
    }

    if (newRow?.finished_at) {
      console.log("\nNew checkout migration already applied. Nothing to repair.");
      return;
    }

    if (oldRow?.finished_at) {
      console.log("\nDetected: old checkout migration applied successfully (dev/out-of-order history).");
      console.log("Rename _prisma_migrations row to new migration name (no DDL re-run).");
      console.log(`  node scripts/repair-campaign-migration-order.mjs --rename-applied`);

      if (RENAME_APPLIED) {
        const checksum = migrationChecksum(NEW_MIGRATION);
        await client.query(
          `UPDATE _prisma_migrations
           SET migration_name = $1, checksum = $2
           WHERE migration_name = $3 AND finished_at IS NOT NULL`,
          [NEW_MIGRATION, checksum, OLD_MIGRATION]
        );
        console.log("\nMetadata renamed. Run: npx prisma migrate deploy");
      } else {
        process.exitCode = 1;
      }
      return;
    }

    const oldNeedsResolve = oldRow && !oldRow.finished_at && !oldRow.rolled_back_at;

    if (oldNeedsResolve) {
      console.log("\nDetected: failed checkout migration (P3018). Clear before deploy.");
      console.log(`  npx prisma migrate resolve --rolled-back ${OLD_MIGRATION}`);
      console.log("  node scripts/repair-campaign-migration-order.mjs --resolve-failed");

      if (RESOLVE_FAILED) {
        console.log("\nRunning migrate resolve --rolled-back ...");
        runPrisma(["migrate", "resolve", "--rolled-back", OLD_MIGRATION]);
        console.log("\nResolve complete. Next: npx prisma migrate deploy");
      } else {
        process.exitCode = 1;
      }
      return;
    }

    if (oldRow?.rolled_back_at) {
      console.log("\nOld migration marked rolled back. Run: npx prisma migrate deploy");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
