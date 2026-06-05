#!/usr/bin/env node
/**
 * Apply all Prisma migrations to a fresh PostgreSQL database, then drop it.
 * Validates migration ordering (including campaign checkout after national rollout).
 *
 * Usage:
 *   node scripts/validate-migrate-deploy-clean.mjs
 *
 * Requires: DATABASE_URL in .env pointing at a server where this script may CREATE/DROP
 *           a database named bpa_migrate_clean_<timestamp> (uses same host/credentials).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

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

async function main() {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const parts = parseDbUrl(baseUrl);
  const testDb = `bpa_migrate_clean_${Date.now()}`;
  const adminUrl = buildUrl(parts, "postgres");
  const testUrl = buildUrl(parts, testDb);

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();

  try {
    const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [testDb]);
    if (exists.rowCount) {
      await admin.query(`DROP DATABASE "${testDb}" WITH (FORCE)`);
    }
    await admin.query(`CREATE DATABASE "${testDb}"`);
    console.log(`Created empty database: ${testDb}`);
  } finally {
    await admin.end();
  }

  const prismaBin = path.join(ROOT, "node_modules", ".bin", "prisma");
  const cmd = process.platform === "win32" ? `"${prismaBin}.cmd"` : prismaBin;

  console.log("Running prisma migrate deploy on clean database...");
  const deploy = spawnSync(cmd, ["migrate", "deploy"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testUrl },
    shell: true,
  });

  if (deploy.status !== 0) {
    console.error("migrate deploy failed on clean database.");
    process.exit(deploy.status ?? 1);
  }

  const verify = new pg.Client({ connectionString: testUrl });
  await verify.connect();
  try {
    const tables = [
      "campaign_rollout_regions",
      "campaign_checkout_sessions",
      "campaign_pre_registrations",
    ];
    for (const t of tables) {
      const { rows } = await verify.query(`SELECT to_regclass($1) AS reg`, [`public.${t}`]);
      if (!rows[0]?.reg) {
        throw new Error(`Expected table missing after deploy: ${t}`);
      }
    }
    const { rows: countRows } = await verify.query(
      `SELECT COUNT(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`
    );
    console.log(`Applied migrations: ${countRows[0].n}`);
    console.log("Campaign tables verified: campaign_rollout_regions, campaign_checkout_sessions, campaign_pre_registrations");
  } finally {
    await verify.end();
  }

  const admin2 = new pg.Client({ connectionString: adminUrl });
  await admin2.connect();
  try {
    await admin2.query(`DROP DATABASE "${testDb}" WITH (FORCE)`);
    console.log(`Dropped test database: ${testDb}`);
  } finally {
    await admin2.end();
  }

  console.log("Clean-database migrate deploy validation: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
