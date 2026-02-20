/**
 * Move remaining root .md files into docs/
 * Run from backend-api: node scripts/move-root-md-to-documentation.js
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const docs = path.join(root, "docs");

const files = [
  "BPA_ANALYSIS_AND_ROADMAP.md",
  "BPA_CONTEXT_PACK.md",
  "BPA_MVP_DEVELOPER_GUIDE.md",
];

files.forEach((f) => {
  const src = path.join(root, f);
  const dest = path.join(docs, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
    console.log("Moved:", f);
  }
});
console.log("Done.");
