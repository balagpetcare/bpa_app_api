/**
 * NON-DESTRUCTIVE Prisma migration reconciliation script.
 *
 * This script:
 * 1. Removes rolled-back/failed ghost entries from _prisma_migrations
 * 2. Updates checksums for 5 modified-after-application migrations
 * 3. Does NOT touch any application tables or data
 * 4. Only modifies the _prisma_migrations metadata table
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const client = await pool.connect();

  try {
    if (DRY_RUN) {
      console.log('=== DRY RUN MODE — no changes will be made ===\n');
    }

    // Pre-check: count rows
    const { rows: preCount } = await client.query('SELECT COUNT(*)::int as c FROM _prisma_migrations');
    console.log(`Pre-reconciliation: ${preCount[0].c} entries in _prisma_migrations`);

    // ─── STEP 1: Remove rolled-back ghost entries ───
    console.log('\n=== STEP 1: Remove rolled-back entries ===');

    const { rows: rolledBack } = await client.query(
      `SELECT id, migration_name, started_at, rolled_back_at
       FROM _prisma_migrations WHERE rolled_back_at IS NOT NULL`
    );

    console.log(`Found ${rolledBack.length} rolled-back entries:`);
    for (const r of rolledBack) {
      console.log(`  - ${r.migration_name} (id: ${r.id}, rolled_back: ${r.rolled_back_at})`);
    }

    if (!DRY_RUN && rolledBack.length > 0) {
      const { rowCount } = await client.query(
        `DELETE FROM _prisma_migrations WHERE rolled_back_at IS NOT NULL`
      );
      console.log(`Deleted ${rowCount} rolled-back entries.`);
    }

    // ─── STEP 2: Fix zero-step finished ghost entries ───
    console.log('\n=== STEP 2: Fix zero-step finished ghost entries ===');

    const { rows: zeroStep } = await client.query(
      `SELECT id, migration_name, started_at, finished_at, applied_steps_count
       FROM _prisma_migrations
       WHERE applied_steps_count = 0 AND finished_at IS NOT NULL AND rolled_back_at IS NULL`
    );

    console.log(`Found ${zeroStep.length} zero-step finished entries:`);
    for (const r of zeroStep) {
      console.log(`  - ${r.migration_name} (id: ${r.id})`);
    }

    // Instead of deleting, mark these as applied (steps=1) so Prisma considers them done.
    // The migration SQL was already effectively applied (the backfill is idempotent and
    // the DB already has the data). Setting steps=1 tells Prisma "this migration was applied."
    if (!DRY_RUN && zeroStep.length > 0) {
      for (const r of zeroStep) {
        await client.query(
          `UPDATE _prisma_migrations SET applied_steps_count = 1 WHERE id = $1`,
          [r.id]
        );
        console.log(`  Fixed ${r.migration_name} (id: ${r.id}) — set applied_steps_count = 1`);
      }
    }

    // ─── STEP 3: Update checksums for modified migrations ───
    console.log('\n=== STEP 3: Update checksums for modified migrations ===');

    const modifiedMigrations = [
      '20260324180000_medicine_workspace_master_fields',
      '20260326130000_country_medicine_brand_workspace_profile',
      '20260328160000_backfill_default_branch_inventory_locations',
      '20260403120000_medicine_catalog_import',
      '20260429120000_warehouse_enterprise_po_allocation_pick_pod',
    ];

    const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');

    for (const name of modifiedMigrations) {
      const sqlFile = path.join(migrationsDir, name, 'migration.sql');
      if (!fs.existsSync(sqlFile)) {
        console.log(`  SKIP: ${name} — migration.sql not found on disk`);
        continue;
      }

      const content = fs.readFileSync(sqlFile, 'utf8');
      const newChecksum = crypto.createHash('sha256').update(content).digest('hex');

      // Get current DB checksum
      const { rows: current } = await client.query(
        `SELECT id, checksum FROM _prisma_migrations
         WHERE migration_name = $1 AND applied_steps_count > 0`,
        [name]
      );

      if (current.length === 0) {
        // For backfill, it may have 0 steps — check if it exists at all after cleanup
        const { rows: any } = await client.query(
          `SELECT id, checksum, applied_steps_count FROM _prisma_migrations WHERE migration_name = $1`,
          [name]
        );
        if (any.length === 0) {
          console.log(`  SKIP: ${name} — no entry in DB (may have been cleaned)`);
          continue;
        }
        // Update whatever entry remains
        const entry = any[0];
        if (entry.checksum === newChecksum) {
          console.log(`  OK: ${name} — checksum already matches`);
          continue;
        }
        console.log(`  UPDATE: ${name}`);
        console.log(`    DB checksum:   ${entry.checksum.substring(0, 16)}...`);
        console.log(`    Disk checksum: ${newChecksum.substring(0, 16)}...`);
        if (!DRY_RUN) {
          await client.query(
            `UPDATE _prisma_migrations SET checksum = $1 WHERE id = $2`,
            [newChecksum, entry.id]
          );
          console.log(`    Updated.`);
        }
        continue;
      }

      const entry = current[0];
      if (entry.checksum === newChecksum) {
        console.log(`  OK: ${name} — checksum already matches`);
        continue;
      }

      console.log(`  UPDATE: ${name}`);
      console.log(`    DB checksum:   ${entry.checksum.substring(0, 16)}...`);
      console.log(`    Disk checksum: ${newChecksum.substring(0, 16)}...`);

      if (!DRY_RUN) {
        await client.query(
          `UPDATE _prisma_migrations SET checksum = $1 WHERE id = $2`,
          [newChecksum, entry.id]
        );
        console.log(`    Updated.`);
      }
    }

    // ─── STEP 4: Verify post-state ───
    console.log('\n=== POST-RECONCILIATION STATE ===');

    const { rows: postCount } = await client.query('SELECT COUNT(*)::int as c FROM _prisma_migrations');
    console.log(`Post-reconciliation: ${postCount[0].c} entries in _prisma_migrations`);

    // Check for any remaining issues
    const { rows: remaining } = await client.query(
      `SELECT COUNT(*)::int as c FROM _prisma_migrations WHERE rolled_back_at IS NOT NULL`
    );
    console.log(`Remaining rolled-back: ${remaining[0].c}`);

    const { rows: unfinished } = await client.query(
      `SELECT COUNT(*)::int as c FROM _prisma_migrations WHERE finished_at IS NULL`
    );
    console.log(`Remaining unfinished: ${unfinished[0].c}`);

    // Verify all disk migrations have a DB entry
    const { rows: allDb } = await client.query(
      `SELECT migration_name FROM _prisma_migrations`
    );
    const dbNames = new Set(allDb.map(r => r.migration_name));
    const folders = fs.readdirSync(migrationsDir)
      .filter(f => fs.statSync(path.join(migrationsDir, f)).isDirectory())
      .sort();

    const missingInDb = folders.filter(f => !dbNames.has(f));
    const missingOnDisk = allDb.filter(r => !folders.includes(r.migration_name));

    console.log(`Folders on disk: ${folders.length}`);
    console.log(`Entries in DB: ${allDb.length}`);
    console.log(`Missing in DB: ${missingInDb.length}`);
    console.log(`Missing on disk: ${missingOnDisk.length}`);

    if (missingInDb.length > 0) {
      console.log('\nFolders missing in DB:');
      for (const f of missingInDb) console.log(`  - ${f}`);
    }

    if (missingOnDisk.length > 0) {
      console.log('\nDB entries missing on disk:');
      for (const r of missingOnDisk) console.log(`  - ${r.migration_name}`);
    }

    if (DRY_RUN) {
      console.log('\n=== DRY RUN COMPLETE — no changes were made ===');
    } else {
      console.log('\n=== RECONCILIATION COMPLETE ===');
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
