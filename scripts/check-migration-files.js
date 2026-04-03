#!/usr/bin/env node
/**
 * Ensures every folder under prisma/migrations contains a non-empty migration.sql.
 * Run in CI / pre-deploy to catch P3015-style issues early.
 *
 * Usage: node scripts/check-migration-files.js
 */
const fs = require("fs");
const path = require("path");

const migrationsDir = path.join(__dirname, "..", "prisma", "migrations");

function main() {
  if (!fs.existsSync(migrationsDir)) {
    console.error("Missing directory:", migrationsDir);
    process.exit(1);
  }
  const names = fs.readdirSync(migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  const missing = [];
  const empty = [];
  for (const d of names) {
    const sqlPath = path.join(migrationsDir, d.name, "migration.sql");
    if (!fs.existsSync(sqlPath)) {
      missing.push(d.name);
      continue;
    }
    const st = fs.statSync(sqlPath);
    const content = fs.readFileSync(sqlPath, "utf8").trim();
    if (st.size === 0 || content.length === 0) {
      empty.push(d.name);
    }
  }
  if (missing.length === 0 && empty.length === 0) {
    console.log(`OK: ${names.length} migration folders checked; all have non-empty migration.sql`);
    process.exit(0);
  }
  if (missing.length) {
    console.error("Missing migration.sql:");
    missing.forEach((n) => console.error("  -", n));
  }
  if (empty.length) {
    console.error("Empty migration.sql:");
    empty.forEach((n) => console.error("  -", n));
  }
  process.exit(1);
}

main();
