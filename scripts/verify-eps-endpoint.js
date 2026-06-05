/**
 * EPS gateway connectivity check (DNS + GetToken smoke test).
 * Usage: node scripts/verify-eps-endpoint.js [--base=https://sandboxpgapi.eps.com.bd]
 * Loads backend-api/.env when present (dotenv optional).
 */
const https = require("https");
const crypto = require("crypto");
const { readFileSync, existsSync } = require("fs");
const { resolve } = require("path");

function loadEnv() {
  const envPath = resolve(__dirname, "../.env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function generateEpsHash(value, hashKey) {
  return crypto.createHmac("sha512", Buffer.from(hashKey, "utf8")).update(value, "utf8").digest("base64");
}

function postJson(url, body, headers) {
  return new Promise((resolvePromise, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers },
        timeout: 25_000,
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let parsed = {};
          try {
            parsed = JSON.parse(raw || "{}");
          } catch {
            parsed = { raw };
          }
          resolvePromise({ status: res.statusCode, data: parsed });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.write(data);
    req.end();
  });
}

const CANDIDATES = [
  { label: "sandbox API (correct)", base: "https://sandboxpgapi.eps.com.bd" },
  { label: "production API", base: "https://pgapi.eps.com.bd" },
  { label: "legacy typo (broken DNS)", base: "https://sandbox-pgapi.eps.com.bd" },
];

async function probe(base, user, pass, hashKey) {
  const url = `${base.replace(/\/+$/, "")}/v1/Auth/GetToken`;
  try {
    const res = await postJson(
      url,
      { userName: user, password: pass },
      { "x-hash": generateEpsHash(user, hashKey) }
    );
    return {
      base,
      ok: res.status === 200 && !!res.data.token,
      status: res.status,
      hasToken: !!res.data.token,
      error: res.data.errorMessage || res.data.errorCode || null,
    };
  } catch (e) {
    return { base, ok: false, error: e.code || e.message };
  }
}

async function main() {
  loadEnv();
  const argBase = process.argv.find((a) => a.startsWith("--base="))?.split("=")[1];
  const user = process.env.EPS_USERNAME || "";
  const pass = process.env.EPS_PASSWORD || "";
  const hashKey = process.env.EPS_HASH_KEY || process.env.EPS_HASH || "";
  const configured = (process.env.EPS_BASE_URL || "").trim();
  const sandboxDefault = "https://sandboxpgapi.eps.com.bd";

  console.log("EPS endpoint verification\n");
  if (configured) console.log(`EPS_BASE_URL (env): ${configured}`);
  console.log(`Recommended sandbox API: ${sandboxDefault}\n`);

  const list = argBase
    ? [{ label: "custom", base: argBase }]
    : CANDIDATES;

  if (!user || !pass || !hashKey) {
    console.log("Skip GetToken: set EPS_USERNAME, EPS_PASSWORD, EPS_HASH in .env\n");
    for (const c of list) {
      console.log(`  ${c.base} — credentials not loaded`);
    }
    process.exit(0);
  }

  for (const c of list) {
    const r = await probe(c.base, user, pass, hashKey);
    const status = r.ok ? "OK (token)" : r.hasToken === false && r.status === 200 ? "reachable, auth failed" : "FAIL";
    console.log(`[${c.label}] ${r.base}`);
    console.log(`  ${status}${r.error ? ` — ${r.error}` : ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
