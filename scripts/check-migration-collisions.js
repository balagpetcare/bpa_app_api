/**
 * Scans prisma/migrations/.../migration.sql for duplicate CREATE UNIQUE INDEX or ADD CONSTRAINT
 * with the same name. Exits with code 1 if any duplicate is found (for CI/pre-commit).
 * Usage: node scripts/check-migration-collisions.js
 */

const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
if (!fs.existsSync(migrationsDir)) {
  console.error('Migrations directory not found:', migrationsDir);
  process.exit(2);
}

const dirs = fs.readdirSync(migrationsDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .sort();

const indexNameRe = /CREATE\s+UNIQUE\s+INDEX\s+(?:"([^"]+)"|IF\s+NOT\s+EXISTS\s+"([^"]+)")/gi;
const constraintNameRe = /ADD\s+CONSTRAINT\s+"([^"]+)"/gi;

const indexByName = {};
const constraintByName = {};

function collectNames(content, migrationPath) {
  let m;
  indexNameRe.lastIndex = 0;
  while ((m = indexNameRe.exec(content)) !== null) {
    const name = (m[1] || m[2] || '').trim();
    if (name) {
      indexByName[name] = indexByName[name] || [];
      if (!indexByName[name].includes(migrationPath)) indexByName[name].push(migrationPath);
    }
  }
  constraintNameRe.lastIndex = 0;
  while ((m = constraintNameRe.exec(content)) !== null) {
    const name = (m[1] || '').trim();
    if (name) {
      constraintByName[name] = constraintByName[name] || [];
      if (!constraintByName[name].includes(migrationPath)) constraintByName[name].push(migrationPath);
    }
  }
}

for (const dir of dirs) {
  const sqlPath = path.join(migrationsDir, dir, 'migration.sql');
  if (!fs.existsSync(sqlPath)) continue;
  const content = fs.readFileSync(sqlPath, 'utf8');
  const migrationPath = `prisma/migrations/${dir}/migration.sql`;
  collectNames(content, migrationPath);
}

let hasDuplicate = false;

for (const [name, paths] of Object.entries(indexByName)) {
  if (paths.length <= 1) continue;
  // If any migration uses IF NOT EXISTS for this index, consider it safe (idempotent).
  const fullPaths = paths.map(p => path.join(__dirname, '..', p));
  const anyUsesIfNotExists = fullPaths.some(p => {
    try {
      const content = fs.readFileSync(p, 'utf8');
      return content.includes('IF NOT EXISTS') && content.includes(name);
    } catch (_) { return false; }
  });
  if (anyUsesIfNotExists) continue;
  hasDuplicate = true;
  console.error(`[DUPLICATE UNIQUE INDEX] "${name}" appears in multiple migrations (none uses IF NOT EXISTS):`);
  paths.forEach(p => console.error('  -', p));
}

for (const [name, paths] of Object.entries(constraintByName)) {
  if (paths.length > 1) {
    hasDuplicate = true;
    console.error(`[DUPLICATE CONSTRAINT] "${name}" appears in multiple migrations:`);
    paths.forEach(p => console.error('  -', p));
  }
}

if (hasDuplicate) {
  console.error('\nFix: use IF NOT EXISTS for indexes or DO $$ ... EXCEPTION WHEN duplicate_object for constraints, or remove duplicate from one migration.');
  process.exit(1);
}

console.log('OK: No duplicate CREATE UNIQUE INDEX or ADD CONSTRAINT names across migrations.');
process.exit(0);
