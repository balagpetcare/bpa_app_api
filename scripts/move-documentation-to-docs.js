/**
 * Copy everything from documentation/ to docs/, then remove documentation/
 * Run from backend-api: node scripts/move-documentation-to-docs.js
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "documentation");
const destDir = path.join(root, "docs");

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.copyFileSync(src, dest);
    console.log("Copied:", path.relative(root, dest));
  }
}

function removeRecursive(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) removeRecursive(p);
    else fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
  console.log("Removed:", path.relative(root, dir));
}

if (!fs.existsSync(srcDir)) {
  console.log("documentation/ not found. Nothing to do.");
  process.exit(0);
}

console.log("Copying documentation/ -> docs/ ...");
copyRecursive(srcDir, destDir);
console.log("Removing documentation/ ...");
removeRecursive(srcDir);
console.log("Done.");
