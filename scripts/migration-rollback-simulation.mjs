#!/usr/bin/env node
/**
 * Rollback simulation (documentation-only — Prisma has no automatic down migrations).
 * Scans migration.sql files for destructive DDL and proposes inverse operations
 * in reverse chronological order for disaster-recovery planning.
 *
 * Usage: node scripts/migration-rollback-simulation.mjs [--tail=5]
 */

import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "prisma", "migrations");
const tailArg = process.argv.find((a) => a.startsWith("--tail="));
const tail = tailArg ? parseInt(tailArg.split("=")[1], 10) : 10;

function listMigrationDirs() {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
}

function analyzeSql(sql, migration) {
  const destructive = [];
  const additive = [];

  const dropTable = [...sql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/gi)];
  for (const m of dropTable) destructive.push({ kind: "DROP_TABLE", object: m[1] });

  const dropColumn = [...sql.matchAll(/ALTER\s+TABLE\s+"([^"]+)"[^;]*DROP\s+COLUMN\s+"([^"]+)"/gi)];
  for (const m of dropColumn) destructive.push({ kind: "DROP_COLUMN", table: m[1], column: m[2] });

  const createTable = [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/gi)];
  for (const m of createTable) additive.push({ kind: "CREATE_TABLE", object: m[1] });

  const addColumn = [...sql.matchAll(/ALTER\s+TABLE\s+"([^"]+)"\s+ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+"([^"]+)"/gi)];
  for (const m of addColumn) additive.push({ kind: "ADD_COLUMN", table: m[1], column: m[2] });

  const isPlaceholder = /^\s*SELECT\s+1\s*;?\s*$/i.test(sql.replace(/--[^\n]*/g, "").trim());

  return { migration, isPlaceholder, destructive, additive };
}

function proposeInverse(entry) {
  const steps = [];
  for (const d of entry.destructive) {
    if (d.kind === "DROP_TABLE") {
      steps.push({ action: "RESTORE_TABLE", note: `Cannot auto-restore ${d.object}; restore from backup or re-run CREATE from earlier migration` });
    }
    if (d.kind === "DROP_COLUMN") {
      steps.push({ action: "ADD_COLUMN", table: d.table, column: d.column, note: "Re-add column with prior type from backup/schema history" });
    }
  }
  for (const a of entry.additive) {
    if (a.kind === "CREATE_TABLE") {
      steps.push({ action: "DROP_TABLE", object: a.object, sql: `DROP TABLE IF EXISTS "${a.object}" CASCADE;` });
    }
    if (a.kind === "ADD_COLUMN") {
      steps.push({
        action: "DROP_COLUMN",
        table: a.table,
        column: a.column,
        sql: `ALTER TABLE "${a.table}" DROP COLUMN IF EXISTS "${a.column}";`,
      });
    }
  }
  return steps;
}

function main() {
  const dirs = listMigrationDirs();
  const slice = dirs.slice(-tail);
  const report = [];

  for (const name of slice) {
    const sqlPath = path.join(MIGRATIONS_DIR, name, "migration.sql");
    const sql = fs.readFileSync(sqlPath, "utf8");
    const analysis = analyzeSql(sql, name);
    report.push({
      ...analysis,
      rollbackSteps: proposeInverse(analysis),
    });
  }

  const summary = {
    simulatedAt: new Date().toISOString(),
    totalMigrations: dirs.length,
    tailReviewed: slice.length,
    note: "Prisma Migrate is forward-only. This report is a planning aid, not an executable rollback.",
    migrations: report.reverse(),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
