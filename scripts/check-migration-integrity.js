#!/usr/bin/env node
/**
 * Migration Integrity Check
 *
 * Policy: run before and after any Prisma migration work on production-like DBs.
 * @see docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md
 *
 * Detects if any applied migration files have been modified after application.
 * If drift is detected: stop, do not reset — plan reconciliation (see
 * docs/non_destructive_prisma_drift_recovery_plan.md).
 *
 * Usage:
 *   node scripts/check-migration-integrity.js
 *   node scripts/check-migration-integrity.js --fix  (updates checksums — emergency / governed use only)
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const FIX_MODE = process.argv.includes('--fix');

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT migration_name, checksum FROM _prisma_migrations WHERE applied_steps_count > 0`
    );

    const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
    const modified = [];

    for (const row of rows) {
      const sqlFile = path.join(migrationsDir, row.migration_name, 'migration.sql');
      if (!fs.existsSync(sqlFile)) continue;

      const content = fs.readFileSync(sqlFile, 'utf8');
      const diskChecksum = crypto.createHash('sha256').update(content).digest('hex');

      if (row.checksum !== diskChecksum) {
        modified.push({ name: row.migration_name, dbChecksum: row.checksum, diskChecksum });
      }
    }

    if (modified.length === 0) {
      console.log('All migration checksums match. No drift detected.');
      process.exit(0);
    }

    console.error(`DRIFT DETECTED: ${modified.length} migration(s) modified after application:\n`);
    for (const m of modified) {
      console.error(`  ${m.name}`);
      console.error(`    DB:   ${m.dbChecksum.substring(0, 16)}...`);
      console.error(`    Disk: ${m.diskChecksum.substring(0, 16)}...`);
    }

    if (FIX_MODE) {
      console.log('\n--fix mode: updating checksums in DB...');
      for (const m of modified) {
        await client.query(
          `UPDATE _prisma_migrations SET checksum = $1 WHERE migration_name = $2 AND applied_steps_count > 0`,
          [m.diskChecksum, m.name]
        );
        console.log(`  Updated: ${m.name}`);
      }
      console.log('Done. Checksums updated.');
    } else {
      console.error('\nTo fix: restore the original migration files, or run with --fix to update checksums (dev only).');
      process.exit(1);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
