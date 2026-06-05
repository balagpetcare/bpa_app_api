/**
 * Copy non-TypeScript runtime assets from src/ to dist/ after tsc.
 * tsc only emits .ts files; legacy .js, templates, and static files must be mirrored.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");
const DIST_DIR = path.join(ROOT, "dist");

/** Extensions loaded at runtime via require() or fs.readFile. */
const RUNTIME_EXTENSIONS = new Set([
  ".js",
  ".json",
  ".html",
  ".sql",
  ".hbs",
  ".ejs",
]);

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (RUNTIME_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

function listSrcJsFiles() {
  return walk(SRC_DIR).filter((f) => path.extname(f).toLowerCase() === ".js");
}

function verifyAllSrcJsMirrored() {
  const srcJs = listSrcJsFiles();
  const missing = srcJs
    .map((f) => path.relative(SRC_DIR, f).split(path.sep).join("/"))
    .filter((rel) => !fs.existsSync(path.join(DIST_DIR, rel)));

  if (missing.length > 0) {
    console.error("[copy-runtime-assets] src/**/*.js not mirrored in dist/:");
    for (const rel of missing) console.error(`  - ${rel}`);
    process.exit(1);
  }

  return srcJs.map((f) => path.relative(SRC_DIR, f).split(path.sep).join("/"));
}

function main() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error("[copy-runtime-assets] dist/ not found — run tsc first");
    process.exit(1);
  }

  const sources = walk(SRC_DIR);
  let copied = 0;

  for (const srcFile of sources) {
    const rel = path.relative(SRC_DIR, srcFile);
    const destFile = path.join(DIST_DIR, rel);
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    fs.copyFileSync(srcFile, destFile);
    copied += 1;
  }

  const mirroredJs = verifyAllSrcJsMirrored();

  console.log(`[copy-runtime-assets] Copied ${copied} file(s) from src/ to dist/`);
  console.log(`[copy-runtime-assets] Verified ${mirroredJs.length} runtime JS asset(s):`);
  for (const rel of mirroredJs) console.log(`  - ${rel}`);
}

main();
