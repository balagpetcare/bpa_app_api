/**
 * Copies all content from docs/ to documentation/ so project docs stay in one folder
 * and don't mix with main source files. Run from backend-api root: node scripts/copy-docs-to-documentation.js
 */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "docs");
const destDir = path.join(root, "documentation");

if (!fs.existsSync(srcDir)) {
  console.log("docs folder not found. Nothing to copy.");
  process.exit(0);
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

copyRecursive(srcDir, destDir);
console.log("Copied docs/ to documentation/");
