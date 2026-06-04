#!/usr/bin/env node
/**
 * Two-pass migration ordering audit (heuristic).
 * Detects REFERENCES / ALTER TABLE to "table" that appear before the first CREATE TABLE for that name.
 *
 * Limitations: strips `DO $$ ... $$` blocks before REFERENCES/ALTER scans only (reduces false
 * positives for deferred FK patterns). Does not model enum ordering or nested DO bodies perfectly.
 * Full validation: `prisma migrate deploy` against empty PostgreSQL.
 *
 * Usage: node scripts/audit-migration-dependencies.mjs
 */

import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "prisma", "migrations");

function listMigrationDirs() {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
}

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "\n");
}

/** Removes Postgres anonymous DO blocks to avoid flagging deferred FKs (heuristic). */
function stripDoDollarBlocks(sql) {
  return sql.replace(/DO\s+\$\$[\s\S]*?END\s+\$\$;/gi, "\n");
}

function minIndex(map, name) {
  const v = map.get(name);
  return v === undefined ? Infinity : v;
}

function main() {
  const dirs = listMigrationDirs();
  const createTableAt = new Map();

  for (let i = 0; i < dirs.length; i++) {
    const sqlPath = path.join(MIGRATIONS_DIR, dirs[i], "migration.sql");
    if (!fs.existsSync(sqlPath)) continue;
    const sql = stripComments(fs.readFileSync(sqlPath, "utf8"));
    const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/gi;
    let m;
    while ((m = re.exec(sql))) {
      const t = m[1];
      if (!createTableAt.has(t)) createTableAt.set(t, i);
    }
  }

  const violations = [];

  for (let i = 0; i < dirs.length; i++) {
    const label = dirs[i];
    const sqlPath = path.join(MIGRATIONS_DIR, label, "migration.sql");
    if (!fs.existsSync(sqlPath)) continue;
    const sqlFull = stripComments(fs.readFileSync(sqlPath, "utf8"));
    const sql = stripDoDollarBlocks(sqlFull);

    const refRe = /REFERENCES\s+"([^"]+)"\s*\(/gi;
    let rm;
    while ((rm = refRe.exec(sql))) {
      const to = rm[1];
      if (minIndex(createTableAt, to) > i) {
        violations.push({
          kind: "REFERENCES_BEFORE_FIRST_CREATE_TABLE",
          migration: label,
          migrationIndex: i,
          referencedTable: to,
          firstCreateMigration: createTableAt.has(to) ? dirs[createTableAt.get(to)] : null,
        });
      }
    }

    // ALTER TABLE "schema"."table" -> use table name only (ignore schema)
    const altRe = /ALTER\s+TABLE\s+(?:"(?:[^"]+)"\.)?"([^"]+)"/gi;
    while ((rm = altRe.exec(sql))) {
      const t = rm[1];
      if (minIndex(createTableAt, t) > i) {
        violations.push({
          kind: "ALTER_TABLE_BEFORE_FIRST_CREATE_TABLE",
          migration: label,
          migrationIndex: i,
          referencedTable: t,
          firstCreateMigration: createTableAt.has(t) ? dirs[createTableAt.get(t)] : null,
        });
      }
    }
  }

  const dedup = new Map();
  for (const v of violations) {
    const key = `${v.kind}|${v.migration}|${v.referencedTable}`;
    dedup.set(key, v);
  }
  const list = [...dedup.values()].sort((a, b) => a.migration.localeCompare(b.migration));

  console.log(
    JSON.stringify(
      {
        migrationCount: dirs.length,
        uniqueTablesCreated: createTableAt.size,
        violationCount: list.length,
        violations: list,
      },
      null,
      2
    )
  );

  if (list.length) process.exitCode = 2;
}

main();
