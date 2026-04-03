/**
 * Run the project-local Prisma CLI (package.json `prisma`).
 * Avoids: bare `prisma` not on PATH, and `npx prisma` downloading a mismatched global Prisma when local CLI is missing.
 *
 * Usage: node scripts/run-local-prisma.cjs <...prisma args>
 * Example: node scripts/run-local-prisma.cjs migrate deploy
 */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const prismaPkg = path.join(root, "node_modules", "prisma", "package.json");

if (!fs.existsSync(prismaPkg)) {
  console.error(
    "[run-local-prisma] Missing devDependency `prisma`. From repo root run:\n" +
      "  npm ci\n" +
      "or:\n" +
      "  npm install\n" +
      "Do not use `npx prisma` without a working local install — npx may fetch Prisma 7 and break this schema."
  );
  process.exit(1);
}

let prismaCli;
try {
  const pkg = JSON.parse(fs.readFileSync(prismaPkg, "utf8"));
  const bin = pkg.bin;
  const rel =
    typeof bin === "string"
      ? bin
      : bin && (bin.prisma || bin["prisma-cli"] || Object.values(bin)[0]);
  if (!rel || typeof rel !== "string") {
    throw new Error("Could not resolve prisma package bin entry");
  }
  prismaCli = path.join(root, "node_modules", "prisma", rel);
} catch (e) {
  console.error("[run-local-prisma] Failed to read prisma package.json:", e.message);
  process.exit(1);
}

if (!fs.existsSync(prismaCli)) {
  console.error("[run-local-prisma] Prisma CLI entry missing at:\n  " + prismaCli);
  process.exit(1);
}

const args = process.argv.slice(2);
const r = spawnSync(process.execPath, [prismaCli, ...args], {
  stdio: "inherit",
  cwd: root,
  env: process.env,
  windowsHide: true,
});

if (r.error) {
  console.error("[run-local-prisma]", r.error.message);
  process.exit(1);
}
process.exit(r.status === null ? 1 : r.status);
