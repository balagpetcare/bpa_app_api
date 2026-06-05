import fs from "fs";
import path from "path";

const vars = new Map();

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (["node_modules", "dist", ".git"].includes(ent.name)) continue;
      walk(p);
    } else if (/\.(ts|js|mjs|tsx)$/.test(ent.name)) {
      const text = fs.readFileSync(p, "utf8");
      for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        const name = m[1];
        if (!vars.has(name)) vars.set(name, new Set());
        vars.get(name).add(p.replace(/\\/g, "/"));
      }
      for (const m of text.matchAll(/env\(["']([A-Z0-9_]+)["']\)/g)) {
        const name = m[1];
        if (!vars.has(name)) vars.set(name, new Set());
        vars.get(name).add(p.replace(/\\/g, "/"));
      }
    }
  }
}

["src", "scripts", "prisma", "tests", "prisma.config.ts"].forEach((w) => {
  if (w.endsWith(".ts")) {
    if (!fs.existsSync(w)) return;
    const text = fs.readFileSync(w, "utf8");
    for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      const name = m[1];
      if (!vars.has(name)) vars.set(name, new Set());
      vars.get(name).add(w.replace(/\\/g, "/"));
    }
    for (const m of text.matchAll(/env\(["']([A-Z0-9_]+)["']\)/g)) {
      const name = m[1];
      if (!vars.has(name)) vars.set(name, new Set());
      vars.get(name).add(w.replace(/\\/g, "/"));
    }
    return;
  }
  walk(w);
});

const sorted = [...vars.keys()].sort();
import { writeFileSync } from "fs";
const out = { total: sorted.length, vars: Object.fromEntries(sorted.map((k) => [k, [...vars.get(k)].sort()])) };
writeFileSync("scripts/_env-inventory.json", JSON.stringify(out, null, 2), "utf8");
console.log("Wrote scripts/_env-inventory.json (" + sorted.length + " vars)");
